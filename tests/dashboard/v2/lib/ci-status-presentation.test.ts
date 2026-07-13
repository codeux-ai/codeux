import { describe, expect, it } from "vitest";
import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  Subtask,
} from "../../../../src/contracts/app-types.js";
import {
  deriveSprintCiStatusPresentation,
  deriveTaskCiStatusPresentation,
} from "../../../../dashboard/src/v2/lib/ci-status-presentation.js";

function event(overrides: Partial<ExecutionRuntimeEventSummary> = {}): ExecutionRuntimeEventSummary {
  return {
    id: "event-1",
    scopeType: "task_run",
    taskRunId: "task-run-1",
    sprintRunId: "sprint-run-1",
    dispatchId: null,
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: "task-record-1",
    taskKey: "T01",
    taskTitle: "Task one",
    taskRunState: "in_progress",
    eventType: "ci_gate_status",
    originator: "system",
    sourceEventKey: null,
    provider: null,
    sessionId: null,
    sessionName: null,
    workerBranch: "worker/t01",
    prUrl: "https://example.test/pr/1",
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-07-13T10:00:00.000Z",
    payload: { state: "waiting_checks", prNumber: 1, hasPendingChecks: true },
    ...overrides,
  };
}

function attention(overrides: Partial<ExecutionAttentionItemSummary> = {}): ExecutionAttentionItemSummary {
  return {
    id: "attention-1",
    sprintId: "sprint-1",
    taskId: "task-record-1",
    sprintRunId: "sprint-run-1",
    dispatchId: null,
    attentionType: "ci_fix_required",
    severity: "high",
    ownerType: "worker",
    status: "open",
    assignedWorkerEndpointId: null,
    title: "CI fix required",
    summaryMarkdown: "Checks failed.",
    payload: { taskKey: "T01", prNumber: 1, prUrl: "https://example.test/pr/1" },
    openedAt: "2026-07-13T10:00:00.000Z",
    claimedAt: null,
    resolvedAt: null,
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

const task: Pick<Subtask, "record_id" | "id" | "sprint_id" | "merge_indicator" | "is_merged" | "pr_url"> = {
  record_id: "task-record-1",
  id: "T01",
  sprint_id: "sprint-1",
  merge_indicator: "CI",
  pr_url: "https://example.test/pr/1",
};

describe("CI status presentation", () => {
  it("scopes task evidence and replaces a stale failure with the newest event", () => {
    const presentation = deriveTaskCiStatusPresentation({
      task,
      sprintRunId: "sprint-run-1",
      events: [
        event({ id: "old-failure", createdAt: "2026-07-13T10:00:00.000Z", payload: { state: "waiting_checks", prNumber: 1, hasFailedChecks: true } }),
        event({ id: "new-success", createdAt: "2026-07-13T10:01:00.000Z", payload: { state: "ready_for_merge", prNumber: 1 } }),
        event({ id: "other-task", taskId: "task-record-2", taskKey: "T02", createdAt: "2026-07-13T10:02:00.000Z", payload: { state: "waiting_checks", hasFailedChecks: true } }),
        event({ id: "other-run", sprintRunId: "sprint-run-2", createdAt: "2026-07-13T10:03:00.000Z", payload: { state: "waiting_checks", hasFailedChecks: true } }),
      ],
    });

    expect(presentation?.state).toBe("pending");
    expect(presentation?.steps.find((step) => step.id === "checks")?.state).toBe("successful");
    expect(presentation?.label).toBe("CI pending");
  });

  it("gives active matching CI attention failure precedence and ignores resolved attention", () => {
    const failed = deriveTaskCiStatusPresentation({
      task,
      events: [event({ payload: { state: "ready_for_merge", prNumber: 1 } })],
      attentionItems: [attention()],
    });
    expect(failed?.state).toBe("failed");
    expect(failed?.failureKind).toBe("ci_checks");
    expect(failed?.label).toBe("CI failed");

    const recovered = deriveTaskCiStatusPresentation({
      task,
      events: [event({ payload: { state: "ready_for_merge", prNumber: 1 } })],
      attentionItems: [attention({ status: "resolved", resolvedAt: "2026-07-13T10:02:00.000Z" })],
    });
    expect(recovered?.state).toBe("pending");
    expect(recovered?.steps[1].state).toBe("successful");
  });

  it("aggregates newest feature and main merge entities with failure then progress precedence", () => {
    const presentation = deriveSprintCiStatusPresentation({
      sprintId: "sprint-1",
      sprintRunId: "sprint-run-1",
      events: [
        event({ id: "t1-old", payload: { state: "waiting_checks", prNumber: 1, hasFailedChecks: true } }),
        event({ id: "t1-new", createdAt: "2026-07-13T10:01:00.000Z", payload: { state: "merge_confirmed", prNumber: 1 } }),
        event({
          id: "main",
          scopeType: "sprint_run",
          taskRunId: null,
          taskId: null,
          taskKey: null,
          eventType: "main_merge_gate_status",
          createdAt: "2026-07-13T10:02:00.000Z",
          payload: { state: "pending_checks", prNumber: 9 },
        }),
        event({ id: "other-sprint", sprintId: "sprint-2", payload: { state: "waiting_checks", hasFailedChecks: true } }),
      ],
    });

    expect(presentation?.scope).toBe("sprint");
    expect(presentation?.state).toBe("in_progress");
    expect(presentation?.steps[1].state).toBe("in_progress");
    expect(presentation?.label).toBe("CI running");
  });

  it("distinguishes check failures from review blockers, conflicts, and missing pull requests", () => {
    const checkFailure = deriveTaskCiStatusPresentation({
      task,
      events: [event({ payload: { state: "waiting_checks", prNumber: 1, hasFailedChecks: true, hasReviewBlockers: true } })],
    });
    expect(checkFailure?.failureKind).toBe("ci_checks");

    const reviewOnly = deriveTaskCiStatusPresentation({
      task,
      events: [event({ payload: { state: "waiting_checks", prNumber: 1, hasReviewBlockers: true } })],
    });
    expect(reviewOnly?.state).toBe("pending");
    expect(reviewOnly?.failureKind).toBeUndefined();

    const conflict = deriveTaskCiStatusPresentation({
      task: { ...task, merge_indicator: "MERGE_CONFLICT" },
      events: [],
    });
    expect(conflict?.state).toBe("failed");
    expect(conflict?.failureKind).toBe("merge_conflict");
    expect(conflict?.label).toBe("Merge conflict");

    const missingPr = deriveTaskCiStatusPresentation({
      task,
      events: [event({ prUrl: null, payload: { state: "waiting_for_pr" } })],
    });
    expect(missingPr?.state).toBe("pending");
    expect(missingPr?.failureKind).toBeUndefined();
  });

  it("returns no badge for absent, unrelated, or unknown evidence", () => {
    const taskWithoutFallback = { ...task, merge_indicator: undefined, pr_url: undefined };
    expect(deriveTaskCiStatusPresentation({ task: taskWithoutFallback })).toBeNull();
    expect(deriveTaskCiStatusPresentation({
      task: taskWithoutFallback,
      events: [event({ eventType: "run_completed", payload: { state: "completed" } })],
    })).toBeNull();
    expect(deriveTaskCiStatusPresentation({
      task: taskWithoutFallback,
      events: [event({ payload: { state: "future_unknown_state", hasFailedChecks: true } })],
    })).toBeNull();
    expect(deriveSprintCiStatusPresentation({ sprintId: "sprint-1", events: [event({ sprintId: "sprint-2" })] })).toBeNull();
  });

  it("uses main-merge CI attention as a sprint-scoped unresolved check failure", () => {
    const presentation = deriveSprintCiStatusPresentation({
      sprintId: "sprint-1",
      sprintRunId: "sprint-run-1",
      attentionItems: [attention({ taskId: null, payload: { mergeStage: "main", prNumber: 9 } })],
    });
    expect(presentation?.state).toBe("failed");
    expect(presentation?.failureKind).toBe("ci_checks");
  });
});
