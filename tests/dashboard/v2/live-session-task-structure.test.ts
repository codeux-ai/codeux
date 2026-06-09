import { describe, expect, it } from "vitest";
import type {
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../../dashboard/src/types.js";
import type { Task } from "../../../dashboard/src/v2/types.js";
import { buildLiveSessionTasks } from "../../../dashboard/src/v2/lib/live-session-task-structure.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    recordId: "task-record-1",
    id: "TASK-1",
    source: "Project 1",
    sprint: "Sprint 1",
    sprintId: "sprint-1",
    title: "Ship it",
    status: "in_progress",
    priority: "medium",
    executorType: "docker_cli",
    assignee: "Runner",
    time: "Active",
    createdAt: "2026-03-26T10:00:00.000Z",
    promptMarkdown: "Do the work",
    description: "",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
    ...overrides,
  };
}

function createRuntimeTask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    record_id: "task-record-1",
    project_id: "project-1",
    sprint_id: "sprint-1",
    id: "TASK-1",
    title: "Ship it",
    prompt: "Do the work",
    depends_on: [],
    status: "RUNNING",
    session_id: "session-1",
    provider: "gemini",
    is_independent: true,
    is_merged: false,
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
    taskTitle: "Ship it",
    status: "blocked",
    executorType: "docker_cli",
    priority: 10,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    taskRunId: "task-run-1",
    taskRunState: "BLOCKED",
    provider: "codex",
    sessionId: "dispatch-session-1",
    sessionName: "sessions/dispatch-session-1",
    workerBranch: "feature/task-1",
    prUrl: "https://example.com/pr/1",
    queuedAt: "2026-03-27T10:00:00.000Z",
    claimedAt: "2026-03-27T10:01:00.000Z",
    startedAt: "2026-03-27T10:02:00.000Z",
    finishedAt: "2026-03-27T10:03:00.000Z",
    lastHeartbeatAt: "2026-03-27T10:03:00.000Z",
    errorMessage: "Blocked waiting for review",
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
    taskTitle: "Ship it",
    taskRunState: "BLOCKED",
    eventType: "run_blocked",
    originator: "system",
    sourceEventKey: null,
    provider: "codex",
    sessionId: "dispatch-session-1",
    sessionName: "sessions/dispatch-session-1",
    workerBranch: "feature/task-1",
    prUrl: "https://example.com/pr/1",
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-03-27T10:03:00.000Z",
    payload: null,
    ...overrides,
  };
}

describe("live-session-task-structure", () => {
  it("uses stable project task structure when runtime tasks are empty", () => {
    const result = buildLiveSessionTasks([
      createTask(),
      createTask({ recordId: "task-record-2", id: "TASK-2", dependsOnTaskIds: ["task-record-1"], status: "pending" }),
    ], [], "project-1");

    expect(result).toHaveLength(2);
    expect(result[0]?.status).toBe("RUNNING");
    expect(result[1]?.status).toBe("PENDING");
    expect(result[1]?.depends_on).toEqual(["TASK-1"]);
  });

  it("overlays runtime task state onto the stable task structure", () => {
    const result = buildLiveSessionTasks([
      createTask({ status: "pending" }),
    ], [
      createRuntimeTask({ status: "FAILED", session_id: "session-2", worker_branch: "feature/task-1" }),
    ], "project-1");

    expect(result[0]?.status).toBe("FAILED");
    expect(result[0]?.session_id).toBe("session-2");
    expect(result[0]?.worker_branch).toBe("feature/task-1");
  });

  it("matches runtime tasks by task key when the record id is missing", () => {
    const result = buildLiveSessionTasks([
      createTask(),
    ], [
      createRuntimeTask({ record_id: undefined, status: "CODING_COMPLETED", id: "TASK-1", worker_branch: "feature/task-1" }),
    ], "project-1");

    expect(result[0]?.status).toBe("CODING_COMPLETED");
  });

  it("overlays dispatch runtime metadata so cards keep session and provider context", () => {
    const result = buildLiveSessionTasks([
      createTask({ status: "pending" }),
    ], [
      createRuntimeTask({ status: "PENDING", session_id: undefined, provider: undefined }),
    ], "project-1", [
      createDispatch(),
    ]);

    expect(result[0]?.status).toBe("BLOCKED");
    expect(result[0]?.provider).toBe("codex");
    expect(result[0]?.session_id).toBe("dispatch-session-1");
    expect(result[0]?.worker_branch).toBe("feature/task-1");
    expect(result[0]?.pr_url).toBe("https://example.com/pr/1");
    expect(result[0]?.session_state).toBe("BLOCKED");
  });

  it("uses terminal runtime events to keep the live task phase monotonic", () => {
    const result = buildLiveSessionTasks([
      createTask({ status: "pending" }),
    ], [
      createRuntimeTask({ status: "PENDING", session_id: undefined, provider: undefined }),
    ], "project-1", [], [
      createEvent(),
    ]);

    expect(result[0]?.status).toBe("BLOCKED");
  });
});

it("isolates runtime task states and execution metadata to the correct sprint scope even when tasks share the same ID", () => {
    const result = buildLiveSessionTasks([
      createTask({ recordId: "rec-1", sprintId: "sprint-1", status: "pending", id: "T1" }),
      createTask({ recordId: "rec-2", sprintId: "sprint-2", status: "pending", id: "T1" }),
    ], [
      createRuntimeTask({ record_id: "rec-2", sprint_id: "sprint-2", status: "RUNNING", id: "T1", session_id: "session-2", provider: "jules" }),
    ], "project-1", [
      createDispatch({ id: "dispatch-2", sprintId: "sprint-2", status: "running", taskRunState: "RUNNING", taskKey: "T1", taskId: "rec-2", sessionId: "session-2" }),
    ], [
      createEvent({ id: "event-2", sprintId: "sprint-2", taskRunState: "RUNNING", eventType: "run_started", taskKey: "T1", taskId: "rec-2", sessionId: "session-2" })
    ]);

    expect(result).toHaveLength(2);

    // The sprint 1 task should NOT pick up the sprint 2 runtime state
    expect(result[0]?.sprint_id).toBe("sprint-1");
    expect(result[0]?.status).toBe("PENDING");
    expect(result[0]?.session_id).toBeUndefined();

    // The sprint 2 task SHOULD pick up the sprint 2 runtime state. The dispatch
    // is still RUNNING (taskRunState RUNNING), so the live phase stays RUNNING —
    // a finished-but-still-running dispatch is no longer assumed COMPLETED.
    expect(result[1]?.sprint_id).toBe("sprint-2");
    expect(result[1]?.status).toBe("RUNNING");
    expect(result[1]?.session_id).toBe("session-2");
  });
