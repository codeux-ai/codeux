import { execFile } from "child_process";
import type {
  GitTrackingScope,
  GitTrackingStatus,
  GitPullRequestStatus,
  GitCiRunStatus,
  GitMergeStatus,
  GitTrackingTarget,
} from "./types.js";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface CommandContext {
  cwd: string;
  ghToken?: string;
}

type CommandRunner = (command: string, args: string[], context: CommandContext) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 8000;

const defaultRunner: CommandRunner = (command, args, context) =>
  new Promise((resolve) => {
    const env = context.ghToken && command === "gh"
      ? { ...process.env, GH_TOKEN: context.ghToken, GITHUB_TOKEN: context.ghToken }
      : process.env;
    execFile(command, args, { cwd: context.cwd, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stdout: String(stdout || ""), stderr: String(stderr || error.message || "") });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });

const parseJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const toInt = (value: unknown): number | null => (typeof value === "number" ? value : null);
const toStr = (value: unknown): string | null => (typeof value === "string" ? value : null);

export interface GitTrackingRequest {
  scope: GitTrackingScope;
  featureBranch?: string | null;
  defaultBranch?: string | null;
  featureBranchPrefix?: string | null;
}

const normalizeBranch = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildTrackingTarget = (request?: GitTrackingRequest): GitTrackingTarget => {
  const scope = request?.scope ?? "REPOSITORY";
  const featureBranch = normalizeBranch(request?.featureBranch);
  const defaultBranch = normalizeBranch(request?.defaultBranch);

  switch (scope) {
    case "FEATURE_PR_CI":
      return {
        scope,
        label: featureBranch ? `Feature PR CI (${featureBranch})` : "Feature PR CI",
        branch: featureBranch,
      };
    case "MAIN_MERGE_PR_CI":
      return {
        scope,
        label: featureBranch && defaultBranch
          ? `Main Merge PR CI (${featureBranch} -> ${defaultBranch})`
          : "Main Merge PR CI",
        branch: defaultBranch,
      };
    case "MAIN_BRANCH_CI":
      return {
        scope,
        label: defaultBranch ? `Main Branch CI (${defaultBranch})` : "Main Branch CI",
        branch: defaultBranch,
      };
    default:
      return {
        scope: "REPOSITORY",
        label: "Repository-wide",
        branch: null,
      };
  }
};

export class GitStatusService {
  constructor(
    private readonly repoPath: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {}

  private async run(command: string, args: string[], ghToken?: string): Promise<CommandResult> {
    return this.runner(command, args, { cwd: this.repoPath, ghToken });
  }

  private filterOpenPrs(prs: GitPullRequestStatus[], tracking?: GitTrackingRequest): GitPullRequestStatus[] {
    if (!tracking) {
      return prs;
    }

    const featureBranch = normalizeBranch(tracking.featureBranch);
    const defaultBranch = normalizeBranch(tracking.defaultBranch);

    switch (tracking.scope) {
      case "FEATURE_PR_CI":
        return featureBranch
          ? prs.filter((pr) => normalizeBranch(pr.baseRefName) === featureBranch)
          : prs;
      case "MAIN_MERGE_PR_CI":
        if (!featureBranch || !defaultBranch) {
          return prs;
        }
        return prs.filter((pr) =>
          normalizeBranch(pr.baseRefName) === defaultBranch &&
          normalizeBranch(pr.headRefName) === featureBranch
        );
      case "MAIN_BRANCH_CI":
        return defaultBranch
          ? prs.filter((pr) => normalizeBranch(pr.baseRefName) === defaultBranch)
          : prs;
      default:
        return prs;
    }
  }

  private filterCiRuns(
    runs: GitCiRunStatus[],
    trackedPrs: GitPullRequestStatus[],
    tracking?: GitTrackingRequest
  ): GitCiRunStatus[] {
    if (!tracking) {
      return runs;
    }

    if (tracking.scope === "MAIN_BRANCH_CI") {
      const defaultBranch = normalizeBranch(tracking.defaultBranch);
      return defaultBranch
        ? runs.filter((run) => normalizeBranch(run.headBranch) === defaultBranch)
        : runs;
    }

    if (tracking.scope === "FEATURE_PR_CI") {
      const featureBranch = normalizeBranch(tracking.featureBranch);
      if (featureBranch) {
        return runs.filter((run) => normalizeBranch(run.headBranch) === featureBranch);
      }
      const trackedHeads = new Set(
        trackedPrs
          .map((pr) => normalizeBranch(pr.headRefName))
          .filter((value): value is string => value !== null)
      );
      if (trackedHeads.size === 0) {
        return [];
      }
      return runs.filter((run) => {
        const headBranch = normalizeBranch(run.headBranch);
        return headBranch ? trackedHeads.has(headBranch) : false;
      });
    }

    if (tracking.scope === "MAIN_MERGE_PR_CI") {
      const trackedHeads = new Set(
        trackedPrs
          .map((pr) => normalizeBranch(pr.headRefName))
          .filter((value): value is string => value !== null)
      );
      if (trackedHeads.size === 0) {
        return [];
      }
      return runs.filter((run) => {
        const headBranch = normalizeBranch(run.headBranch);
        return headBranch ? trackedHeads.has(headBranch) : false;
      });
    }

    return runs;
  }

  private filterMergedPrs(merged: GitMergeStatus[], tracking?: GitTrackingRequest): GitMergeStatus[] {
    if (!tracking) {
      return merged;
    }

    const defaultBranch = normalizeBranch(tracking.defaultBranch);
    const featureBranch = normalizeBranch(tracking.featureBranch);
    const featurePrefix = normalizeBranch(tracking.featureBranchPrefix);
    if (!defaultBranch && !featureBranch && !featurePrefix) {
      return merged;
    }

    return merged.filter((pr) => {
      const base = normalizeBranch(pr.baseRefName);
      if (!base) {
        return false;
      }
      if (defaultBranch && base === defaultBranch) {
        return true;
      }
      if (featureBranch && base === featureBranch) {
        return true;
      }
      return featurePrefix ? base.startsWith(featurePrefix) : false;
    });
  }

  async getStatus(mode: "REMOTE" | "LOCAL", ghToken?: string, trackingRequest?: GitTrackingRequest): Promise<GitTrackingStatus> {
    const effectiveToken = ghToken && ghToken.trim().length > 0 ? ghToken.trim() : undefined;
    const warnings: string[] = [];
    const now = new Date().toISOString();
    const tracking = buildTrackingTarget(trackingRequest);

    const gitRepoCheck = await this.run("git", ["rev-parse", "--is-inside-work-tree"], effectiveToken);
    if (!gitRepoCheck.ok || gitRepoCheck.stdout.trim() !== "true") {
      return {
        mode,
        available: false,
        repositoryRoot: null,
        branch: null,
        hasRemote: false,
        dirty: false,
        openPullRequests: [],
        ciRuns: [],
        mergedPullRequests: [],
        tracking,
        warnings: ["Current workspace is not a git repository."],
        lastUpdated: now,
      };
    }

    const rootResult = await this.run("git", ["rev-parse", "--show-toplevel"], effectiveToken);
    const branchResult = await this.run("git", ["branch", "--show-current"], effectiveToken);
    const remoteResult = await this.run("git", ["remote"], effectiveToken);
    const dirtyResult = await this.run("git", ["status", "--porcelain"], effectiveToken);

    const repositoryRoot = rootResult.ok ? rootResult.stdout.trim() : null;
    const branch = branchResult.ok ? branchResult.stdout.trim() || null : null;
    const hasRemote = remoteResult.ok && remoteResult.stdout.trim().length > 0;
    const dirty = dirtyResult.ok && dirtyResult.stdout.trim().length > 0;

    if (!hasRemote && mode === "REMOTE") {
      warnings.push("Remote mode is selected but no git remote is configured.");
    }

    if (mode === "LOCAL") {
      return {
        mode,
        available: true,
        repositoryRoot,
        branch,
        hasRemote,
        dirty,
        openPullRequests: [],
        ciRuns: [],
        mergedPullRequests: [],
        tracking,
        warnings: hasRemote
          ? ["Local mode active: PR and CI tracking via GitHub is disabled."]
          : ["Local mode active without remote repository."],
        lastUpdated: now,
      };
    }

    const ghVersion = await this.run("gh", ["--version"], effectiveToken);
    if (!ghVersion.ok) {
      return {
        mode,
        available: false,
        repositoryRoot,
        branch,
        hasRemote,
        dirty,
        openPullRequests: [],
        ciRuns: [],
        mergedPullRequests: [],
        tracking,
        warnings: ["GitHub CLI (gh) is not available. Remote mode cannot fetch PR/CI status."],
        lastUpdated: now,
      };
    }

    const authStatus = await this.run("gh", ["auth", "status"], effectiveToken);
    if (!authStatus.ok) {
      warnings.push("GitHub CLI is not authenticated. Remote tracking may be unavailable.");
    }

    const prs = await this.fetchOpenPrs(effectiveToken);
    if (prs.warning) warnings.push(prs.warning);
    const ciRuns = await this.fetchCiRuns(effectiveToken);
    if (ciRuns.warning) warnings.push(ciRuns.warning);
    const merged = await this.fetchMergedPrs(effectiveToken);
    if (merged.warning) warnings.push(merged.warning);

    const trackedPrs = this.filterOpenPrs(prs.data, trackingRequest);
    const trackedCiRuns = this.filterCiRuns(ciRuns.data, trackedPrs, trackingRequest);
    const trackedMergedPrs = this.filterMergedPrs(merged.data, trackingRequest);

    if (trackedPrs.some((pr) => pr.mergeStateStatus === "DIRTY")) {
      warnings.push("One or more PRs have merge conflicts (DIRTY). If CI checks do not start on main, inspect merge conflicts.");
    }
    if (trackedCiRuns.length === 0 && trackedPrs.length > 0) {
      warnings.push("No CI runs found for active PRs. Check workflow triggers and potential merge conflicts.");
    }
    if (tracking.scope === "FEATURE_PR_CI" && trackedPrs.length === 0) {
      warnings.push("No open PRs are currently targeting the active feature branch.");
    }
    if (tracking.scope === "MAIN_MERGE_PR_CI" && trackedPrs.length === 0) {
      warnings.push("No open PR found for merging the feature branch into main.");
    }

    return {
      mode,
      available: true,
      repositoryRoot,
      branch,
      hasRemote,
      dirty,
      openPullRequests: trackedPrs,
      ciRuns: trackedCiRuns,
      mergedPullRequests: trackedMergedPrs,
      tracking,
      warnings,
      lastUpdated: now,
    };
  }

  async mergePullRequest(prNumber: number, ghToken?: string): Promise<{ ok: boolean; message?: string }> {
    const effectiveToken = ghToken && ghToken.trim().length > 0 ? ghToken.trim() : undefined;
    const result = await this.run("gh", ["pr", "merge", String(prNumber), "--merge", "--delete-branch"], effectiveToken);
    if (!result.ok) {
      return {
        ok: false,
        message: result.stderr.trim() || result.stdout.trim() || "Failed to merge PR via gh CLI.",
      };
    }
    return { ok: true };
  }

  private async fetchOpenPrs(ghToken?: string): Promise<{ data: GitPullRequestStatus[]; warning?: string }> {
    const result = await this.run("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup",
    ], ghToken);
    if (!result.ok) {
      return { data: [], warning: "Failed to fetch open pull requests via gh CLI." };
    }

    const parsed = parseJson<Array<Record<string, unknown>>>(result.stdout);
    if (!parsed) {
      return { data: [], warning: "Could not parse pull request status response." };
    }

    const data: GitPullRequestStatus[] = parsed.map((item) => {
      const rollup = Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : [];
      const checks = rollup
        .map((check) => {
          if (!check || typeof check !== "object") return null;
          const candidate = check as Record<string, unknown>;
          const name = toStr(candidate.name) || toStr(candidate.context) || "check";
          const status = toStr(candidate.status) || "UNKNOWN";
          const conclusion = toStr(candidate.conclusion);
          return { name, status, conclusion };
        })
        .filter((check): check is { name: string; status: string; conclusion: string | null } => check !== null);

      const commentsObj = (item.comments && typeof item.comments === "object")
        ? (item.comments as Record<string, unknown>)
        : null;
      const commentsFromObject = commentsObj ? toInt(commentsObj.totalCount) : null;
      const commentsFromNumber = toInt(item.comments);
      const comments = commentsFromNumber ?? commentsFromObject ?? 0;

      return {
        number: toInt(item.number) ?? 0,
        title: toStr(item.title) ?? "Untitled PR",
        url: toStr(item.url) ?? "",
        state: toStr(item.state) ?? "UNKNOWN",
        isDraft: item.isDraft === true,
        headRefName: toStr(item.headRefName),
        baseRefName: toStr(item.baseRefName),
        mergeStateStatus: toStr(item.mergeStateStatus),
        reviewDecision: toStr(item.reviewDecision),
        updatedAt: toStr(item.updatedAt),
        comments,
        checks,
      };
    });

    return { data };
  }

  private async fetchCiRuns(ghToken?: string): Promise<{ data: GitCiRunStatus[]; warning?: string }> {
    const result = await this.run("gh", [
      "run",
      "list",
      "--limit",
      "50",
      "--json",
      "databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt",
    ], ghToken);
    if (!result.ok) {
      return { data: [], warning: "Failed to fetch GitHub Actions runs via gh CLI." };
    }

    const parsed = parseJson<Array<Record<string, unknown>>>(result.stdout);
    if (!parsed) {
      return { data: [], warning: "Could not parse CI run response." };
    }

    const data: GitCiRunStatus[] = parsed.map((item) => ({
      id: toInt(item.databaseId),
      name: toStr(item.name) ?? "workflow",
      workflowName: toStr(item.workflowName),
      status: toStr(item.status) ?? "UNKNOWN",
      conclusion: toStr(item.conclusion),
      event: toStr(item.event),
      headBranch: toStr(item.headBranch),
      url: toStr(item.url) ?? "",
      updatedAt: toStr(item.updatedAt),
    }));

    return { data };
  }

  private async fetchMergedPrs(ghToken?: string): Promise<{ data: GitMergeStatus[]; warning?: string }> {
    const result = await this.run("gh", [
      "pr",
      "list",
      "--state",
      "merged",
      "--limit",
      "100",
      "--json",
      "number,title,url,headRefName,baseRefName,mergedAt,mergedBy",
    ], ghToken);
    if (!result.ok) {
      return { data: [], warning: "Failed to fetch recently merged pull requests via gh CLI." };
    }

    const parsed = parseJson<Array<Record<string, unknown>>>(result.stdout);
    if (!parsed) {
      return { data: [], warning: "Could not parse merged PR response." };
    }

    const data: GitMergeStatus[] = parsed.map((item) => {
      const mergedByObj = (item.mergedBy && typeof item.mergedBy === "object")
        ? (item.mergedBy as Record<string, unknown>)
        : null;
      return {
        number: toInt(item.number) ?? 0,
        title: toStr(item.title) ?? "Merged PR",
        url: toStr(item.url) ?? "",
        headRefName: toStr(item.headRefName),
        baseRefName: toStr(item.baseRefName),
        mergedAt: toStr(item.mergedAt),
        mergedBy: mergedByObj ? toStr(mergedByObj.login) : null,
      };
    });

    return { data };
  }
}
