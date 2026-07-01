import type { QaReviewTriggerType } from "../../repositories/qa-review-repository.js";
import { type NormalizedQaReviewResult, parseQaError, type QaReviewError } from "./qa-review-types.js";

export type TaskReviewIntent =
  | { intent: "pass"; summary: string }
  | { intent: "changes_requested"; summary: string; fixInstructions: string | null }
  | { intent: "retryable_failure"; error: QaReviewError }
  | { intent: "fatal_failure"; error: QaReviewError };

export function determineTaskReviewIntent(args: {
  triggerType: QaReviewTriggerType;
  review?: NormalizedQaReviewResult;
  error?: unknown;
  existingRuns: number;
  maxTaskReviewRuns: number;
}): TaskReviewIntent {
  if (args.error !== undefined) {
    const qaError = parseQaError(args.error);
    const hasRetryBudget = args.existingRuns + 1 < args.maxTaskReviewRuns;
    if (qaError.isRetryable && hasRetryBudget) {
      return { intent: "retryable_failure", error: qaError };
    }
    return { intent: "fatal_failure", error: qaError };
  }

  if (!args.review) {
    const error = parseQaError(new Error("Missing review result"));
    return { intent: "fatal_failure", error };
  }

  const { triggerType, review } = args;

  // A `completed_task_without_pr` task may legitimately need no PR (the work
  // was a no-op / nothing to commit) — `shouldHavePr === false` lets it pass
  // instead of blocking forever on a PR that should not exist. But an explicit
  // `changes_requested` verdict must win over that flag: a reviewer that finds
  // the work wrong yet also reports "no PR needed" would otherwise force-pass
  // broken work, which then resurfaces at sprint-completion QA and drives the
  // change loop. Trust the changes_requested verdict (fail-closed).
  const noPrNeeded = triggerType === "completed_task_without_pr"
    && review.shouldHavePr === false
    && review.verdict !== "changes_requested";

  if (review.verdict === "pass" || noPrNeeded) {
    return { intent: "pass", summary: review.summary };
  }

  const fixInstructions = review.fixInstructions
    || (triggerType === "completed_task_without_pr" && review.shouldHavePr
      ? "A feature PR is still required for this task. Ensure the branch contains the intended changes, push any missing commits, and create or update the feature PR so Code UX can track the work correctly."
      : null);

  return { intent: "changes_requested", summary: review.summary, fixInstructions };
}
