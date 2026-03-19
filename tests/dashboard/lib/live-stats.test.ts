import { describe, expect, it } from "vitest";
import type {
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../../dashboard/src/types.js";
import {
  buildLiveSprintTimingSummary,
  buildLiveTaskTimingSummary,
} from "../../../dashboard/src/v2/lib/live-stats.js";

function makeTask(overrides: Partial<Subtask> & Pick<Subtask, "id" | "title">): Subtask {
  return {
    id: overrides.id,
    title: overrides.title,
    prompt: overrides.prompt || overrides.title,
    depends_on: overrides.depends_on || [],
    is_independent: overrides.is_independent ?? true,
    status: overrides.status || "PENDING",
    ...overrides,
  };
}

function makeDispatch(overrides: Partial<ExecutionTaskDispatchSummary> & Pick<ExecutionTaskDispatchSummary, "id" | "taskId" | "taskKey" | "taskTitle">): ExecutionTaskDispatchSummary {
  return {
    id: overrides.id,
    projectId: overrides.projectId || "project-1",
    sprintId: overrides.sprintId || "sprint-1",
    sprintRunId: overrides.sprintRunId || "run-1",
    sprintName: overrides.sprintName || "Sprint",
    sprintNumber: overrides.sprintNumber ?? 1,
    taskId: overrides.taskId,
    taskKey: overrides.taskKey,
    taskTitle: overrides.taskTitle,
    status: overrides.status || "completed",
    executorType: overrides.executorType || "docker_cli",
    priority: overrides.priority ?? 0,
    connectionId: overrides.connectionId ?? null,
    connectionDisplayName: overrides.connectionDisplayName ?? null,
    connectionRole: overrides.connectionRole ?? null,
    taskRunId: overrides.taskRunId ?? `${overrides.id}-task-run`,
    taskRunState: overrides.taskRunState ?? "COMPLETED",
    provider: overrides.provider ?? "codex",
    sessionId: overrides.sessionId ?? null,
    sessionName: overrides.sessionName ?? null,
    workerBranch: overrides.workerBranch ?? null,
    prUrl: overrides.prUrl ?? null,
    queuedAt: overrides.queuedAt || "2026-03-19T10:00:00.000Z",
    claimedAt: overrides.claimedAt ?? overrides.queuedAt ?? "2026-03-19T10:00:00.000Z",
    startedAt: overrides.startedAt ?? overrides.queuedAt ?? "2026-03-19T10:00:00.000Z",
    finishedAt: overrides.finishedAt ?? null,
    lastHeartbeatAt: overrides.lastHeartbeatAt ?? overrides.finishedAt ?? overrides.startedAt ?? null,
    errorMessage: overrides.errorMessage ?? null,
    activeLeaseOwnerKey: overrides.activeLeaseOwnerKey ?? null,
    activeLeaseExpiresAt: overrides.activeLeaseExpiresAt ?? null,
  };
}

function makeEvent(overrides: Partial<ExecutionRuntimeEventSummary> & Pick<ExecutionRuntimeEventSummary, "id" | "eventType" | "createdAt">): ExecutionRuntimeEventSummary {
  return {
    id: overrides.id,
    scopeType: overrides.scopeType || "task_run",
    taskRunId: overrides.taskRunId ?? "dispatch-1-task-run",
    sprintRunId: overrides.sprintRunId ?? "run-1",
    dispatchId: overrides.dispatchId ?? "dispatch-1",
    projectId: overrides.projectId || "project-1",
    sprintId: overrides.sprintId || "sprint-1",
    sprintName: overrides.sprintName || "Sprint",
    sprintNumber: overrides.sprintNumber ?? 1,
    sprintRunStatus: overrides.sprintRunStatus ?? "running",
    taskId: overrides.taskId ?? "task-record-1",
    taskKey: overrides.taskKey ?? "T01",
    taskTitle: overrides.taskTitle ?? "Task",
    taskRunState: overrides.taskRunState ?? "RUNNING",
    eventType: overrides.eventType,
    originator: overrides.originator ?? "system",
    sourceEventKey: overrides.sourceEventKey ?? null,
    provider: overrides.provider ?? "codex",
    sessionId: overrides.sessionId ?? null,
    sessionName: overrides.sessionName ?? null,
    workerBranch: overrides.workerBranch ?? null,
    prUrl: overrides.prUrl ?? null,
    connectionId: overrides.connectionId ?? null,
    connectionDisplayName: overrides.connectionDisplayName ?? null,
    connectionRole: overrides.connectionRole ?? null,
    createdAt: overrides.createdAt,
    payload: overrides.payload ?? null,
  };
}

function makeSprintRun(overrides: Partial<ExecutionSprintRunSummary> = {}): ExecutionSprintRunSummary {
  return {
    id: overrides.id || "run-1",
    projectId: overrides.projectId || "project-1",
    sprintId: overrides.sprintId || "sprint-1",
    sprintName: overrides.sprintName || "Sprint",
    sprintNumber: overrides.sprintNumber ?? 1,
    status: overrides.status || "running",
    triggerType: overrides.triggerType || "manual",
    triggeredBy: overrides.triggeredBy ?? null,
    executorMode: overrides.executorMode || "docker_cli",
    startedAt: overrides.startedAt ?? "2026-03-19T10:00:00.000Z",
    finishedAt: overrides.finishedAt ?? null,
    lastHeartbeatAt: overrides.lastHeartbeatAt ?? null,
    createdAt: overrides.createdAt || "2026-03-19T10:00:00.000Z",
    activeLeaseOwnerKey: overrides.activeLeaseOwnerKey ?? null,
    activeLeaseExpiresAt: overrides.activeLeaseExpiresAt ?? null,
    humanIntervention: overrides.humanIntervention ?? null,
  };
}

describe("live stats timing model", () => {
  it("keeps no-change tasks in coding time and finalizes them cleanly", () => {
    const task = makeTask({
      id: "T01",
      title: "Smoke Test",
      record_id: "task-record-1",
      status: "COMPLETED",
    });
    const dispatch = makeDispatch({
      id: "dispatch-1",
      taskId: "task-record-1",
      taskKey: "T01",
      taskTitle: "Smoke Test",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
    });
    const events = [
      makeEvent({
        id: "evt-1",
        dispatchId: "dispatch-1",
        taskRunId: "dispatch-1-task-run",
        taskId: "task-record-1",
        taskKey: "T01",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2",
        dispatchId: "dispatch-1",
        taskRunId: "dispatch-1-task-run",
        taskId: "task-record-1",
        taskKey: "T01",
        eventType: "cli_git_no_changes",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:06:00.000Z",
    });

    expect(summary.totalSeconds).toBe(300);
    expect(summary.stageTotals.coding).toBe(300);
    expect(summary.stageTotals.ci).toBe(0);
    expect(summary.activeStage).toBeNull();
  });

  it("splits task time across coding, ci, autofix, and merge windows", () => {
    const task = makeTask({
      id: "T02",
      title: "Feature Work",
      record_id: "task-record-2",
      status: "COMPLETED",
      worker_branch: "feature/t02",
      pr_url: "https://example.com/pr/2",
      merge_indicator: "MERGED",
      is_merged: true,
    });
    const dispatch = makeDispatch({
      id: "dispatch-2",
      taskId: "task-record-2",
      taskKey: "T02",
      taskTitle: "Feature Work",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
      workerBranch: "feature/t02",
      prUrl: "https://example.com/pr/2",
    });
    const events = [
      makeEvent({
        id: "evt-a",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-b",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "cli_pr_finalized",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-c",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:06:00.000Z",
        payload: { state: "waiting_checks", hasPendingChecks: true },
      }),
      makeEvent({
        id: "evt-d",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:08:00.000Z",
        payload: { state: "waiting_checks", hasFailedChecks: true },
      }),
      makeEvent({
        id: "evt-e",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:11:00.000Z",
        payload: { state: "ready_for_merge" },
      }),
      makeEvent({
        id: "evt-f",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:12:00.000Z",
        payload: { state: "merge_confirmed" },
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:15:00.000Z",
    });

    expect(summary.totalSeconds).toBe(720);
    expect(summary.stageTotals.coding).toBe(300);
    expect(summary.stageTotals.ci).toBe(180);
    expect(summary.stageTotals.autofix).toBe(180);
    expect(summary.stageTotals.merge).toBe(60);
    expect(summary.activeStage).toBeNull();
  });

  it("uses the latest dispatch history for rerun tasks", () => {
    const task = makeTask({
      id: "T03",
      title: "Rerun Task",
      record_id: "task-record-3",
      status: "RUNNING",
    });
    const staleDispatch = makeDispatch({
      id: "dispatch-old",
      taskId: "task-record-3",
      taskKey: "T03",
      taskTitle: "Rerun Task",
      taskRunId: "dispatch-old-task-run",
      startedAt: "2026-03-19T08:00:00.000Z",
      finishedAt: "2026-03-19T08:10:00.000Z",
    });
    const liveDispatch = makeDispatch({
      id: "dispatch-new",
      taskId: "task-record-3",
      taskKey: "T03",
      taskTitle: "Rerun Task",
      taskRunId: "dispatch-new-task-run",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: null,
    });
    const events = [
      makeEvent({
        id: "evt-old",
        dispatchId: "dispatch-old",
        taskRunId: "dispatch-old-task-run",
        taskId: "task-record-3",
        taskKey: "T03",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T08:00:00.000Z",
      }),
      makeEvent({
        id: "evt-new",
        dispatchId: "dispatch-new",
        taskRunId: "dispatch-new-task-run",
        taskId: "task-record-3",
        taskKey: "T03",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [staleDispatch, liveDispatch],
      events,
      nowIso: "2026-03-19T10:05:00.000Z",
    });

    expect(summary.startedAt).toBe("2026-03-19T10:00:00.000Z");
    expect(summary.totalSeconds).toBe(300);
    expect(summary.activeStage).toBe("coding");
  });

  it("aggregates sprint elapsed time and active stage counts", () => {
    const tasks = [
      makeTask({
        id: "T01",
        title: "Done",
        record_id: "task-record-1",
        status: "COMPLETED",
      }),
      makeTask({
        id: "T02",
        title: "Waiting on CI",
        record_id: "task-record-2",
        status: "CODING_COMPLETED",
        worker_branch: "feature/t02",
        pr_url: "https://example.com/pr/2",
        merge_indicator: "CI",
      }),
    ];
    const dispatches = [
      makeDispatch({
        id: "dispatch-1",
        taskId: "task-record-1",
        taskKey: "T01",
        taskTitle: "Done",
        startedAt: "2026-03-19T10:00:00.000Z",
        finishedAt: "2026-03-19T10:05:00.000Z",
      }),
      makeDispatch({
        id: "dispatch-2",
        taskId: "task-record-2",
        taskKey: "T02",
        taskTitle: "Waiting on CI",
        startedAt: "2026-03-19T10:10:00.000Z",
        finishedAt: "2026-03-19T10:13:00.000Z",
      }),
    ];
    const events = [
      makeEvent({
        id: "evt-1",
        dispatchId: "dispatch-1",
        taskRunId: "dispatch-1-task-run",
        taskId: "task-record-1",
        taskKey: "T01",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2",
        dispatchId: "dispatch-1",
        taskRunId: "dispatch-1-task-run",
        taskId: "task-record-1",
        taskKey: "T01",
        eventType: "cli_git_no_changes",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-3",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:10:00.000Z",
      }),
      makeEvent({
        id: "evt-4",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "cli_pr_finalized",
        createdAt: "2026-03-19T10:13:00.000Z",
      }),
      makeEvent({
        id: "evt-5",
        dispatchId: "dispatch-2",
        taskRunId: "dispatch-2-task-run",
        taskId: "task-record-2",
        taskKey: "T02",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:14:00.000Z",
        payload: { state: "waiting_checks", hasPendingChecks: true },
      }),
    ];
    const sprintRuns = [
      makeSprintRun({
        startedAt: "2026-03-19T10:00:00.000Z",
      }),
    ];

    const summary = buildLiveSprintTimingSummary({
      tasks,
      dispatches,
      events,
      sprintRuns,
      nowIso: "2026-03-19T10:15:00.000Z",
    });

    expect(summary.sprintElapsedSeconds).toBe(900);
    expect(summary.completedTaskCount).toBe(1);
    expect(summary.averageCompletedTaskSeconds).toBe(300);
    expect(summary.activeStageCounts.ci).toBe(1);
    expect(summary.stageTotals.coding).toBe(480);
    expect(summary.stageTotals.ci).toBe(120);
    expect(summary.longestTask?.totalSeconds).toBe(300);
  });
});
