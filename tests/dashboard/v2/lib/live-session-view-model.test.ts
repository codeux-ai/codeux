import { describe, expect, it } from "vitest";
import type {
  ExecutionDashboardSnapshot,
  ExecutionInvocationRecord,
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../../../dashboard/src/types.js";
import {
  deriveFilteredLiveSessionTasks,
  deriveLiveSessionStats,
  deriveLiveSessionSnapshotSurface,
  deriveLiveSessionTaskCardItems,
  deriveLiveTransportBannerViewModel,
  deriveProjectedLiveSessionTasks,
  deriveScopedLiveSessionRuntime,
} from "../../../../dashboard/src/v2/lib/live-session-view-model.js";

function createTask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    record_id: "task-record-1",
    project_id: "project-1",
    sprint_id: "sprint-1",
    id: "TASK-1",
    title: "Task 1",
    prompt: "Do the work",
    depends_on: [],
    status: "PENDING",
    is_independent: true,
    ...overrides,
  };
}

function createDispatch(overrides: Partial<ExecutionTaskDispatchSummary> = {}): ExecutionTaskDispatchSummary {
  return {
    id: "dispatch-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintRunId: "run-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    taskId: "task-record-1",
    taskKey: "TASK-1",
    taskTitle: "Task 1",
    status: "running",
    executorType: "docker_cli",
    priority: 0,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    taskRunId: "task-run-1",
    taskRunState: "RUNNING",
    provider: "codex",
    sessionId: "session-1",
    sessionName: "session-1",
    workerBranch: "worker/task-1",
    prUrl: null,
    queuedAt: "2026-03-27T10:00:00.000Z",
    claimedAt: "2026-03-27T10:01:00.000Z",
    startedAt: "2026-03-27T10:02:00.000Z",
    finishedAt: null,
    lastHeartbeatAt: "2026-03-27T10:03:00.000Z",
    errorMessage: null,
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
    ...overrides,
  };
}

function createEvent(overrides: Partial<ExecutionRuntimeEventSummary> = {}): ExecutionRuntimeEventSummary {
  return {
    id: "event-1",
    scopeType: "task_run",
    taskRunId: "task-run-1",
    sprintRunId: "run-1",
    dispatchId: "dispatch-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: "task-record-1",
    taskKey: "TASK-1",
    taskTitle: "Task 1",
    taskRunState: "RUNNING",
    eventType: "run_started",
    originator: "system",
    sourceEventKey: null,
    provider: "codex",
    sessionId: "session-1",
    sessionName: "session-1",
    workerBranch: "worker/task-1",
    prUrl: null,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-03-27T10:02:00.000Z",
    payload: null,
    ...overrides,
  };
}

function createInvocation(overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord {
  return {
    id: "invocation-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-record-1",
    sprintRunId: "run-1",
    dispatchId: "dispatch-1",
    taskRunId: "task-run-1",
    attentionItemId: null,
    providerInvocationId: "provider-invocation-1",
    type: "coding",
    status: "running",
    provider: "codex",
    model: "gpt-5",
    systemPrompt: null,
    startedAt: "2026-03-27T10:02:00.000Z",
    finishedAt: null,
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 1,
    lastMessageAt: "2026-03-27T10:03:00.000Z",
    taskKey: "TASK-1",
    taskTitle: "Task 1",
    createdAt: "2026-03-27T10:02:00.000Z",
    updatedAt: "2026-03-27T10:03:00.000Z",
    ...overrides,
  };
}

function createExecution(overrides: Partial<ExecutionDashboardSnapshot> = {}): ExecutionDashboardSnapshot {
  return {
    projectId: "project-1",
    projectName: "Project 1",
    sprintRuns: [],
    taskDispatches: [],
    connections: [],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems: [],
    recentEvents: [],
    recentInvocations: [],
    updatedAt: "2026-03-27T10:03:00.000Z",
    ...overrides,
  };
}

describe("live-session-view-model", () => {
  it("projects large task lists with sprint-scoped runtime metadata", () => {
    const tasks = Array.from({ length: 1_000 }, (_, index) => createTask({
      record_id: `task-record-${index}`,
      id: `TASK-${index}`,
      title: `Task ${index}`,
      status: index === 400 ? "RUNNING" : index % 2 === 0 ? "PENDING" : "COMPLETED",
    }));
    const dispatches = [
      createDispatch({
        id: "dispatch-target",
        taskId: "task-record-400",
        taskKey: "TASK-400",
        sessionId: "session-target",
        status: "running",
        taskRunState: "RUNNING",
      }),
      createDispatch({
        id: "dispatch-other-sprint",
        sprintId: "sprint-other",
        taskId: "task-record-400",
        taskKey: "TASK-400",
        sessionId: "session-other",
        status: "failed",
        taskRunState: "FAILED",
      }),
    ];

    const projected = deriveProjectedLiveSessionTasks(tasks, dispatches, []);
    const stats = deriveLiveSessionStats(projected, true);
    const filtered = deriveFilteredLiveSessionTasks(projected, stats, "Running");

    expect(projected).toHaveLength(1_000);
    expect(projected[400]?.status).toBe("RUNNING");
    expect(projected[400]?.session_id).toBe("session-target");
    expect(filtered.filteredTasks.map((task) => task.id)).toEqual(["TASK-400"]);
  });

  it("returns empty scoped runtime collections while the runtime snapshot is not ready", () => {
    const scoped = deriveScopedLiveSessionRuntime(createExecution({
      taskDispatches: [createDispatch()],
      recentEvents: [createEvent()],
      recentInvocations: [createInvocation()],
    }), "sprint-1", false);

    expect(scoped.dispatches).toEqual([]);
    expect(scoped.events).toEqual([]);
    expect(scoped.sprintRuns).toEqual([]);
    expect(scoped.invocations).toEqual([]);
  });

  it("selects task invocations through the latest active dispatch identity", () => {
    const dispatches = [
      createDispatch({
        id: "dispatch-old",
        taskRunId: "task-run-old",
        status: "failed",
        taskRunState: "FAILED",
        queuedAt: "2026-03-27T09:00:00.000Z",
        startedAt: "2026-03-27T09:01:00.000Z",
        finishedAt: "2026-03-27T09:02:00.000Z",
      }),
      createDispatch({
        id: "dispatch-active",
        taskRunId: "task-run-active",
        status: "running",
        taskRunState: "RUNNING",
        queuedAt: "2026-03-27T10:00:00.000Z",
        startedAt: "2026-03-27T10:01:00.000Z",
      }),
    ];

    const [item] = deriveLiveSessionTaskCardItems({
      filteredTasks: [createTask({ status: "RUNNING" })],
      dispatches,
      events: [],
      invocations: [
        createInvocation({
          id: "invocation-active-dispatch",
          taskId: null,
          taskKey: null,
          dispatchId: "dispatch-active",
          taskRunId: null,
        }),
        createInvocation({
          id: "invocation-active-task-run",
          taskId: null,
          taskKey: null,
          dispatchId: null,
          taskRunId: "task-run-active",
        }),
        createInvocation({
          id: "invocation-unrelated",
          taskId: "other-task",
          taskKey: "OTHER",
          dispatchId: "dispatch-other",
          taskRunId: "task-run-other",
        }),
      ],
      taskTimingMap: new Map(),
      rerunningIds: new Set(),
      forceCompletePendingIds: new Set(),
      forceCompleteErrorByTaskId: new Map(),
      optimisticallyCompletedTaskIds: new Set(),
    });

    expect(item?.invocations.map((invocation) => invocation.id)).toEqual([
      "invocation-active-dispatch",
      "invocation-active-task-run",
    ]);
    expect(item?.dispatchInfo?.status).toBe("running");
  });

  it("derives stale transport banner states without snapshot mutation", () => {
    expect(deriveLiveTransportBannerViewModel({
      transportState: "connected",
      isRecovering: false,
      error: null,
      snapshotUpdatedAt: "2026-03-27T10:03:00.000Z",
      nowMs: new Date("2026-03-27T10:03:30.000Z").getTime(),
    })).toBeNull();

    expect(deriveLiveTransportBannerViewModel({
      transportState: "disconnected",
      isRecovering: false,
      error: null,
    })).toMatchObject({
      title: "Disconnected",
      role: "alert",
      ariaLive: "assertive",
      isVisible: true,
    });

    expect(deriveLiveTransportBannerViewModel({
      transportState: "reconnecting",
      isRecovering: true,
      error: null,
    })).toMatchObject({
      title: "Reconnecting",
      role: "status",
      ariaLive: "polite",
      ariaBusy: true,
      isVisible: true,
    });

    expect(deriveLiveTransportBannerViewModel({
      transportState: "connected",
      isRecovering: true,
      error: null,
      snapshotUpdatedAt: "2026-03-27T10:03:00.000Z",
    })).toMatchObject({
      title: "Refreshing Live Data",
      message: expect.stringContaining("current runtime snapshot visible"),
      role: "status",
      ariaLive: "polite",
      ariaBusy: true,
      isVisible: true,
    });

    expect(deriveLiveTransportBannerViewModel({
      transportState: "connected",
      isRecovering: true,
      error: null,
      snapshotUpdatedAt: null,
    })).toMatchObject({
      title: "Recovering Live Data",
      message: expect.stringContaining("first runtime snapshot"),
      role: "status",
      ariaLive: "polite",
      ariaBusy: true,
      isVisible: true,
    });

    expect(deriveLiveTransportBannerViewModel({
      transportState: "connected",
      isRecovering: false,
      error: null,
      snapshotUpdatedAt: "2026-03-27T10:03:00.000Z",
      nowMs: new Date("2026-03-27T10:04:01.000Z").getTime(),
    })).toMatchObject({
      title: "Stale Data",
      message: expect.stringContaining("snapshot is more than a minute old"),
      role: "status",
      ariaLive: "polite",
      ariaBusy: false,
      isVisible: true,
    });
  });

  it("derives snapshot surface state for reconnecting, recovering, stale, and live runtime panels", () => {
    expect(deriveLiveSessionSnapshotSurface({
      transportState: "disconnected",
      isRecovering: false,
    })).toMatchObject({
      kind: "reconnecting",
      label: "Reconnecting",
      isBusy: true,
    });

    expect(deriveLiveSessionSnapshotSurface({
      transportState: "connected",
      isRecovering: true,
      snapshotUpdatedAt: null,
    })).toMatchObject({
      kind: "recovering",
      label: "Awaiting Snapshot",
      isBusy: true,
    });

    expect(deriveLiveSessionSnapshotSurface({
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2026-03-27T10:03:00.000Z",
      error: "Network failure",
    })).toMatchObject({
      kind: "recovering",
      label: "Retrying Load",
      isBusy: true,
    });

    expect(deriveLiveSessionSnapshotSurface({
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2026-03-27T10:03:00.000Z",
      transportBannerTitle: "Stale Data",
    })).toMatchObject({
      kind: "stale",
      label: "Stale Snapshot",
      isBusy: true,
    });

    expect(deriveLiveSessionSnapshotSurface({
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2026-03-27T10:03:00.000Z",
    })).toMatchObject({
      kind: "live",
      label: "Live",
      isBusy: false,
    });
  });

  it("keeps force-complete optimistic state task-scoped and rolls back from explicit errors", () => {
    const [pendingItem] = deriveLiveSessionTaskCardItems({
      filteredTasks: [createTask({ record_id: "task-record-1", id: "TASK-1", status: "RUNNING" })],
      dispatches: [],
      events: [],
      invocations: [],
      taskTimingMap: new Map(),
      rerunningIds: new Set(),
      forceCompletePendingIds: new Set(["task-record-1"]),
      forceCompleteErrorByTaskId: new Map(),
      optimisticallyCompletedTaskIds: new Set(["task-record-1"]),
    });

    expect(pendingItem?.task.status).toBe("COMPLETED");
    expect(pendingItem?.phase).toBe("COMPLETED");
    expect(pendingItem?.isForceCompleting).toBe(true);
    expect(pendingItem?.forceCompleteError).toBeNull();

    const [rolledBackItem] = deriveLiveSessionTaskCardItems({
      filteredTasks: [createTask({ record_id: "task-record-1", id: "TASK-1", status: "RUNNING" })],
      dispatches: [],
      events: [],
      invocations: [],
      taskTimingMap: new Map(),
      rerunningIds: new Set(),
      forceCompletePendingIds: new Set(),
      forceCompleteErrorByTaskId: new Map([["task-record-1", "force complete failed"]]),
      optimisticallyCompletedTaskIds: new Set(),
    });

    expect(rolledBackItem?.task.status).toBe("RUNNING");
    expect(rolledBackItem?.phase).toBe("RUNNING");
    expect(rolledBackItem?.isForceCompleting).toBe(false);
    expect(rolledBackItem?.forceCompleteError).toBe("force complete failed");
  });
});
