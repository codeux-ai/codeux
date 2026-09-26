import type { CreateSprintInput, ProjectSummary, RepositoryIssueSearchResult } from "../contracts/project-management-types.js";
import {
  buildGithubIntakeIdempotencyKey,
  GithubIntakeRepository,
  type GithubIntakeCandidate,
} from "../repositories/github-intake-repository.js";
import type { IssueSearchInput, SprintIssueService } from "./sprint-issue-service.js";
import { resolveRepositoryHost } from "../infrastructure/git/repository-host-resolver.js";

export interface GithubIssueIntakeServiceDeps {
  sprintIssueService: Pick<SprintIssueService, "searchIssues">;
  intakeRepository: Pick<GithubIntakeRepository, "upsertSeen" | "claimWithinCapacity" | "attachDispatch" | "setStatus" | "reconcileProjectState" | "withTransaction">;
  projectManagementRepository: {
    getProject(projectId: string): ProjectSummary | null;
    createSprint(projectId: string, input: CreateSprintInput): { id: string; name: string };
    updateSprint(sprintId: string, input: { status: "cancelled" }): unknown;
  };
  planningAgentService: {
    planSprint(projectId: string, sprintId: string, options: { autoStart: true; maxTasks: 1; clientRequestId: string }, signal?: AbortSignal): Promise<{ createdTaskIds?: string[] }>;
  };
  /** Cheap, deterministic PR observation that frees completed coding lanes. */
  reconcileDispatches?: (input: { projectId: string; repository: string; signal?: AbortSignal }) => Promise<unknown>;
}

export interface GithubIssueIntakeOptions {
  projectId: string;
  repository: string;
  requiredLabels: string[];
  excludedLabels?: string[];
  maxActiveLanes: number;
  limit?: number;
  policyVersion: string;
  signal?: AbortSignal;
}

export interface GithubIssueIntakeResult {
  searched: number;
  admitted: number;
  held: number;
  skipped: number;
  failed: number;
  dispatchedSprintIds: string[];
}

/** Deterministic, idempotent GitHub issue admission. It deliberately does no model work. */
export class GithubIssueIntakeService {
  constructor(private readonly deps: GithubIssueIntakeServiceDeps) {}

  async reconcile(options: GithubIssueIntakeOptions): Promise<GithubIssueIntakeResult> {
    const project = this.deps.projectManagementRepository.getProject(options.projectId);
    validateProjectAuthority(project, options);
    const repository = normalizeRepository(options.repository);
    const required = options.requiredLabels.map(normalizeLabel).filter(Boolean);
    if (required.length === 0) {
      throw new Error("GitHub issue intake requires at least one explicit allow label.");
    }
    if (!options.policyVersion.trim()) throw new Error("GitHub issue intake requires a policy version.");
    if (!Number.isFinite(options.maxActiveLanes) || options.maxActiveLanes < 1) {
      throw new Error("GitHub issue intake requires a positive maxActiveLanes value.");
    }
    const limit = clampLimit(options.limit);
    const maxActiveLanes = Math.max(1, Math.min(2, Math.trunc(options.maxActiveLanes)));
    const orphanedBefore = new Date(Date.now() - 15 * 60_000).toISOString();
    await this.deps.reconcileDispatches?.({
      projectId: options.projectId,
      repository,
      signal: options.signal,
    });
    this.deps.intakeRepository.reconcileProjectState(options.projectId, repository, orphanedBefore);
    const input: IssueSearchInput = {
      provider: "github",
      repository,
      state: "open",
      labels: options.requiredLabels,
      sortField: "updated",
      sortDirection: "desc",
      limit,
    };
    const issues = await this.deps.sprintIssueService.searchIssues(options.projectId, input);
    const result: GithubIssueIntakeResult = {
      searched: issues.length,
      admitted: 0,
      held: 0,
      skipped: 0,
      failed: 0,
      dispatchedSprintIds: [],
    };
    const excluded = new Set((options.excludedLabels ?? []).map(normalizeLabel));
    for (const issue of issues) {
      options.signal?.throwIfAborted();
      if (!issueMatchesBoundRepository(issue, repository)) {
        const foreign = toCandidate(options.projectId, issue, options.policyVersion, repository);
        const held = this.deps.intakeRepository.upsertSeen({ ...foreign, disposition: "foreign_repository_observation", status: "held" });
        this.deps.intakeRepository.setStatus(held.id, "held", "foreign_repository_observation");
        result.held += 1;
        continue;
      }
      const labels = (issue.labels ?? []).map(normalizeLabel);
      const candidate = toCandidate(options.projectId, issue, options.policyVersion, repository);
      const key = buildGithubIntakeIdempotencyKey(candidate);
      if (excluded.size > 0 && labels.some((label) => excluded.has(label))) {
        const item = this.deps.intakeRepository.upsertSeen(candidate);
        this.deps.intakeRepository.setStatus(item.id, "held", "excluded_label");
        result.held += 1;
        continue;
      }
      if (required.some((label) => !labels.includes(label))) {
        result.skipped += 1;
        continue;
      }
      if (!issue.updatedAt) {
        const item = this.deps.intakeRepository.upsertSeen(candidate);
        this.deps.intakeRepository.setStatus(item.id, "held", "missing_observed_version");
        result.held += 1;
        continue;
      }

      const observed = this.deps.intakeRepository.upsertSeen(candidate);
      const claimResult = this.deps.intakeRepository.claimWithinCapacity(
        observed.id,
        options.projectId,
        repository,
        maxActiveLanes,
      );
      if (claimResult.status !== "claimed") {
        result.skipped += 1;
        continue;
      }
      const claim = claimResult.item;
      let createdSprint: { id: string; name: string } | undefined;
      try {
        createdSprint = this.deps.intakeRepository.withTransaction(() => {
          options.signal?.throwIfAborted();
          const sprint = this.deps.projectManagementRepository.createSprint(options.projectId, {
            name: `Issue ${issue.issueNumber}: ${issue.title}`,
            originalPrompt: issue.title,
            goal: issue.bodyPreview || issue.title,
            showcasePinned: false,
            linkedIssues: [{
              ...issue,
              issueNumber: issue.issueNumber,
              issueKey: issue.issueKey,
              metadata: { ...(issue.metadata ?? {}), intakeIdempotencyKey: key, policyVersion: options.policyVersion },
            }],
          });
          this.deps.intakeRepository.attachDispatch(claim.id, { sprintId: sprint.id });
          return sprint;
        });
        options.signal?.throwIfAborted();
        const planned = await this.deps.planningAgentService.planSprint(options.projectId, createdSprint.id, {
          autoStart: true,
          maxTasks: 1,
          clientRequestId: `github-intake:${key}`,
        }, options.signal);
        if (!Array.isArray(planned.createdTaskIds) || planned.createdTaskIds.length === 0) {
          throw new Error("Planning produced no executable tasks.");
        }
        result.admitted += 1;
        result.dispatchedSprintIds.push(createdSprint.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          if (createdSprint) {
            this.deps.projectManagementRepository.updateSprint(createdSprint.id, { status: "cancelled" });
          }
        } catch {
          // Preserve the original planning error in the intake ledger even if cleanup fails.
        }
        this.deps.intakeRepository.setStatus(claim.id, "failed", "dispatch_failed", message);
        result.failed += 1;
      }
    }
    return result;
  }
}

function validateProjectAuthority(project: ProjectSummary | null, options: GithubIssueIntakeOptions): void {
  if (!project) throw new Error(`Project not found: ${options.projectId}`);
  if (project.gitProvider !== "github") {
    throw new Error("GitHub issue intake requires a GitHub-backed project.");
  }
  const configured = resolveRepositoryHost(project.repoUrl || project.sourceRef || null);
  const requested = normalizeRepository(options.repository);
  const bound = normalizeRepository(configured.repoTarget || "");
  const host = (configured.hostDomain || project.gitHostDomain || "github.com").toLowerCase();
  if (configured.provider !== "github" || host !== "github.com" || !bound || requested !== bound) {
    throw new Error("GitHub issue intake repository must exactly match the selected project's GitHub repository.");
  }
}

function normalizeRepository(value: string): string {
  return value.trim().replace(/^https?:\/\/[^/]+\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function clampLimit(value: number | undefined): number {
  return Math.max(1, Math.min(100, Math.trunc(value ?? 25)));
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function issueMatchesBoundRepository(issue: RepositoryIssueSearchResult, repository: string): boolean {
  const expected = normalizeRepository(repository);
  if (normalizeRepository(issue.repository) !== expected || (issue.hostDomain || "github.com").toLowerCase() !== "github.com") return false;
  try {
    const url = new URL(issue.url);
    const path = url.pathname.replace(/\/$/, "").toLowerCase();
    return url.protocol === "https:" && url.hostname.toLowerCase() === "github.com" &&
      path === `/${expected}/issues/${issue.issueNumber}` && !url.username && !url.password;
  } catch {
    return false;
  }
}

function toCandidate(projectId: string, issue: RepositoryIssueSearchResult, policyVersion: string, repository: string): GithubIntakeCandidate {
  return {
    projectId,
    provider: "github",
    hostDomain: issue.hostDomain || "github.com",
    repository,
    externalKind: "issue",
    externalNumber: issue.issueNumber ?? 0,
    observedVersion: issue.updatedAt ?? "unknown",
    actionClass: "implement",
    policyVersion,
    title: issue.title,
    url: issue.url,
    labels: issue.labels ?? [],
    payload: { issueKey: issue.issueKey, state: issue.state },
  };
}
