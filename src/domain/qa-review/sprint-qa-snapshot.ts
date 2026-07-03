import type { Subtask } from "../../contracts/app-types.js";
import type { QaReviewRunRecord } from "../../repositories/qa-review-repository.js";

export function buildSprintQaSnapshot(subtasks: Subtask[]): string {
  return JSON.stringify(
    subtasks
      .map((task) => ({
        id: task.id,
        title: task.title || "",
        prompt: task.prompt || "",
        status: task.status || "",
        dependsOn: [...task.depends_on].sort(),
        isMerged: Boolean(task.is_merged),
        mergeIndicator: task.merge_indicator || "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

export function readSprintQaSnapshot(run: QaReviewRunRecord | null): string | null {
  const snapshot = run?.payload?.taskSnapshot;
  return typeof snapshot === "string" && snapshot.trim().length > 0 ? snapshot : null;
}

export interface EvaluateSprintQaReviewNeedArgs {
  latestRun: QaReviewRunRecord | null;
  latestTaskUpdatedAtMs: number;
  currentSubtasks: Subtask[];
  currentTaskSnapshot?: string;
  isRecoveredStaleRun: boolean;
}

export function shouldRunSprintQaReview(args: EvaluateSprintQaReviewNeedArgs): boolean {
  if (!args.latestRun) {
    return true;
  }

  const latestTaskSnapshot = readSprintQaSnapshot(args.latestRun);
  const currentTaskSnapshot = args.currentTaskSnapshot ?? buildSprintQaSnapshot(args.currentSubtasks);

  let hasMeaningfulChanges = false;
  if (latestTaskSnapshot) {
    hasMeaningfulChanges = latestTaskSnapshot !== currentTaskSnapshot;
  } else {
    const latestRunFinishedAtMs = args.latestRun.finishedAt ? Date.parse(args.latestRun.finishedAt) : Number.NaN;
    hasMeaningfulChanges = !Number.isFinite(latestRunFinishedAtMs) || args.latestTaskUpdatedAtMs > latestRunFinishedAtMs;
  }

  return hasMeaningfulChanges || args.isRecoveredStaleRun;
}

export type SprintQaReviewDecision =
  | { action: "run_review"; reason: "no_prior_review" | "needs_review" }
  | { action: "block_completion"; reason: "review_running" | "awaiting_follow_up" }
  | { action: "skip_review"; reason: "already_passed" | "retry_budget_exhausted" };

export interface EvaluateSprintQaReviewDecisionArgs {
  latestRun: QaReviewRunRecord | null;
  maxSprintReviewRuns: number;
  shouldRunReview: boolean;
}

export function evaluateSprintQaReviewDecision(
  args: EvaluateSprintQaReviewDecisionArgs,
): SprintQaReviewDecision {
  const { latestRun } = args;

  if (!latestRun) {
    return { action: "run_review", reason: "no_prior_review" };
  }

  if (latestRun.status === "running") {
    return { action: "block_completion", reason: "review_running" };
  }

  if (latestRun.outcome === "pass") {
    return { action: "skip_review", reason: "already_passed" };
  }

  const retryBudgetExhausted = typeof latestRun.runIndex === "number"
    && latestRun.runIndex >= args.maxSprintReviewRuns
    && latestRun.status === "completed";

  if (retryBudgetExhausted) {
    return { action: "skip_review", reason: "retry_budget_exhausted" };
  }

  if (
    (latestRun.outcome === "changes_requested" || latestRun.status === "failed")
    && !args.shouldRunReview
  ) {
    return { action: "block_completion", reason: "awaiting_follow_up" };
  }

  return { action: "run_review", reason: "needs_review" };
}
