import type { QaReviewRunRecord } from "../../repositories/qa-review-repository.js";
import { QA_INFRA_FAILURE_GRACE, isRecoveredStaleQaRun } from "./qa-review-budget.js";
import type { QaReviewTriggerType } from "../../repositories/qa-review-repository.js";
import type { QualityAssuranceSettings } from "../../contracts/app-types.js";

export interface TaskQaMergeGateStatus {
  mergeAllowed: boolean;
  reason: "not_required" | "pending_review" | "review_running" | "passed" | "changes_requested" | "review_failed" | "retries_exhausted";
  summary: string;
  latestRun: QaReviewRunRecord | null;
  runsUsed: number;
  maxRuns: number;
}

export function computeTaskMergeGateStatus(input: {
  taskId: string | null;
  triggerType: QaReviewTriggerType | null;
  qaSettings: QualityAssuranceSettings;
  latestRun: QaReviewRunRecord | null;
  runsUsed: number;
  decisiveRuns: number;
}): TaskQaMergeGateStatus {
  const { taskId, triggerType, qaSettings, latestRun, runsUsed, decisiveRuns } = input;

  if (!taskId) {
    return {
      mergeAllowed: true,
      reason: "not_required",
      summary: "",
      latestRun: null,
      runsUsed: 0,
      maxRuns: 0,
    };
  }

  if (!qaSettings.enabled || !triggerType) {
    return {
      mergeAllowed: true,
      reason: "not_required",
      summary: "",
      latestRun: null,
      runsUsed: 0,
      maxRuns: qaSettings.maxTaskReviewRuns,
    };
  }

  const maxRuns = qaSettings.maxTaskReviewRuns;

  if (latestRun?.status === "running") {
    return {
      mergeAllowed: false,
      reason: "review_running",
      summary: latestRun.summaryMarkdown || "QA review is still running.",
      latestRun,
      runsUsed,
      maxRuns,
    };
  }

  if (latestRun?.outcome === "pass") {
    return {
      mergeAllowed: true,
      reason: "passed",
      summary: latestRun.summaryMarkdown || "QA review passed.",
      latestRun,
      runsUsed,
      maxRuns,
    };
  }

  const recoveredStaleLatestRun = isRecoveredStaleQaRun(latestRun);

  // Only runs that produced a real verdict (pass / changes_requested) spend
  // the review budget. Reviewer crashes (missing auth, container/parse
  // failures) are infra noise that produced no judgement, so they are retried
  // — bounded by an infra ceiling so a permanently broken reviewer still
  // stops and escalates instead of looping or failing open.
  const infraCeiling = maxRuns + QA_INFRA_FAILURE_GRACE;
  const budgetExhausted = (maxRuns > 0 && decisiveRuns >= maxRuns) || runsUsed >= infraCeiling;

  // Exhaustion is checked BEFORE the changes_requested verdict on purpose: a
  // task that keeps getting "changes requested" until its budget is spent must
  // surface as `retries_exhausted` so the orchestrator can apply the configured
  // exhaustion policy. Otherwise the gate stays on `changes_requested` forever
  // (the bug that hung sprints when a weak agent never landed the change).
  // A genuine pass returns above, so reaching here means QA never cleared it.
  if (budgetExhausted) {
    return {
      mergeAllowed: false,
      reason: "retries_exhausted",
      summary: latestRun?.summaryMarkdown
        || `QA could not clear this task (${decisiveRuns}/${maxRuns} verdicts, ${runsUsed} attempts) — human attention required.`,
      latestRun,
      runsUsed,
      maxRuns,
    };
  }

  if (latestRun?.outcome === "changes_requested") {
    return {
      mergeAllowed: false,
      reason: "changes_requested",
      summary: latestRun.summaryMarkdown || "QA requested follow-up fixes.",
      latestRun,
      runsUsed,
      maxRuns,
    };
  }

  if (latestRun?.status === "failed" && recoveredStaleLatestRun) {
    return {
      mergeAllowed: false,
      reason: "review_failed",
      summary: latestRun.summaryMarkdown || "QA review failed and must be retried before merge.",
      latestRun,
      runsUsed,
      maxRuns,
    };
  }

  if (latestRun?.status === "failed") {
    return {
      mergeAllowed: false,
      reason: "review_failed",
      summary: latestRun.summaryMarkdown || "QA review failed and must be retried before merge.",
      latestRun,
      runsUsed,
      maxRuns,
    };
  }

  return {
    mergeAllowed: false,
    reason: "pending_review",
    summary: "QA review is required before merge.",
    latestRun,
    runsUsed,
    maxRuns,
  };
}
