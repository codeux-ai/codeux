import { describe, expect, it } from "vitest";
import type {
  ExecutionAttentionItemSummary,
  ExecutionConnectionSummary,
  ExecutionDashboardSnapshot,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
} from "../../../dashboard/src/types.js";
import { deriveExecutionRuntimeViewModel } from "../../../dashboard/src/v2/lib/live-session/execution-runtime-view-model.js";

function createSnapshot(overrides: Partial<ExecutionDashboardSnapshot> = {}): ExecutionDashboardSnapshot {
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

function createSprintRun(overrides: Partial<ExecutionSprintRunSummary> = {}): ExecutionSprintRunSummary {
  return {
    id: "run-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    status: "running",
    triggerType: "manual",
    triggeredBy: null,
    executorMode: "mixed",
    startedAt: "2026-03-27T10:00:00.000Z",
    finishedAt: null,
    lastHeartbeatAt: "2026-03-27T10:03:00.000Z",
    createdAt: "2026-03-27T10:00:00.000Z",
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
    humanIntervention: null,
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

function createConnection(overrides: Partial<ExecutionConnectionSummary> = {}): ExecutionConnectionSummary {
  return {
    id: "connection-1",
    connectionKey: "worker-1",
    displayName: "Worker 1",
    role: "worker",
    transport: "stdio",
    status: "online",
    model: null,
    instruction: null,
    labels: [],
    listenMode: false,
    machineName: null,
    platform: null,
    arch: null,
    localExecutionRuntime: null,
    lastHeartbeatAt: "2026-03-27T10:03:00.000Z",
    projectIds: ["project-1"],
    activeProjectIds: ["project-1"],
    tasksRunCount: 0,
    threadCount: 0,
    messageCount: 0,
    pendingInboxCount: 0,
    activeDispatchCount: 0,
    ...overrides,
  };
}

function createAttentionItem(overrides: Partial<ExecutionAttentionItemSummary> = {}): ExecutionAttentionItemSummary {
  return {
    id: "attention-1",
    sprintId: "sprint-1",
    taskId: null,
    sprintRunId: "run-1",
    dispatchId: null,
    attentionType: "manual_attention",
    severity: "medium",
    ownerType: "human",
    status: "open",
    assignedWorkerEndpointId: null,
    title: "Review needed",
    summaryMarkdown: "Review needed",
    payload: null,
    openedAt: "2026-03-27T10:00:00.000Z",
    claimedAt: null,
    resolvedAt: null,
    updatedAt: "2026-03-27T10:00:00.000Z",
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

describe("deriveExecutionRuntimeViewModel", () => {
  it("returns empty collections and zero counters for empty snapshots", () => {
    const viewModel = deriveExecutionRuntimeViewModel(createSnapshot());

    expect(viewModel.activeSprintRuns).toEqual([]);
    expect(viewModel.activeDispatches).toEqual([]);
    expect(viewModel.activeConnections).toEqual([]);
    expect(viewModel.visibleSprintRuns).toEqual([]);
    expect(viewModel.visibleTaskDispatches).toEqual([]);
    expect(viewModel.pendingInboxTotal).toBe(0);
    expect(viewModel.blockedAttentionCount).toBe(0);
    expect(viewModel.failedTaskCount).toBe(0);
    expect(viewModel.dispatchEventsByDispatchId.size).toBe(0);
    expect(viewModel.runtimeSummary).toBe("0 active runs, 0 active dispatches, 0 attention items, 0 failed dispatches.");
  });

  it("filters running and queued runtime work while keeping non-active states visible", () => {
    const sprintRuns = [
      createSprintRun({ id: "run-running", status: "running" }),
      createSprintRun({ id: "run-queued", status: "queued" }),
      createSprintRun({ id: "run-paused", status: "paused" }),
      createSprintRun({ id: "run-cancel-requested", status: "cancel_requested" }),
      createSprintRun({ id: "run-blocked", status: "blocked" }),
    ];
    const taskDispatches = [
      createDispatch({ id: "dispatch-queued", status: "queued" }),
      createDispatch({ id: "dispatch-claimed", status: "claimed" }),
      createDispatch({ id: "dispatch-running", status: "running" }),
      createDispatch({ id: "dispatch-paused", status: "paused" }),
      createDispatch({ id: "dispatch-blocked", status: "blocked" }),
      createDispatch({ id: "dispatch-quota", status: "quota" }),
      createDispatch({ id: "dispatch-cancel-requested", status: "cancel_requested" }),
    ];

    const viewModel = deriveExecutionRuntimeViewModel(createSnapshot({ sprintRuns, taskDispatches }));

    expect(viewModel.activeSprintRuns.map((run) => run.id)).toEqual(["run-running", "run-queued"]);
    expect(viewModel.activeDispatches.map((dispatch) => dispatch.id)).toEqual([
      "dispatch-queued",
      "dispatch-claimed",
      "dispatch-running",
    ]);
    expect(viewModel.visibleSprintRuns.map((run) => run.id)).toEqual([
      "run-running",
      "run-queued",
      "run-paused",
      "run-cancel-requested",
    ]);
    expect(viewModel.visibleTaskDispatches.map((dispatch) => dispatch.id)).toContain("dispatch-quota");
    expect(viewModel.visibleTaskDispatches.map((dispatch) => dispatch.id)).toContain("dispatch-cancel-requested");
  });

  it("excludes offline connections from active connections without dropping inbox counts", () => {
    const viewModel = deriveExecutionRuntimeViewModel(createSnapshot({
      connections: [
        createConnection({ id: "online", status: "online", pendingInboxCount: 2 }),
        createConnection({ id: "offline", status: "offline", pendingInboxCount: 3 }),
      ],
    }));

    expect(viewModel.activeConnections.map((connection) => connection.id)).toEqual(["online"]);
    expect(viewModel.pendingInboxTotal).toBe(5);
  });

  it("counts failed dispatches and open or claimed attention items", () => {
    const viewModel = deriveExecutionRuntimeViewModel(createSnapshot({
      taskDispatches: [
        createDispatch({ id: "failed-1", status: "failed" }),
        createDispatch({ id: "blocked-1", status: "blocked" }),
        createDispatch({ id: "failed-2", status: "failed" }),
      ],
      attentionItems: [
        createAttentionItem({ id: "open", status: "open" }),
        createAttentionItem({ id: "claimed", status: "claimed" }),
        createAttentionItem({ id: "resolved", status: "resolved" }),
      ],
    }));

    expect(viewModel.failedTaskCount).toBe(2);
    expect(viewModel.blockedAttentionCount).toBe(2);
  });

  it("associates dispatch events by dispatch ID and task run ID", () => {
    const viewModel = deriveExecutionRuntimeViewModel(createSnapshot({
      taskDispatches: [
        createDispatch({ id: "dispatch-1", taskRunId: "task-run-1" }),
        createDispatch({ id: "dispatch-2", taskRunId: "task-run-2" }),
      ],
      recentEvents: [
        createEvent({ id: "by-dispatch", dispatchId: "dispatch-1", taskRunId: null }),
        createEvent({ id: "by-task-run", dispatchId: null, taskRunId: "task-run-2" }),
        createEvent({ id: "by-both-once", dispatchId: "dispatch-2", taskRunId: "task-run-2" }),
        createEvent({ id: "unmatched", dispatchId: "missing", taskRunId: "missing" }),
      ],
    }));

    expect(viewModel.dispatchEventsByDispatchId.get("dispatch-1")?.map((event) => event.id)).toEqual(["by-dispatch"]);
    expect(viewModel.dispatchEventsByDispatchId.get("dispatch-2")?.map((event) => event.id)).toEqual([
      "by-task-run",
      "by-both-once",
    ]);
  });
});

