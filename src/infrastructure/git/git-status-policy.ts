import type {
  GitTrackingScope,
  GitPullRequestStatus,
  GitCiRunStatus,
  GitMergeStatus,
  GitTrackingTarget,
} from "../../contracts/app-types.js";

export const FAILED_JOB_LOG_MAX_CHARS = 2000;

export interface GitTrackingRequest {
  scope: GitTrackingScope;
  featureBranch?: string | null;
  defaultBranch?: string | null;
  featureBranchPrefix?: string | null;
  taskPrUrls?: string[];
}

export const isFailedConclusion = (value: string | null): boolean => {
  const normalized = (value || "").toLowerCase();
  return normalized.length > 0 && normalized !== "success" && normalized !== "neutral" && normalized !== "skipped";
};

export const normalizeBranch = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildTrackingTarget = (request?: GitTrackingRequest): GitTrackingTarget => {
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

export const filterOpenPrs = (prs: GitPullRequestStatus[], tracking?: GitTrackingRequest): GitPullRequestStatus[] => {
  if (!tracking) {
    return prs;
  }

  const featureBranch = normalizeBranch(tracking.featureBranch);
  const defaultBranch = normalizeBranch(tracking.defaultBranch);
  const taskPrUrls = new Set(
    (tracking.taskPrUrls || [])
      .map((url) => url.trim())
      .filter(Boolean)
  );

  switch (tracking.scope) {
    case "FEATURE_PR_CI":
      return featureBranch
        ? prs.filter((pr) => normalizeBranch(pr.baseRefName) === featureBranch || taskPrUrls.has(pr.url.trim()))
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
};

export const filterCiRuns = (
  runs: GitCiRunStatus[],
  trackedPrs: GitPullRequestStatus[],
  tracking?: GitTrackingRequest
): GitCiRunStatus[] => {
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
    const trackedHeads = new Set(
      trackedPrs
        .map((pr) => normalizeBranch(pr.headRefName))
        .filter((value): value is string => value !== null)
    );
    if (featureBranch) {
      trackedHeads.add(featureBranch);
    }
    if (trackedHeads.size > 0) {
      return runs.filter((run) => {
        const headBranch = normalizeBranch(run.headBranch);
        return headBranch ? trackedHeads.has(headBranch) : false;
      });
    }
    return [];
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
};

export const sortCiRunsNewestFirst = (runs: GitCiRunStatus[]): GitCiRunStatus[] => {
  return runs.slice().sort((left, right) => {
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const leftId = left.id ?? 0;
    const rightId = right.id ?? 0;
    return rightId - leftId;
  });
};

export const isRunFailed = (run: GitCiRunStatus): boolean => {
  const normalizedStatus = run.status.toLowerCase();
  if (normalizedStatus !== "completed") {
    return false;
  }
  return isFailedConclusion(run.conclusion);
};

export const trimLogExcerpt = (logText: string): string => {
  const normalized = logText.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= FAILED_JOB_LOG_MAX_CHARS) {
    return normalized;
  }
  const headLength = Math.ceil(FAILED_JOB_LOG_MAX_CHARS / 2);
  const tailLength = Math.floor(FAILED_JOB_LOG_MAX_CHARS / 2);
  const omittedChars = normalized.length - headLength - tailLength;
  return [
    normalized.slice(0, headLength),
    `... [trimmed ${omittedChars} chars from middle of failed-job log] ...`,
    normalized.slice(normalized.length - tailLength),
  ].join("\n");
};

export const filterMergedPrs = (merged: GitMergeStatus[], tracking?: GitTrackingRequest): GitMergeStatus[] => {
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
};
