import { describe, expect, it } from "vitest";
import type {
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  ExecutionUsageTotals,
  Subtask,
} from "../../../dashboard/src/types.js";
import {
  STATS_DECK_VISIBLE_STAGES,
  buildLiveSprintTimingSummary,
  buildLiveTaskTimingSummary,
  buildLiveTaskTimingSummaries,
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
    claimedAt: "claimedAt" in overrides ? overrides.claimedAt : (overrides.queuedAt || "2026-03-19T10:00:00.000Z"),
    startedAt: "startedAt" in overrides ? overrides.startedAt : (overrides.queuedAt || "2026-03-19T10:00:00.000Z"),
    finishedAt: overrides.finishedAt ?? null,
    lastHeartbeatAt: overrides.lastHeartbeatAt ?? overrides.finishedAt ?? overrides.startedAt ?? null,
    errorMessage: overrides.errorMessage ?? null,
    activeLeaseOwnerKey: overrides.activeLeaseOwnerKey ?? null,
    activeLeaseExpiresAt: overrides.activeLeaseExpiresAt ?? null,
    usage: overrides.usage,
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
    usage: overrides.usage,
  };
}

function makeUsageTotals(overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals {
  return {
    invocationCount: overrides.invocationCount ?? 0,
    activeTimeMs: overrides.activeTimeMs ?? 0,
    wallTimeMs: overrides.wallTimeMs ?? 0,
    inputTokens: overrides.inputTokens ?? 0,
    cachedInputTokens: overrides.cachedInputTokens ?? 0,
    outputTokens: overrides.outputTokens ?? 0,
    reasoningOutputTokens: overrides.reasoningOutputTokens ?? 0,
    totalTokens: overrides.totalTokens ?? 0,
    reportedInvocationCount: overrides.reportedInvocationCount ?? 0,
    estimatedInvocationCount: overrides.estimatedInvocationCount ?? 0,
    unavailableInvocationCount: overrides.unavailableInvocationCount ?? 0,
    unsupportedInvocationCount: overrides.unsupportedInvocationCount ?? 0,
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

  it("stops active timing at dispatch completion when task status still looks running", () => {
    const task = makeTask({
      id: "T01S",
      title: "Snapshot skew",
      record_id: "task-record-1s",
      status: "RUNNING",
    });
    const dispatch = makeDispatch({
      id: "dispatch-1s",
      taskId: "task-record-1s",
      taskKey: "T01S",
      taskTitle: "Snapshot skew",
      status: "completed",
      taskRunState: "COMPLETED",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
      lastHeartbeatAt: "2026-03-19T10:05:00.000Z",
    });
    const events = [
      makeEvent({
        id: "evt-1s-start",
        dispatchId: "dispatch-1s",
        taskRunId: "dispatch-1s-task-run",
        taskId: "task-record-1s",
        taskKey: "T01S",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-1s-late-sync",
        dispatchId: "dispatch-1s",
        taskRunId: "dispatch-1s-task-run",
        taskId: "task-record-1s",
        taskKey: "T01S",
        eventType: "session_state_synced",
        createdAt: "2026-03-19T10:08:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.phase).toBe("COMPLETED");
    expect(summary.endedAt).toBe("2026-03-19T10:05:00.000Z");
    expect(summary.totalSeconds).toBe(300);
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

  it("tracks post-coding merge conflict handling under merge instead of coding", () => {
    const task = makeTask({
      id: "T02M",
      title: "Merge conflict resolution",
      record_id: "task-record-2m",
      status: "COMPLETED",
      worker_branch: "feature/t02m",
      pr_url: "https://example.com/pr/2m",
      merge_indicator: "MERGED",
      is_merged: true,
    });
    const dispatch = makeDispatch({
      id: "dispatch-2m",
      taskId: "task-record-2m",
      taskKey: "T02M",
      taskTitle: "Merge conflict resolution",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
      workerBranch: "feature/t02m",
      prUrl: "https://example.com/pr/2m",
    });
    const events = [
      makeEvent({
        id: "evt-2m-a",
        dispatchId: "dispatch-2m",
        taskRunId: "dispatch-2m-task-run",
        taskId: "task-record-2m",
        taskKey: "T02M",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2m-b",
        dispatchId: "dispatch-2m",
        taskRunId: "dispatch-2m-task-run",
        taskId: "task-record-2m",
        taskKey: "T02M",
        eventType: "run_completed",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2m-pr",
        dispatchId: "dispatch-2m",
        taskRunId: "dispatch-2m-task-run",
        taskId: "task-record-2m",
        taskKey: "T02M",
        eventType: "cli_pr_finalized",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2m-c",
        dispatchId: "dispatch-2m",
        taskRunId: "dispatch-2m-task-run",
        taskId: "task-record-2m",
        taskKey: "T02M",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:06:00.000Z",
        payload: { state: "automerge_conflict" },
      }),
      makeEvent({
        id: "evt-2m-d",
        dispatchId: "dispatch-2m",
        taskRunId: "dispatch-2m-task-run",
        taskId: "task-record-2m",
        taskKey: "T02M",
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
    expect(summary.stageTotals.merge).toBe(360);
    expect(summary.stageTotals.ci).toBe(60);
    expect(summary.activeStage).toBeNull();
  });

  it("stops merge timing at automerge success even if later sync events arrive", () => {
    const task = makeTask({
      id: "T02S",
      title: "Automerge success",
      record_id: "task-record-2s",
      status: "COMPLETED",
      worker_branch: "feature/t02s",
      pr_url: "https://example.com/pr/2s",
      merge_indicator: "MERGED",
      is_merged: true,
    });
    const dispatch = makeDispatch({
      id: "dispatch-2s",
      taskId: "task-record-2s",
      taskKey: "T02S",
      taskTitle: "Automerge success",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
      workerBranch: "feature/t02s",
      prUrl: "https://example.com/pr/2s",
    });
    const events = [
      makeEvent({
        id: "evt-2s-start",
        dispatchId: "dispatch-2s",
        taskRunId: "dispatch-2s-task-run",
        taskId: "task-record-2s",
        taskKey: "T02S",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2s-complete",
        dispatchId: "dispatch-2s",
        taskRunId: "dispatch-2s-task-run",
        taskId: "task-record-2s",
        taskKey: "T02S",
        eventType: "run_completed",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2s-pr",
        dispatchId: "dispatch-2s",
        taskRunId: "dispatch-2s-task-run",
        taskId: "task-record-2s",
        taskKey: "T02S",
        eventType: "cli_pr_finalized",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2s-ready",
        dispatchId: "dispatch-2s",
        taskRunId: "dispatch-2s-task-run",
        taskId: "task-record-2s",
        taskKey: "T02S",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:06:00.000Z",
        payload: { state: "ready_for_merge" },
      }),
      makeEvent({
        id: "evt-2s-merged",
        dispatchId: "dispatch-2s",
        taskRunId: "dispatch-2s-task-run",
        taskId: "task-record-2s",
        taskKey: "T02S",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:07:00.000Z",
        payload: { state: "automerge_succeeded" },
      }),
      makeEvent({
        id: "evt-2s-late-sync",
        dispatchId: "dispatch-2s",
        taskRunId: "dispatch-2s-task-run",
        taskId: "task-record-2s",
        taskKey: "T02S",
        eventType: "session_state_synced",
        createdAt: "2026-03-19T10:12:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:15:00.000Z",
    });

    expect(summary.endedAt).toBe("2026-03-19T10:07:00.000Z");
    expect(summary.totalSeconds).toBe(420);
    expect(summary.stageTotals.coding).toBe(300);
    expect(summary.stageTotals.ci).toBe(60);
    expect(summary.stageTotals.merge).toBe(60);
    expect(summary.activeStage).toBeNull();
  });

  it("stops completed task timing at the terminal event even if later sync events arrive", () => {
    const task = makeTask({
      id: "T02A",
      title: "Completed task",
      record_id: "task-record-2a",
      status: "COMPLETED",
    });
    const dispatch = makeDispatch({
      id: "dispatch-2a",
      taskId: "task-record-2a",
      taskKey: "T02A",
      taskTitle: "Completed task",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
    });
    const events = [
      makeEvent({
        id: "evt-2a-start",
        dispatchId: "dispatch-2a",
        taskRunId: "dispatch-2a-task-run",
        taskId: "task-record-2a",
        taskKey: "T02A",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2a-terminal",
        dispatchId: "dispatch-2a",
        taskRunId: "dispatch-2a-task-run",
        taskId: "task-record-2a",
        taskKey: "T02A",
        eventType: "cli_git_no_changes",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2a-late-sync",
        dispatchId: "dispatch-2a",
        taskRunId: "dispatch-2a-task-run",
        taskId: "task-record-2a",
        taskKey: "T02A",
        eventType: "session_state_synced",
        createdAt: "2026-03-19T10:08:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.endedAt).toBe("2026-03-19T10:05:00.000Z");
    expect(summary.totalSeconds).toBe(300);
    expect(summary.stageTotals.coding).toBe(300);
    expect(summary.activeStage).toBeNull();
  });

  it("treats automerged tasks as terminal even if is_merged has not caught up yet", () => {
    const task = makeTask({
      id: "T02B",
      title: "Awaiting merge orchestration",
      record_id: "task-record-2b",
      status: "COMPLETED",
      worker_branch: "feature/t02b",
      pr_url: "https://example.com/pr/2b",
      merge_indicator: "AUTOMERGE",
      is_merged: false,
    });
    const dispatch = makeDispatch({
      id: "dispatch-2b",
      taskId: "task-record-2b",
      taskKey: "T02B",
      taskTitle: "Awaiting merge orchestration",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
      workerBranch: "feature/t02b",
      prUrl: "https://example.com/pr/2b",
    });
    const events = [
      makeEvent({
        id: "evt-2b-start",
        dispatchId: "dispatch-2b",
        taskRunId: "dispatch-2b-task-run",
        taskId: "task-record-2b",
        taskKey: "T02B",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2b-terminal",
        dispatchId: "dispatch-2b",
        taskRunId: "dispatch-2b-task-run",
        taskId: "task-record-2b",
        taskKey: "T02B",
        eventType: "run_completed",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2b-late-sync",
        dispatchId: "dispatch-2b",
        taskRunId: "dispatch-2b-task-run",
        taskId: "task-record-2b",
        taskKey: "T02B",
        eventType: "session_state_synced",
        createdAt: "2026-03-19T10:08:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.phase).toBe("COMPLETED");
    expect(summary.endedAt).toBe("2026-03-19T10:05:00.000Z");
    expect(summary.totalSeconds).toBe(300);
    expect(summary.stageTotals.coding).toBe(300);
    expect(summary.activeStage).toBeNull();
  });

  it("resumes snapshot-skewed merge-backed tasks only after real ci evidence appears", () => {
    const task = makeTask({
      id: "T02C",
      title: "Snapshot skew merge-backed",
      record_id: "task-record-2c",
      status: "RUNNING",
    });
    const dispatch = makeDispatch({
      id: "dispatch-2c",
      taskId: "task-record-2c",
      taskKey: "T02C",
      taskTitle: "Snapshot skew merge-backed",
      status: "completed",
      taskRunState: "COMPLETED",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:05:00.000Z",
      workerBranch: "feature/t02c",
      prUrl: "https://example.com/pr/2c",
    });
    const events = [
      makeEvent({
        id: "evt-2c-start",
        dispatchId: "dispatch-2c",
        taskRunId: "dispatch-2c-task-run",
        taskId: "task-record-2c",
        taskKey: "T02C",
        eventType: "dispatch_started",
        createdAt: "2026-03-19T10:00:00.000Z",
      }),
      makeEvent({
        id: "evt-2c-complete",
        dispatchId: "dispatch-2c",
        taskRunId: "dispatch-2c-task-run",
        taskId: "task-record-2c",
        taskKey: "T02C",
        eventType: "run_completed",
        createdAt: "2026-03-19T10:05:00.000Z",
      }),
      makeEvent({
        id: "evt-2c-ci",
        dispatchId: "dispatch-2c",
        taskRunId: "dispatch-2c-task-run",
        taskId: "task-record-2c",
        taskKey: "T02C",
        eventType: "ci_gate_status",
        createdAt: "2026-03-19T10:06:00.000Z",
        payload: { state: "waiting_checks", hasPendingChecks: true },
      }),
      makeEvent({
        id: "evt-2c-late-sync",
        dispatchId: "dispatch-2c",
        taskRunId: "dispatch-2c-task-run",
        taskId: "task-record-2c",
        taskKey: "T02C",
        eventType: "session_state_synced",
        createdAt: "2026-03-19T10:08:00.000Z",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [dispatch],
      events,
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.phase).toBe("CODING_COMPLETED");
    expect(summary.endedAt).toBe("2026-03-19T10:10:00.000Z");
    expect(summary.totalSeconds).toBe(600);
    expect(summary.stageTotals.coding).toBe(360);
    expect(summary.stageTotals.ci).toBe(240);
    expect(summary.activeStage).toBe("ci");
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

  it("does not inherit task-key timing from an older sprint when a record id is available", () => {
    const task = makeTask({
      id: "T02",
      title: "Fresh Task",
      record_id: "task-record-current",
      sprint_id: "sprint-current",
      project_id: "project-1",
      status: "COMPLETED",
    });
    const currentDispatch = makeDispatch({
      id: "dispatch-current",
      sprintId: "sprint-current",
      taskId: "task-record-current",
      taskKey: "T02",
      taskTitle: "Fresh Task",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:00:38.000Z",
    });
    const oldDispatch = makeDispatch({
      id: "dispatch-old-sprint",
      sprintId: "sprint-old",
      taskId: "task-record-old",
      taskKey: "T02",
      taskTitle: "Old Task",
      startedAt: "2026-03-16T01:44:03.000Z",
      finishedAt: "2026-03-19T10:00:00.000Z",
    });
    const events = [
      makeEvent({
        id: "evt-current",
        sprintId: "sprint-current",
        dispatchId: "dispatch-current",
        taskRunId: "dispatch-current-task-run",
        taskId: "task-record-current",
        taskKey: "T02",
        createdAt: "2026-03-19T10:00:00.000Z",
        eventType: "dispatch_started",
      }),
      makeEvent({
        id: "evt-current-finish",
        sprintId: "sprint-current",
        dispatchId: "dispatch-current",
        taskRunId: "dispatch-current-task-run",
        taskId: "task-record-current",
        taskKey: "T02",
        createdAt: "2026-03-19T10:00:38.000Z",
        eventType: "cli_git_no_changes",
      }),
      makeEvent({
        id: "evt-old",
        sprintId: "sprint-old",
        dispatchId: "dispatch-old-sprint",
        taskRunId: "dispatch-old-sprint-task-run",
        taskId: "task-record-old",
        taskKey: "T02",
        createdAt: "2026-03-16T01:44:03.000Z",
        eventType: "dispatch_started",
      }),
    ];

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [oldDispatch, currentDispatch],
      events,
      nowIso: "2026-03-19T10:01:00.000Z",
    });

    expect(summary.startedAt).toBe("2026-03-19T10:00:00.000Z");
    expect(summary.totalSeconds).toBe(38);
    expect(summary.stageTotals.coding).toBe(38);
  });

  it("scopes task-key fallback to the current sprint when no record id is present", () => {
    const task = makeTask({
      id: "T04",
      title: "Scoped by sprint",
      sprint_id: "sprint-live",
      project_id: "project-1",
      status: "RUNNING",
    });
    const oldDispatch = makeDispatch({
      id: "dispatch-old",
      sprintId: "sprint-old",
      taskId: "task-old",
      taskKey: "T04",
      taskTitle: "Old",
      startedAt: "2026-03-18T01:00:00.000Z",
      finishedAt: null,
      status: "running",
    });
    const liveDispatch = makeDispatch({
      id: "dispatch-live",
      sprintId: "sprint-live",
      taskId: "task-live",
      taskKey: "T04",
      taskTitle: "Live",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: null,
      status: "running",
    });

    const summary = buildLiveTaskTimingSummary({
      task,
      dispatches: [oldDispatch, liveDispatch],
      events: [],
      nowIso: "2026-03-19T10:01:00.000Z",
    });

    expect(summary.startedAt).toBe("2026-03-19T10:00:00.000Z");
    expect(summary.totalSeconds).toBe(60);
  });

  it("does not inherit stale timing for blocked tasks from an older sprint run", () => {
    const task = makeTask({
      id: "T05",
      title: "Blocked task",
      record_id: "task-record-5",
      sprint_id: "sprint-1",
      project_id: "project-1",
      status: "BLOCKED",
    });
    const staleDispatch = makeDispatch({
      id: "dispatch-old-run",
      sprintId: "sprint-1",
      sprintRunId: "run-old",
      taskId: "task-record-5",
      taskKey: "T05",
      taskTitle: "Blocked task",
      startedAt: "2026-03-19T08:00:00.000Z",
      finishedAt: "2026-03-19T08:01:15.000Z",
    });
    const staleEvent = makeEvent({
      id: "evt-old-run",
      sprintId: "sprint-1",
      sprintRunId: "run-old",
      dispatchId: "dispatch-old-run",
      taskRunId: "dispatch-old-run-task-run",
      taskId: "task-record-5",
      taskKey: "T05",
      createdAt: "2026-03-19T08:01:15.000Z",
      eventType: "run_blocked",
    });
    const sprintRuns = [
      makeSprintRun({
        id: "run-old",
        sprintId: "sprint-1",
        startedAt: "2026-03-19T08:00:00.000Z",
        createdAt: "2026-03-19T08:00:00.000Z",
        status: "failed",
      }),
      makeSprintRun({
        id: "run-live",
        sprintId: "sprint-1",
        startedAt: "2026-03-19T10:00:00.000Z",
        createdAt: "2026-03-19T10:00:00.000Z",
        status: "running",
      }),
    ];

    const [summary] = buildLiveTaskTimingSummaries({
      tasks: [task],
      dispatches: [staleDispatch],
      events: [staleEvent],
      sprintRuns,
      nowIso: "2026-03-19T10:01:15.000Z",
    });

    expect(summary.startedAt).toBeNull();
    expect(summary.totalSeconds).toBe(0);
    expect(summary.stageTotals.coding).toBe(0);
    expect(summary.activeStage).toBeNull();
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

  it("omits 'queued' from STATS_DECK_VISIBLE_STAGES while it remains in timing totals", () => {
    expect(STATS_DECK_VISIBLE_STAGES).not.toContain("queued");
    expect(STATS_DECK_VISIBLE_STAGES).toEqual(["coding", "ci", "autofix", "merge"]);

    const tasks = [makeTask({ id: "T01", title: "Queued", status: "RUNNING" })];
    const dispatches = [
      makeDispatch({
        id: "dispatch-1",
        taskId: "task-1",
        taskKey: "T01",
        taskTitle: "Queued",
        status: "queued",
        queuedAt: "2026-03-19T10:00:00.000Z",
        claimedAt: null,
        startedAt: null,
      }),
    ];

    const summary = buildLiveSprintTimingSummary({
      tasks,
      dispatches,
      events: [],
      sprintRuns: [makeSprintRun({ startedAt: "2026-03-19T10:00:00.000Z" })],
      nowIso: "2026-03-19T10:01:00.000Z",
    });

    // Queued time should still exist in the model
    expect(summary.stageTotals.queued).toBe(60);

    // But the stats deck order should not include it
    expect(STATS_DECK_VISIBLE_STAGES).not.toContain("queued");
  });

  it("aggregates token totals from scoped dispatch usage and ignores older sprint runs", () => {
    const tasks = [
      makeTask({
        id: "T01",
        title: "Current sprint task",
        sprint_id: "sprint-current",
        status: "COMPLETED",
      }),
    ];
    const dispatches = [
      makeDispatch({
        id: "dispatch-old",
        sprintRunId: "run-old",
        sprintId: "sprint-old",
        taskId: "task-old",
        taskKey: "T01",
        taskTitle: "Older sprint task",
        startedAt: "2026-03-18T10:00:00.000Z",
        finishedAt: "2026-03-18T10:05:00.000Z",
        usage: makeUsageTotals({ inputTokens: 999, outputTokens: 888, cachedInputTokens: 777 }),
      }),
      makeDispatch({
        id: "dispatch-current-a",
        sprintRunId: "run-current",
        sprintId: "sprint-current",
        taskId: "task-current-a",
        taskKey: "T01",
        taskTitle: "Current sprint task",
        startedAt: "2026-03-19T10:00:00.000Z",
        finishedAt: "2026-03-19T10:03:00.000Z",
        usage: makeUsageTotals({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 30 }),
      }),
      makeDispatch({
        id: "dispatch-current-b",
        sprintRunId: "run-current",
        sprintId: "sprint-current",
        taskId: "task-current-b",
        taskKey: "T02",
        taskTitle: "Second current sprint task",
        startedAt: "2026-03-19T10:05:00.000Z",
        finishedAt: "2026-03-19T10:07:00.000Z",
        usage: makeUsageTotals({ inputTokens: 4, outputTokens: 6, cachedInputTokens: 8 }),
      }),
    ];
    const sprintRuns = [
      makeSprintRun({
        id: "run-old",
        sprintId: "sprint-old",
        startedAt: "2026-03-18T09:00:00.000Z",
        usage: makeUsageTotals({ inputTokens: 500, outputTokens: 400, cachedInputTokens: 300 }),
      }),
      makeSprintRun({
        id: "run-current",
        sprintId: "sprint-current",
        startedAt: "2026-03-19T09:00:00.000Z",
      }),
    ];

    const summary = buildLiveSprintTimingSummary({
      tasks,
      dispatches,
      events: [],
      sprintRuns,
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.tokenTotals).toEqual({
      inputTokens: 14,
      outputTokens: 26,
      cachedInputTokens: 38,
    });
  });

  it("falls back to sprint-run usage when scoped dispatches have no usage data", () => {
    const tasks = [
      makeTask({
        id: "T01",
        title: "Fallback sprint task",
        sprint_id: "sprint-current",
        status: "RUNNING",
      }),
    ];
    const dispatches = [
      makeDispatch({
        id: "dispatch-current",
        sprintId: "sprint-current",
        taskId: "task-current",
        taskKey: "T01",
        taskTitle: "Fallback sprint task",
        startedAt: "2026-03-19T10:00:00.000Z",
        finishedAt: null,
      }),
    ];
    const sprintRuns = [
      makeSprintRun({
        id: "run-current",
        sprintId: "sprint-current",
        startedAt: "2026-03-19T09:00:00.000Z",
        usage: makeUsageTotals({ inputTokens: 41, outputTokens: 52, cachedInputTokens: 63 }),
      }),
    ];

    const summary = buildLiveSprintTimingSummary({
      tasks,
      dispatches,
      events: [],
      sprintRuns,
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.tokenTotals).toEqual({
      inputTokens: 41,
      outputTokens: 52,
      cachedInputTokens: 63,
    });
  });

  it("returns zero token totals when neither dispatch nor sprint-run usage exists", () => {
    const tasks = [makeTask({ id: "T01", title: "No usage task", status: "RUNNING" })];

    const summary = buildLiveSprintTimingSummary({
      tasks,
      dispatches: [],
      events: [],
      sprintRuns: [],
      nowIso: "2026-03-19T10:10:00.000Z",
    });

    expect(summary.tokenTotals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
  });
});
