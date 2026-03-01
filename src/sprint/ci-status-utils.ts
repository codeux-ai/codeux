import type { GitCiRunStatus, GitTrackingStatus } from "../contracts/app-types.js";

export const isCiCheckFailed = (status: string, conclusion: string | null): boolean => {
  const normalizedStatus = status.toLowerCase();
  const normalizedConclusion = (conclusion || "").toLowerCase();
  if (normalizedStatus !== "completed") {
    return false;
  }
  return normalizedConclusion.length > 0 && normalizedConclusion !== "success" && normalizedConclusion !== "neutral" && normalizedConclusion !== "skipped";
};

export const isCiCheckPending = (status: string, conclusion: string | null): boolean => {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus !== "completed") {
    return true;
  }
  return conclusion === null;
};

export const isCiRunFailed = (status: string, conclusion: string | null): boolean => {
  const normalizedStatus = status.toLowerCase();
  const normalizedConclusion = (conclusion || "").toLowerCase();
  if (normalizedStatus !== "completed") {
    return false;
  }
  return normalizedConclusion.length > 0 && normalizedConclusion !== "success" && normalizedConclusion !== "neutral" && normalizedConclusion !== "skipped";
};

export const selectFailedCiRuns = (gitStatus: GitTrackingStatus, branchName: string): GitCiRunStatus[] => {
  const runs = Array.isArray(gitStatus.ciRuns) ? gitStatus.ciRuns : [];
  const failedRuns = runs.filter((run) => isCiRunFailed(run.status, run.conclusion));
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
