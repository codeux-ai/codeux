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
  const normalizedReviewDecision = (reviewDecision || "").trim().toUpperCase();
  // GitHub's PR comment count includes non-review chatter such as Jules' own intro comment.
  // Treat comments as blockers only when GitHub has already established an approved review state.
  const hasReviewBlockers = resolveAllCommentsBeforeFeatureMerge
    ? normalizedReviewDecision === "CHANGES_REQUESTED"
      || (normalizedReviewDecision === "APPROVED" && comments > 0)
    : false;

  const isMergeReady = !hasFailedChecks && !hasPendingChecks && !hasReviewBlockers;

  return {
    hasFailedChecks,
    hasPendingChecks,
    hasReviewBlockers,
    isMergeReady,
  };
}
