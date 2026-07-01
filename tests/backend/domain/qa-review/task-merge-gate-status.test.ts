import { describe, expect, it } from "vitest";
import { computeTaskMergeGateStatus } from "../../../../src/domain/qa-review/task-merge-gate-status.js";
import { RECOVERED_STALE_QA_SUMMARY_PREFIX, QA_INFRA_FAILURE_GRACE } from "../../../../src/domain/qa-review/qa-review-budget.js";
import type { QaReviewRunRecord } from "../../../../src/repositories/qa-review-repository.js";
import type { QualityAssuranceSettings } from "../../../../src/contracts/app-types.js";
import type { QaReviewTriggerType } from "../../../../src/repositories/qa-review-repository.js";

function createMockRun(overrides: Partial<QaReviewRunRecord>): QaReviewRunRecord {
  return {
    id: "run-1",
    task_id: "task-1",
    sprint_id: "sprint-1",
    provider_invocation_id: "pi-1",
    status: "completed",
    outcome: "pass",
    summaryMarkdown: "Test summary",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    ...overrides,
  } as QaReviewRunRecord;
}

const mockSettings: QualityAssuranceSettings = {
  enabled: true,
  maxTaskReviewRuns: 3,
  maxSprintReviewRuns: 0,
  exhaustionPolicy: "escalate",
  taskCompletion: "always",
  sprintCompletion: "always",
  completedTaskWithoutPr: "always",
};

describe("computeTaskMergeGateStatus", () => {
  it("returns not_required when taskId is null", () => {
    const result = computeTaskMergeGateStatus({
      taskId: null,
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings,
      latestRun: null,
      runsUsed: 0,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("not_required");
    expect(result.mergeAllowed).toBe(true);
  });

  it("returns not_required when QA is disabled", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: { ...mockSettings, enabled: false },
      latestRun: null,
      runsUsed: 0,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("not_required");
    expect(result.mergeAllowed).toBe(true);
  });

  it("returns not_required when there is no trigger type", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: null,
      qaSettings: mockSettings,
      latestRun: null,
      runsUsed: 0,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("not_required");
    expect(result.mergeAllowed).toBe(true);
  });

  it("returns review_running when the latest run is running", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings,
      latestRun: createMockRun({ status: "running", summaryMarkdown: null }),
      runsUsed: 1,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("review_running");
    expect(result.mergeAllowed).toBe(false);
  });

  it("returns passed when the latest run outcome is pass", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings,
      latestRun: createMockRun({ outcome: "pass" }),
      runsUsed: 1,
      decisiveRuns: 1,
    });
    expect(result.reason).toBe("passed");
    expect(result.mergeAllowed).toBe(true);
  });

  it("returns retries_exhausted when decisive runs meet maxRuns", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings, // maxTaskReviewRuns: 3
      latestRun: createMockRun({ outcome: "changes_requested" }),
      runsUsed: 3,
      decisiveRuns: 3,
    });
    expect(result.reason).toBe("retries_exhausted");
    expect(result.mergeAllowed).toBe(false);
  });

  it("returns retries_exhausted when total runs meet infraCeiling", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings, // maxTaskReviewRuns: 3
      latestRun: createMockRun({ status: "failed", outcome: null }),
      runsUsed: 3 + QA_INFRA_FAILURE_GRACE, // 3 + 3 = 6
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("retries_exhausted");
    expect(result.mergeAllowed).toBe(false);
  });

  it("returns changes_requested when latest run requested changes and budget is not exhausted", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings, // maxTaskReviewRuns: 3
      latestRun: createMockRun({ outcome: "changes_requested" }),
      runsUsed: 2,
      decisiveRuns: 2,
    });
    expect(result.reason).toBe("changes_requested");
    expect(result.mergeAllowed).toBe(false);
  });

  it("returns review_failed when latest run failed with stale prefix", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings,
      latestRun: createMockRun({ status: "failed", outcome: null, summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} timeout` }),
      runsUsed: 1,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("review_failed");
    expect(result.mergeAllowed).toBe(false);
  });

  it("returns review_failed when latest run failed normally", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings,
      latestRun: createMockRun({ status: "failed", outcome: null, summaryMarkdown: "Parse error" }),
      runsUsed: 1,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("review_failed");
    expect(result.mergeAllowed).toBe(false);
  });

  it("returns pending_review when there are no runs", () => {
    const result = computeTaskMergeGateStatus({
      taskId: "task-1",
      triggerType: "has_code_changes" as QaReviewTriggerType,
      qaSettings: mockSettings,
      latestRun: null,
      runsUsed: 0,
      decisiveRuns: 0,
    });
    expect(result.reason).toBe("pending_review");
    expect(result.mergeAllowed).toBe(false);
  });
});
