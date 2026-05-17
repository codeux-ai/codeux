import type {
  LinkedIssueProvider,
  ProjectSummary,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
} from "../contracts/project-management-types.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { resolveRepositoryHost } from "../infrastructure/git/repository-host-resolver.js";

export interface IssueSearchInput {
  provider?: LinkedIssueProvider;
  repository?: string;
  hostDomain?: string;
  search?: string;
  state?: "open" | "closed" | "all";
  labels?: string[];
  assignee?: string;
  limit?: number;
}

export interface RemoteIssueSummary extends SprintLinkedIssueInput {
  bodyPreview: string;
  updatedAt: string | null;
}

interface IssueServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  getDashboardSettings: (scope?: { projectId?: string; sprintId?: string }) => DashboardSettings;
  logger?: Logger;
}

export class SprintIssueService {
  private readonly logger: Logger;

  constructor(private readonly deps: IssueServiceDeps) {
    this.logger = deps.logger ?? createLogger({ bindings: { component: "sprint-issue-service" } });
  }

  async searchIssues(projectId: string, input: IssueSearchInput): Promise<RemoteIssueSummary[]> {
    const project = this.requireProject(projectId);
    const target = resolveIssueTarget(project, input);
    const settings = this.deps.getDashboardSettings({ projectId });
    const limit = clampLimit(input.limit);

    if (target.provider === "github") {
      return this.searchGitHubIssues({
        ...target,
        token: settings.git.githubToken,
        search: input.search,
        state: input.state || "open",
        labels: input.labels || [],
        assignee: input.assignee,
        limit,
      });
    }

    return this.searchGitLabIssues({
      ...target,
      token: settings.git.gitlabToken || "",
      search: input.search,
      state: input.state || "open",
      labels: input.labels || [],
      assignee: input.assignee,
      limit,
    });
  }

  async closeLinkedIssues(projectId: string, sprintId: string): Promise<{ reportText: string; closed: number; failed: number; skipped: number }> {
    const settings = this.deps.getDashboardSettings({ projectId, sprintId });
    const linkedIssues = this.deps.projectManagementRepository
      .listSprintLinkedIssues(projectId, sprintId)
      .filter((issue) => issue.closeState !== "closed");

    if (linkedIssues.length === 0) {
      return { reportText: "", closed: 0, failed: 0, skipped: 0 };
    }

    if (!settings.git.autoCloseLinkedIssues) {
      return {
        reportText: `\n### Linked Issues\n- Auto-close is disabled. ${linkedIssues.length} linked issue${linkedIssues.length === 1 ? "" : "s"} left open.\n`,
        closed: 0,
        failed: 0,
        skipped: linkedIssues.length,
      };
    }

    let closed = 0;
    let failed = 0;
    const lines = ["", "### Linked Issues"];
    for (const issue of linkedIssues) {
      try {
        await this.closeRemoteIssue(issue, settings);
        this.deps.projectManagementRepository.updateSprintLinkedIssueCloseState(issue.id, {
          closeState: "closed",
          closedAt: new Date().toISOString(),
          closeError: null,
          issueState: "closed",
        });
        closed += 1;
        lines.push(`- Closed ${formatIssueReference(issue)}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.projectManagementRepository.updateSprintLinkedIssueCloseState(issue.id, {
          closeState: "close_failed",
          closeError: message,
        });
        failed += 1;
        lines.push(`- Failed to close ${formatIssueReference(issue)}: ${message}`);
        this.logger.warn("Failed to close linked issue", {
          projectId,
          sprintId,
          issueId: issue.id,
          provider: issue.provider,
          repository: issue.repository,
          issueNumber: issue.issueNumber,
          error: message,
        });
      }
    }

    return { reportText: `${lines.join("\n")}\n`, closed, failed, skipped: 0 };
  }

  private async closeRemoteIssue(issue: SprintLinkedIssueRecord, settings: DashboardSettings): Promise<void> {
    if (issue.provider === "github") {
      const token = settings.git.githubToken?.trim();
      if (!token) {
        throw new Error("GitHub token is not configured.");
      }
      await requestJson(`https://api.github.com/repos/${issue.repository}/issues/${issue.issueNumber}`, {
        method: "PATCH",
        token,
        body: { state: "closed" },
      });
      return;
    }

    const token = settings.git.gitlabToken?.trim();
    if (!token) {
      throw new Error("GitLab token is not configured.");
    }
    const baseUrl = `https://${issue.hostDomain.replace(/\/+$/, "")}/api/v4`;
    await requestJson(`${baseUrl}/projects/${encodeURIComponent(issue.repository)}/issues/${issue.issueNumber}`, {
      method: "PUT",
      token,
      gitlab: true,
      body: { state_event: "close" },
    });
  }

  private async searchGitHubIssues(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RemoteIssueSummary[]> {
    const token = args.token?.trim();
    if (!token) {
      throw new Error("GitHub token is not configured.");
    }
    const qualifiers = [
      `repo:${args.repository}`,
      "is:issue",
      args.state === "all" ? "" : `state:${args.state}`,
      ...args.labels.map((label) => `label:${quoteSearchValue(label)}`),
      args.assignee ? `assignee:${quoteSearchValue(args.assignee)}` : "",
      args.search?.trim() || "",
    ].filter(Boolean).join(" ");
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", qualifiers);
    url.searchParams.set("per_page", String(args.limit));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");

    const payload = await requestJson<{ items?: GitHubIssue[] }>(url.toString(), { token });
    return (payload.items || [])
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        provider: "github",
        hostDomain: args.hostDomain,
        repository: args.repository,
        issueNumber: issue.number,
        issueKey: `#${issue.number}`,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
        labels: (issue.labels || [])
          .map((label) => typeof label === "string" ? label : label.name)
          .filter((label): label is string => typeof label === "string" && label.trim().length > 0),
        assignees: (issue.assignees || [])
          .map((assignee) => assignee.login)
          .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
        bodyPreview: truncatePreview(issue.body || ""),
        updatedAt: issue.updated_at || null,
      }));
  }

  private async searchGitLabIssues(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RemoteIssueSummary[]> {
    const token = args.token?.trim();
    if (!token) {
      throw new Error("GitLab token is not configured.");
    }
    const baseUrl = `https://${args.hostDomain.replace(/\/+$/, "")}/api/v4`;
    const url = new URL(`${baseUrl}/projects/${encodeURIComponent(args.repository)}/issues`);
    url.searchParams.set("per_page", String(args.limit));
    if (args.state !== "all") {
      url.searchParams.set("state", args.state === "closed" ? "closed" : "opened");
    }
    if (args.search?.trim()) {
      url.searchParams.set("search", args.search.trim());
    }
    if (args.labels.length > 0) {
      url.searchParams.set("labels", args.labels.join(","));
    }
    if (args.assignee?.trim()) {
      url.searchParams.set("assignee_username", args.assignee.trim());
    }

    const payload = await requestJson<GitLabIssue[]>(url.toString(), { token, gitlab: true });
    return payload.map((issue) => ({
      provider: "gitlab",
      hostDomain: args.hostDomain,
      repository: args.repository,
      issueNumber: issue.iid,
      issueKey: `#${issue.iid}`,
      title: issue.title,
      url: issue.web_url,
      state: issue.state,
      labels: Array.isArray(issue.labels) ? issue.labels.filter((label): label is string => typeof label === "string") : [],
      assignees: (issue.assignees || [])
        .map((assignee) => assignee.username || assignee.name)
        .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
      bodyPreview: truncatePreview(issue.description || ""),
      updatedAt: issue.updated_at || null,
    }));
  }

  private requireProject(projectId: string): ProjectSummary {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }
}

interface ResolvedIssueTarget {
  provider: LinkedIssueProvider;
  hostDomain: string;
  repository: string;
}

interface SearchRuntimeOptions {
  token: string;
  search?: string;
  state: "open" | "closed" | "all";
  labels: string[];
  assignee?: string;
  limit: number;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  body?: string | null;
  updated_at?: string | null;
  pull_request?: unknown;
  labels?: Array<string | { name?: string }>;
  assignees?: Array<{ login?: string }>;
}

interface GitLabIssue {
  iid: number;
  title: string;
  web_url: string;
  state: string;
  description?: string | null;
  updated_at?: string | null;
  labels?: unknown[];
  assignees?: Array<{ username?: string; name?: string }>;
}

function resolveIssueTarget(project: ProjectSummary, input: IssueSearchInput): ResolvedIssueTarget {
  const repo = (input.repository || inferRepository(project)).trim().replace(/^\/+|\/+$/g, "");
  const provider = input.provider || project.gitProvider;
  const hostDomain = (input.hostDomain || project.gitHostDomain || defaultHostForProvider(provider)).trim().toLowerCase();
  if (provider !== "github" && provider !== "gitlab") {
    throw new Error("Select a GitHub or GitLab-backed project before importing issues.");
  }
  if (!repo) {
    throw new Error("Repository is required for issue import.");
  }
  return { provider, hostDomain, repository: repo };
}

function inferRepository(project: ProjectSummary): string {
  const metadata = resolveRepositoryHost(project.repoUrl || project.sourceRef || null);
  return metadata.repoTarget || "";
}

function defaultHostForProvider(provider: string): string {
  return provider === "gitlab" ? "gitlab.com" : "github.com";
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 30;
  }
  return Math.max(1, Math.min(100, Math.trunc(limit as number)));
}

function quoteSearchValue(value: string): string {
  const trimmed = value.trim();
  return /\s/.test(trimmed) ? `"${trimmed.replace(/"/g, "")}"` : trimmed;
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function formatIssueReference(issue: SprintLinkedIssueRecord): string {
  return `[${issue.repository}${issue.issueKey}](${issue.url})`;
}

async function requestJson<T>(url: string, options: {
  method?: string;
  token: string;
  gitlab?: boolean;
  body?: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "code-ux-dashboard",
      ...(options.gitlab ? { "PRIVATE-TOKEN": options.token } : { "Authorization": `Bearer ${options.token}` }),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return response.json() as Promise<T>;
}
