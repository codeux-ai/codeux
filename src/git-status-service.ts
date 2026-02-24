import { execFile } from "child_process";
import type { GitTrackingStatus, GitPullRequestStatus, GitCiRunStatus, GitMergeStatus } from "./types.js";

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

export class GitStatusService {
  constructor(
    private readonly repoPath: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {}

  private async run(command: string, args: string[], ghToken?: string): Promise<CommandResult> {
    return this.runner(command, args, { cwd: this.repoPath, ghToken });
  }

  async getStatus(mode: "REMOTE" | "LOCAL", ghToken?: string): Promise<GitTrackingStatus> {
    const effectiveToken = ghToken && ghToken.trim().length > 0 ? ghToken.trim() : undefined;
    const warnings: string[] = [];
    const now = new Date().toISOString();

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

    if (prs.data.some((pr) => pr.mergeStateStatus === "DIRTY")) {
      warnings.push("One or more PRs have merge conflicts (DIRTY). If CI checks do not start on main, inspect merge conflicts.");
    }
    if (ciRuns.data.length === 0 && prs.data.length > 0) {
      warnings.push("No CI runs found for active PRs. Check workflow triggers and potential merge conflicts.");
    }

    return {
      mode,
      available: true,
      repositoryRoot,
      branch,
      hasRemote,
      dirty,
      openPullRequests: prs.data,
      ciRuns: ciRuns.data,
      mergedPullRequests: merged.data,
      warnings,
      lastUpdated: now,
    };
  }

  private async fetchOpenPrs(ghToken?: string): Promise<{ data: GitPullRequestStatus[]; warning?: string }> {
    const result = await this.run("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "20",
      "--json",
      "number,title,url,state,isDraft,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup",
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
      const comments = commentsObj ? (toInt(commentsObj.totalCount) ?? 0) : 0;

      return {
        number: toInt(item.number) ?? 0,
        title: toStr(item.title) ?? "Untitled PR",
        url: toStr(item.url) ?? "",
        state: toStr(item.state) ?? "UNKNOWN",
        isDraft: item.isDraft === true,
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
      "20",
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
      "10",
      "--json",
      "number,title,url,mergedAt,mergedBy",
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
        mergedAt: toStr(item.mergedAt),
        mergedBy: mergedByObj ? toStr(mergedByObj.login) : null,
      };
    });

    return { data };
  }
}
