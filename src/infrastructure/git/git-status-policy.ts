import type {
  GitTrackingScope,
  GitPullRequestStatus,
  GitCiRunStatus,
  GitMergeStatus,
  GitTrackingTarget,
} from "../../contracts/app-types.js";

export const FAILED_JOB_LOG_MAX_CHARS = 12_000;

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

const CI_ERROR_SIGNAL = /(?:##\[error\]|\b(?:assert(?:ion)?error|error|exception|fatal|panic|traceback|failed|failure|expected|received|actual)\b|npm ERR!|ELIFECYCLE|Process completed with exit code|(?:^|\s)(?:FAIL|not ok|✖|×)(?:\s|$))/i;

function trimEvidenceSegment(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const usable = Math.max(80, maxChars - 80);
  const headLength = Math.ceil(usable / 2);
  const tailLength = Math.floor(usable / 2);
  return [
    value.slice(0, headLength),
    "... [trimmed within this error section] ...",
    value.slice(value.length - tailLength),
  ].join("\n");
}

/**
 * Extracts failed-step and assertion/error windows from a full GitHub job log.
 * Runner provisioning and cleanup commonly sit at the head/tail while the useful
 * test failure is in the middle, so a generic head/tail trim is actively harmful.
 */
export const extractFailedJobLogExcerpt = (logText: string, failedSteps: string[]): string => {
  const normalized = logText
    .replace(/\r\n/g, "\n")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  const failedStepNames = failedSteps.map((step) => step.trim()).filter(Boolean);
  const normalizedStepNames = failedStepNames.map((step) => step.toLowerCase());
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const lower = line.toLowerCase();
    const matchesStep = normalizedStepNames.some((step) => lower.includes(step));
    if (!matchesStep && !CI_ERROR_SIGNAL.test(line)) {
      continue;
    }
    ranges.push({
      start: Math.max(0, index - (matchesStep ? 8 : 5)),
      end: Math.min(lines.length - 1, index + (matchesStep ? 18 : 8)),
    });
  }

  if (ranges.length === 0) {
    return trimLogExcerpt(normalized);
  }

  ranges.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 2) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const header = failedStepNames.length > 0
    ? `Failed steps reported by GitHub: ${failedStepNames.join(", ")}\n\nError-focused log evidence:`
    : "Error-focused log evidence:";
  const availableChars = Math.max(1_000, FAILED_JOB_LOG_MAX_CHARS - header.length - 2);
  const perSectionChars = Math.max(400, Math.floor(availableChars / merged.length));
  const sections = merged.map((range, index) => {
    const body = lines.slice(range.start, range.end + 1).join("\n");
    return `--- Error section ${index + 1} (log lines ${range.start + 1}-${range.end + 1}) ---\n${trimEvidenceSegment(body, perSectionChars)}`;
  });
  return `${header}\n${sections.join("\n\n")}`.slice(0, FAILED_JOB_LOG_MAX_CHARS);
};

export const filterMergedPrs = (merged: GitMergeStatus[], tracking?: GitTrackingRequest): GitMergeStatus[] => {
  if (!tracking) {
    return merged;
  }

  const defaultBranch = normalizeBranch(tracking.defaultBranch);
  const featureBranch = normalizeBranch(tracking.featureBranch);
  const featurePrefix = normalizeBranch(tracking.featureBranchPrefix);
  const taskPrUrls = new Set(
    (tracking.taskPrUrls || [])
      .map((url) => url.trim())
      .filter(Boolean)
  );
  if (!defaultBranch && !featureBranch && !featurePrefix && taskPrUrls.size === 0) {
    return merged;
  }

  return merged.filter((pr) => {
    if (typeof pr.url === "string" && taskPrUrls.has(pr.url.trim())) {
      return true;
    }
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
