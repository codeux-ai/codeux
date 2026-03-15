import type {
  GitTrackingStatus,
  GitPullRequestStatus,
  GitCiFailedJob,
  GitCiRunStatus,
  GitMergeStatus,
  AutoMergeFeaturePrResult,
} from "../contracts/app-types.js";
import {
  GitStatusQueryClient,
  CommandRunner,
  defaultRunner,
} from "../infrastructure/git/git-status-query-client.js";
import {
  parseOpenPrs,
  parseCiRuns,
  parseMergedPrs,
  parseJson,
  toStr,
  toInt,
} from "../infrastructure/git/git-status-mappers.js";
import {
  GitTrackingRequest,
  buildTrackingTarget,
  filterOpenPrs,
  filterCiRuns,
  sortCiRunsNewestFirst,
  isRunFailed,
  isFailedConclusion,
  trimLogExcerpt,
  filterMergedPrs,
} from "../infrastructure/git/git-status-policy.js";

export type { GitTrackingRequest };

const FAILED_RUN_DETAILS_LIMIT = 3;
const FAILED_JOBS_PER_RUN_LIMIT = 3;

function detectMergeConflictMessage(message: string | null | undefined): boolean {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes("merge conflict")
    || normalized.includes("not mergeable")
    || normalized.includes("cannot be cleanly created")
    || normalized.includes("dirty");
}

export class GitStatusService {
  private static statusCache = new Map<string, { timestamp: number; promise: Promise<GitTrackingStatus> }>();

  public static invalidateCache(repoPath?: string): void {
    if (repoPath) {
      for (const key of GitStatusService.statusCache.keys()) {
        if (key.includes(`"repoPath":"${repoPath}"`)) {
          GitStatusService.statusCache.delete(key);
        }
      }
    } else {
      GitStatusService.statusCache.clear();
    }
  }

  private queryClient: GitStatusQueryClient;

  constructor(
    private readonly repoPath: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {
    this.queryClient = new GitStatusQueryClient(this.repoPath, this.runner);
  }

  private async fetchFailedJobLogExcerpt(
    runId: number,
    jobId: number,
    ghToken?: string
  ): Promise<{ logExcerpt: string | null; warning?: string }> {
    const result = await this.queryClient.ghRunViewLogFailed(runId, jobId, ghToken);
    if (!result.ok) {
      return { logExcerpt: null, warning: `Failed to fetch failed-job logs for run ${runId}, job ${jobId}.` };
    }
    const stdout = result.stdout.trim();
    if (stdout.length === 0) {
      return { logExcerpt: null };
    }
    return { logExcerpt: trimLogExcerpt(stdout) };
  }

  private async fetchFailedRunJobs(
    runId: number,
    ghToken?: string
  ): Promise<{ failedJobs: GitCiFailedJob[]; warnings: string[] }> {
    const warnings: string[] = [];
    const result = await this.queryClient.ghRunViewJobs(runId, ghToken);
    if (!result.ok) {
      return { failedJobs: [], warnings: [`Failed to fetch failed jobs for run ${runId}.`] };
    }

    const parsed = parseJson<Record<string, unknown>>(result.stdout);
    const rawJobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    const failedJobs: GitCiFailedJob[] = [];
    for (const rawJob of rawJobs) {
      if (!rawJob || typeof rawJob !== "object") {
        continue;
      }
      const job = rawJob as Record<string, unknown>;
      const steps = Array.isArray(job.steps) ? job.steps : [];
      const failedSteps = steps
        .map((rawStep) => {
          if (!rawStep || typeof rawStep !== "object") {
            return null;
          }
          const step = rawStep as Record<string, unknown>;
          const stepConclusion = toStr(step.conclusion);
          if (!isFailedConclusion(stepConclusion)) {
            return null;
          }
          return toStr(step.name) || "failed step";
        })
        .filter((step): step is string => step !== null);

      const conclusion = toStr(job.conclusion);
      const hasFailure = isFailedConclusion(conclusion) || failedSteps.length > 0;
      if (!hasFailure) {
        continue;
      }

      const jobId = toInt(job.databaseId) ?? toInt(job.id);
      const failedJob: GitCiFailedJob = {
        id: jobId,
        name: toStr(job.name) || "failed job",
        conclusion,
        failedSteps,
        logExcerpt: null,
        logCommand: jobId !== null ? `gh run view ${runId} --job ${jobId} --log-failed` : null,
      };

      if (jobId !== null && failedJobs.length < FAILED_JOBS_PER_RUN_LIMIT) {
        const logResult = await this.fetchFailedJobLogExcerpt(runId, jobId, ghToken);
        failedJob.logExcerpt = logResult.logExcerpt;
        if (logResult.warning) {
          warnings.push(logResult.warning);
        }
      }

      failedJobs.push(failedJob);
      if (failedJobs.length >= FAILED_JOBS_PER_RUN_LIMIT) {
        break;
      }
    }

    return { failedJobs, warnings };
  }

  private async enrichFailedRunDetails(
    runs: GitCiRunStatus[],
    ghToken?: string
  ): Promise<{ runs: GitCiRunStatus[]; warnings: string[] }> {
    const warnings: string[] = [];
    const failedCandidates = runs
      .filter((run) => run.id !== null && isRunFailed(run))
      .slice(0, FAILED_RUN_DETAILS_LIMIT);
    if (failedCandidates.length === 0) {
      return { runs, warnings };
    }

    const failedJobsByRunId = new Map<number, GitCiFailedJob[]>();

    // Process up to FAILED_RUN_DETAILS_LIMIT concurrently
    const CONCURRENCY_LIMIT = FAILED_RUN_DETAILS_LIMIT;
    let i = 0;
    const executeNext = async (): Promise<void> => {
      while (i < failedCandidates.length) {
        const runId = failedCandidates[i++].id as number;
        const details = await this.fetchFailedRunJobs(runId, ghToken);
        if (details.warnings.length > 0) {
          warnings.push(...details.warnings);
        }
        failedJobsByRunId.set(runId, details.failedJobs);
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, failedCandidates.length) }, () => executeNext());
    await Promise.all(workers);

    const enrichedRuns = runs.map((run) => {
      if (run.id === null) {
        return run;
      }
      const failedJobs = failedJobsByRunId.get(run.id);
      if (!failedJobs) {
        return run;
      }
      return {
        ...run,
        failedJobs,
      };
    });

    return { runs: enrichedRuns, warnings };
  }

  async getStatus(mode: "REMOTE" | "LOCAL", ghToken?: string, trackingRequest?: GitTrackingRequest, cacheTtlMs?: number): Promise<GitTrackingStatus> {
    const effectiveToken = ghToken && ghToken.trim().length > 0 ? ghToken.trim() : undefined;
    const cacheKey = JSON.stringify({ repoPath: this.repoPath, mode, token: effectiveToken, trackingRequest });

    if (cacheTtlMs && cacheTtlMs > 0) {
      const cached = GitStatusService.statusCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
        return cached.promise;
      }
    }

    const fetchPromise = (async () => {
      const warnings: string[] = [];
    const now = new Date().toISOString();
    const tracking = buildTrackingTarget(trackingRequest);

    const gitRepoCheck = await this.queryClient.gitRevParseIsInsideWorkTree(effectiveToken);
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

    const rootResult = await this.queryClient.gitRevParseShowToplevel(effectiveToken);
    const branchResult = await this.queryClient.gitBranchShowCurrent(effectiveToken);
    const remoteResult = await this.queryClient.gitRemote(effectiveToken);
    const dirtyResult = await this.queryClient.gitStatusPorcelain(effectiveToken);

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

    const ghVersion = await this.queryClient.ghVersion(effectiveToken);
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

    const authStatus = await this.queryClient.ghAuthStatus(effectiveToken);
    if (!authStatus.ok) {
      warnings.push("GitHub CLI is not authenticated. Remote tracking may be unavailable.");
    }

    const [prs, ciRuns, merged] = await Promise.all([
      this.fetchOpenPrs(effectiveToken),
      this.fetchCiRuns(effectiveToken),
      this.fetchMergedPrs(effectiveToken)
    ]);
    if (prs.warning) warnings.push(prs.warning);
    if (ciRuns.warning) warnings.push(ciRuns.warning);
    if (merged.warning) warnings.push(merged.warning);

    const trackedPrs = filterOpenPrs(prs.data, trackingRequest);
    const trackedCiRuns = sortCiRunsNewestFirst(filterCiRuns(ciRuns.data, trackedPrs, trackingRequest));
    const enrichedCiRuns = await this.enrichFailedRunDetails(trackedCiRuns, effectiveToken);
    if (enrichedCiRuns.warnings.length > 0) {
      warnings.push(...enrichedCiRuns.warnings);
    }
    const trackedMergedPrs = filterMergedPrs(merged.data, trackingRequest);

    if (trackedPrs.some((pr) => pr.mergeStateStatus === "DIRTY")) {
      warnings.push("One or more PRs have merge conflicts (DIRTY). If CI checks do not start on main, inspect merge conflicts.");
    }
    if (enrichedCiRuns.runs.length === 0 && trackedPrs.length > 0) {
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
        ciRuns: enrichedCiRuns.runs,
        mergedPullRequests: trackedMergedPrs,
        tracking,
        warnings,
        lastUpdated: now,
      };
    })();

    if (cacheTtlMs && cacheTtlMs > 0) {
      GitStatusService.statusCache.set(cacheKey, { timestamp: Date.now(), promise: fetchPromise });
    }

    return fetchPromise;
  }

  async mergePullRequest(prNumber: number, ghToken?: string): Promise<AutoMergeFeaturePrResult> {
    const effectiveToken = ghToken && ghToken.trim().length > 0 ? ghToken.trim() : undefined;
    const result = await this.queryClient.ghPrMerge(prNumber, effectiveToken);
    if (!result.ok) {
      const message = result.stderr.trim() || result.stdout.trim() || "Failed to merge PR via gh CLI.";
      return {
        ok: false,
        message,
        mergeConflict: detectMergeConflictMessage(message),
      };
    }
    GitStatusService.invalidateCache(this.repoPath);

    const [openPrs, mergedPrs] = await Promise.all([
      this.fetchOpenPrs(effectiveToken),
      this.fetchMergedPrs(effectiveToken),
    ]);
    const merged = mergedPrs.data.some((pr) => pr.number === prNumber);
    if (merged) {
      return { ok: true, merged: true, autoMergeScheduled: false };
    }

    const openPr = openPrs.data.find((pr) => pr.number === prNumber);
    if (openPr) {
      return {
        ok: true,
        merged: false,
        autoMergeScheduled: true,
        message: "The PR is still open after the merge command. Auto-merge is likely armed or waiting on branch protection.",
      };
    }

    const confirmationWarnings = [openPrs.warning, mergedPrs.warning].filter((warning): warning is string => Boolean(warning));
    const commandOutput = [
      typeof result.stdout === "string" ? result.stdout.trim() : "",
      typeof result.stderr === "string" ? result.stderr.trim() : "",
    ].filter(Boolean).join(" ").trim();
    return {
      ok: true,
      merged: false,
      autoMergeScheduled: false,
      message: confirmationWarnings[0] || commandOutput || "Merge command completed, but Sprint OS could not confirm the PR merge yet.",
    };
  }

  private async fetchOpenPrs(ghToken?: string): Promise<{ data: GitPullRequestStatus[]; warning?: string }> {
    const result = await this.queryClient.ghPrListOpen(ghToken);
    if (!result.ok) {
      return { data: [], warning: "Failed to fetch open pull requests via gh CLI." };
    }
    return parseOpenPrs(result.stdout);
  }

  private async fetchCiRuns(ghToken?: string): Promise<{ data: GitCiRunStatus[]; warning?: string }> {
    const result = await this.queryClient.ghRunList(ghToken);
    if (!result.ok) {
      return { data: [], warning: "Failed to fetch GitHub Actions runs via gh CLI." };
    }
    return parseCiRuns(result.stdout);
  }

  private async fetchMergedPrs(ghToken?: string): Promise<{ data: GitMergeStatus[]; warning?: string }> {
    const result = await this.queryClient.ghPrListMerged(ghToken);
    if (!result.ok) {
      return { data: [], warning: "Failed to fetch recently merged pull requests via gh CLI." };
    }
    return parseMergedPrs(result.stdout);
  }
}
