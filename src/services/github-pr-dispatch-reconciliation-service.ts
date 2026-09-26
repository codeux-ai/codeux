import type { TaskRecord } from "../contracts/project-management-types.js";
import type { GithubIntakeItem } from "../contracts/github-intake-types.js";
import type { GithubIntakeRepository } from "../repositories/github-intake-repository.js";

type PullDisposition = "pr_merged" | "pr_author_mismatch" | "pr_author_unknown" | "pr_checks_failed" | "pr_checks_pending" | "pr_draft" | "pr_review_ready" | "pr_closed";

interface PullRequestResponse {
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  head?: { sha?: string };
  user?: { login?: string };
}

interface AuthenticatedUserResponse {
  login?: string;
}

interface CheckRunResponse {
  check_runs?: Array<{ status?: string; conclusion?: string | null }>;
}

export interface GithubPrDispatchReconciliationResult {
  inspected: number;
  held: number;
  completed: number;
  unavailable: number;
}

export interface GithubPrDispatchReconciliationServiceDeps {
  intakeRepository: Pick<GithubIntakeRepository, "listDispatched" | "setStatus">;
  projectManagementRepository: {
    listTasks(projectId: string, sprintId?: string): TaskRecord[];
  };
  executionRepository: {
    listLatestTaskRuns(taskIds: string[]): Map<string, { prUrl: string | null }>;
  };
  getGithubToken(projectId: string): string | null | undefined;
  fetch?: typeof fetch;
}

/**
 * Observes provider-created PRs after code is complete.  It deliberately makes
 * no GitHub mutations and invokes no model: it only converts a stuck intake
 * lane into a durable, truthful disposition so another eligible issue can run.
 */
export class GithubPrDispatchReconciliationService {
  private readonly fetcher: typeof fetch;

  constructor(private readonly deps: GithubPrDispatchReconciliationServiceDeps) {
    this.fetcher = deps.fetch ?? fetch;
  }

  async reconcile(input: { projectId: string; repository: string; signal?: AbortSignal }): Promise<GithubPrDispatchReconciliationResult> {
    const result: GithubPrDispatchReconciliationResult = { inspected: 0, held: 0, completed: 0, unavailable: 0 };
    const token = this.deps.getGithubToken(input.projectId)?.trim();
    if (!token) return result;
    let expectedAuthor: string;
    try {
      expectedAuthor = await this.authenticatedGithubLogin(token, input.signal);
    } catch {
      result.unavailable = this.deps.intakeRepository.listDispatched(input.projectId, input.repository).length;
      return result;
    }

    for (const item of this.deps.intakeRepository.listDispatched(input.projectId, input.repository)) {
      input.signal?.throwIfAborted();
      const prUrls = this.completedTaskPrUrls(input.projectId, item);
      if (!prUrls) continue;
      result.inspected += 1;
      try {
        const disposition = await this.inspectAll(input.repository, prUrls, token, expectedAuthor, input.signal);
        if (disposition === "pr_merged") {
          this.deps.intakeRepository.setStatus(item.id, "completed", disposition);
          result.completed += 1;
        } else {
          this.deps.intakeRepository.setStatus(item.id, "held", disposition);
          result.held += 1;
        }
      } catch {
        // Unknown GitHub state must retain capacity.  Releasing it would turn a
        // token/API outage into duplicate implementation work.
        result.unavailable += 1;
      }
    }
    return result;
  }

  private completedTaskPrUrls(projectId: string, item: GithubIntakeItem): string[] | null {
    if (!item.sprintId) return null;
    const tasks = this.deps.projectManagementRepository.listTasks(projectId, item.sprintId);
    if (tasks.length === 0 || tasks.some((task) => String(task.status).toLowerCase() !== "coding_completed")) return null;
    const runs = this.deps.executionRepository.listLatestTaskRuns(tasks.map((task) => task.id));
    const urls = tasks.map((task) => runs.get(task.id)?.prUrl?.trim()).filter((value): value is string => Boolean(value));
    return urls.length === tasks.length ? Array.from(new Set(urls)) : null;
  }

  private async inspectAll(repository: string, urls: string[], token: string, expectedAuthor: string, signal?: AbortSignal): Promise<PullDisposition> {
    const dispositions = await Promise.all(urls.map((url) => this.inspectOne(repository, url, token, expectedAuthor, signal)));
    if (dispositions.every((value) => value === "pr_merged")) return "pr_merged";
    if (dispositions.includes("pr_author_mismatch")) return "pr_author_mismatch";
    if (dispositions.includes("pr_author_unknown")) return "pr_author_unknown";
    if (dispositions.includes("pr_checks_failed")) return "pr_checks_failed";
    if (dispositions.includes("pr_closed")) return "pr_closed";
    if (dispositions.includes("pr_draft")) return "pr_draft";
    if (dispositions.includes("pr_checks_pending")) return "pr_checks_pending";
    return "pr_review_ready";
  }

  private async inspectOne(repository: string, url: string, token: string, expectedAuthor: string, signal?: AbortSignal): Promise<PullDisposition> {
    const number = pullNumber(repository, url);
    const pull = await this.request<PullRequestResponse>(`https://api.github.com/repos/${repository}/pulls/${number}`, token, signal);
    const author = pull.user?.login?.trim();
    if (!author) return "pr_author_unknown";
    if (author.localeCompare(expectedAuthor, undefined, { sensitivity: "accent" }) !== 0) return "pr_author_mismatch";
    if (pull.merged_at) return "pr_merged";
    if (pull.state !== "open") return "pr_closed";
    const sha = pull.head?.sha;
    if (!sha) throw new Error("GitHub pull request response has no head SHA.");
    const checks = await this.request<CheckRunResponse>(`https://api.github.com/repos/${repository}/commits/${sha}/check-runs`, token, signal);
    const runs = checks.check_runs ?? [];
    if (runs.some((run) => failedConclusion(run.conclusion))) return "pr_checks_failed";
    if (pull.draft) return "pr_draft";
    if (runs.some((run) => run.status !== "completed" || run.conclusion === null || run.conclusion === undefined)) return "pr_checks_pending";
    return "pr_review_ready";
  }

  private async authenticatedGithubLogin(token: string, signal?: AbortSignal): Promise<string> {
    const user = await this.request<AuthenticatedUserResponse>("https://api.github.com/user", token, signal);
    const login = user.login?.trim();
    if (!login) throw new Error("Configured GitHub credential has no account login.");
    return login;
  }

  private async request<T>(url: string, token: string, signal?: AbortSignal): Promise<T> {
    const response = await this.fetcher(url, {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub PR inspection failed with HTTP ${response.status}.`);
    return await response.json() as T;
  }
}

function pullNumber(repository: string, url: string): number {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i.exec(url.trim());
  if (!match || `${match[1]}/${match[2]}`.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("Task PR URL does not belong to the intake repository.");
  }
  return Number(match[3]);
}

function failedConclusion(value: string | null | undefined): boolean {
  return value === "failure" || value === "cancelled" || value === "timed_out" || value === "action_required" || value === "startup_failure" || value === "stale";
}
