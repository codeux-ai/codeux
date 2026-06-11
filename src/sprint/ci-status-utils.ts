import type { GitCiRunStatus, GitTrackingStatus } from "../contracts/app-types.js";

export const isCiFailure = (status: string, conclusion: string | null): boolean => {
  const normalizedStatus = status.toLowerCase();
  const normalizedConclusion = (conclusion || "").toLowerCase();
  if (normalizedStatus !== "completed") {
    return false;
  }
  return normalizedConclusion.length > 0 && normalizedConclusion !== "success" && normalizedConclusion !== "neutral" && normalizedConclusion !== "skipped";
};

export const isCiCheckFailed = isCiFailure;

export const isCiPending = (status: string, conclusion: string | null): boolean => {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus !== "completed") {
    return true;
  }
  return conclusion === null;
};

export const isCiCheckPending = isCiPending;

/**
 * Derives check-shaped entries (`{ name, status, conclusion }`) from the workflow runs of a
 * branch when a PR reports no checks of its own. The PR list endpoints of some providers
 * (GitLab, the GitHub REST fallback) never include a status-check rollup, which would otherwise
 * leave the CI gate waiting forever on `checks.length === 0`. Only the newest run per workflow
 * counts — older runs of the same workflow are superseded.
 */
export const deriveChecksFromCiRuns = (
  gitStatus: GitTrackingStatus,
  branchName: string | null | undefined,
): Array<{ name: string; status: string; conclusion: string | null }> => {
  if (!branchName) {
    return [];
  }
  const runs = Array.isArray(gitStatus.ciRuns) ? gitStatus.ciRuns : [];
  const newestPerWorkflow = new Map<string, GitCiRunStatus>();
  for (const run of runs) {
    if (run.headBranch !== branchName) {
      continue;
    }
    const workflowKey = run.workflowName || run.name;
    const existing = newestPerWorkflow.get(workflowKey);
    if (!existing || (run.updatedAt || "") > (existing.updatedAt || "")) {
      newestPerWorkflow.set(workflowKey, run);
    }
  }
  return Array.from(newestPerWorkflow.values()).map((run) => ({
    name: run.workflowName || run.name,
    status: run.status,
    conclusion: run.conclusion,
  }));
};

export const selectFailedCiRuns = (gitStatus: GitTrackingStatus, branchName: string): GitCiRunStatus[] => {
  const runs = Array.isArray(gitStatus.ciRuns) ? gitStatus.ciRuns : [];
  const failedRuns = runs.filter((run) => isCiFailure(run.status, run.conclusion));
  const branchMatched = failedRuns.filter((run) => run.headBranch === branchName);
  if (branchMatched.length > 0) {
    return branchMatched.slice(0, 2);
  }
  return failedRuns.slice(0, 2);
};

export const getFailedJobLabels = (failedRuns: GitCiRunStatus[]): string[] => {
  const labels: string[] = [];
  for (const run of failedRuns) {
    const runLabel = run.workflowName || run.name;
    const jobs = Array.isArray(run.failedJobs) ? run.failedJobs : [];
    for (const job of jobs) {
      labels.push(`${runLabel}/${job.name}`);
    }
  }
  return labels;
};

export const getFailedLogSnippets = (failedRuns: GitCiRunStatus[]): string[] => {
  const snippets: string[] = [];
  for (const run of failedRuns) {
    const runLabel = `${run.workflowName || run.name} (#${run.id ?? "?"})`;
    const jobs = Array.isArray(run.failedJobs) ? run.failedJobs : [];
    for (const job of jobs) {
      if (!job.logExcerpt || job.logExcerpt.trim().length === 0) {
        continue;
      }
      snippets.push(`[${runLabel} / ${job.name}]\n${job.logExcerpt}`);
    }
  }
  return snippets.slice(0, 3);
};

export const summarizeFailedRuns = (failedRuns: GitCiRunStatus[]): string => {
  if (failedRuns.length === 0) {
    return "none";
  }
  return failedRuns
    .map((run) => `${run.workflowName || run.name}#${run.id ?? "?"}`)
    .join(", ");
};
