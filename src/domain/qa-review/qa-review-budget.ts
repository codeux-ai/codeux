import type { QaReviewRunRecord } from "../../repositories/qa-review-repository.js";

/**
 * How many extra QA attempts beyond `maxTaskReviewRuns` we tolerate when the
 * reviewer keeps failing for infrastructure reasons (auth/config/container).
 *
 * If a provider returns 500s or timeouts, we allow some grace retries, but the
 * reviewer must still stop retrying eventually and escalate the task to a human
 * (QA_REVIEW_FAILED) rather than loop forever or — worse — fail open.
 */
export const QA_INFRA_FAILURE_GRACE = 3;
export const RECOVERED_STALE_QA_SUMMARY_PREFIX = "Recovered stale QA review run";

export function isRecoveredStaleQaRun(run: QaReviewRunRecord | null): boolean {
  return typeof run?.summaryMarkdown === "string" && run.summaryMarkdown.startsWith(RECOVERED_STALE_QA_SUMMARY_PREFIX);
}

export function shouldVerifyContinuedQaFix(run: QaReviewRunRecord | null): boolean {
  return run?.status === "completed"
    && run.outcome === "changes_requested"
    && run.payload?.continued === true;
}

export interface QaReviewBudgetArgs {
  existingRuns: number;
  decisiveRuns: number;
  maxTaskReviewRuns: number;
  latestRun: QaReviewRunRecord | null;
}

export interface QaReviewBudgetResult {
  allowed: boolean;
  reason: string;
}

export function evaluateQaReviewBudget(args: QaReviewBudgetArgs): QaReviewBudgetResult {
  if (args.maxTaskReviewRuns <= 0) {
    return { allowed: false, reason: "qa_disabled" };
  }

  const budgetSpent = args.decisiveRuns >= args.maxTaskReviewRuns
    || args.existingRuns >= args.maxTaskReviewRuns + QA_INFRA_FAILURE_GRACE;

  if (!budgetSpent) {
    return { allowed: true, reason: "within_budget" };
  }

  if (shouldVerifyContinuedQaFix(args.latestRun)) {
    return { allowed: true, reason: "allow_post_continuation_verification" };
  }

  if (isRecoveredStaleQaRun(args.latestRun)) {
    return { allowed: true, reason: "allow_recovered_stale_retry" };
  }

  if (args.existingRuns >= args.maxTaskReviewRuns + QA_INFRA_FAILURE_GRACE) {
    return { allowed: false, reason: "infra_grace_exhausted" };
  }

  return { allowed: false, reason: "budget_exhausted" };
}
