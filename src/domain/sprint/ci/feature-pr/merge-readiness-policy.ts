import { isCiFailure, isCiPending } from "../../../../sprint/ci-status-utils.js";
import type { GitCiRunStatus } from "../../../../contracts/app-types.js";

export interface MergeReadinessResult {
  hasFailedChecks: boolean;
  hasPendingChecks: boolean;
  hasReviewBlockers: boolean;
  isMergeReady: boolean;
}

export function evaluateMergeReadiness(
  checks: Array<{ name: string; status: string | null; conclusion: string | null }>,
  waitForFeatureCi: boolean,
  resolveAllCommentsBeforeFeatureMerge: boolean,
  reviewDecision: string | null | undefined,
  comments: number
): MergeReadinessResult {
  const hasFailedChecks = waitForFeatureCi
    ? checks.some((check) => isCiFailure(check.status ?? "", check.conclusion ?? ""))
    : false;
  const hasPendingChecks = waitForFeatureCi
    ? checks.length === 0 || checks.some((check) => isCiPending(check.status ?? "", check.conclusion ?? ""))
    : false;
  const hasReviewBlockers = resolveAllCommentsBeforeFeatureMerge
    ? reviewDecision === "CHANGES_REQUESTED" || comments > 0
    : false;

  const isMergeReady = !hasFailedChecks && !hasPendingChecks && !hasReviewBlockers;

  return {
    hasFailedChecks,
    hasPendingChecks,
    hasReviewBlockers,
    isMergeReady,
  };
}
