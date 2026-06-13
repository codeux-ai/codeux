import { expect, test } from "vitest";
import { deriveTasksPageState } from "../../../dashboard/src/v2/lib/tasks/tasks-page-state.js";
import type { Task, TaskPriority, TaskStatus } from "../../../dashboard/src/v2/types.js";
import type { Subtask, ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary } from "../../../dashboard/src/types.js";

function createTask(recordId: string, status: TaskStatus, priority: TaskPriority, sprintId: string = "sprint-1"): Task {
  return {
    id: `id-${recordId}`,
    recordId,
    status,
    priority,
    source: "source",
    sprint: "sprint",
    sprintId,
    title: `Task ${recordId}`,
    executorType: "auto",
    assignee: "assignee",
    time: "time",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promptMarkdown: "",
    description: "",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
  };
}

test("deriveTasksPageState: combines tasks and optimistic tasks", () => {
  const tasks = [createTask("task-1", "pending", "medium")];
  const optimisticTasks = [createTask("opt-1", "pending", "high")];

  const state = deriveTasksPageState({
    tasks,
    optimisticTasks,
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: "All",
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(state.allTasks.length).toBe(2);
  expect(state.allTasks[0].recordId).toBe("opt-1"); // Optimistic first
  expect(state.taskLookup.has("task-1")).toBe(true);
  expect(state.taskLookup.has("opt-1")).toBe(true);
});

test("deriveTasksPageState: scopes dispatches and events to sprint", () => {
  const tasks = [createTask("task-1", "in_progress", "medium", "sprint-1")];
  
  const taskDispatches: ExecutionTaskDispatchSummary[] = [
    { recordId: "task-1", sprintId: "sprint-1", sessionId: "sessions/session-1", status: "running" },
    { recordId: "task-2", sprintId: "sprint-2", sessionId: "sessions/session-2", status: "running" },
  ];
  
  const recentEvents: ExecutionRuntimeEventSummary[] = [
    { recordId: "task-1", sprintId: "sprint-1", type: "started", timestamp: new Date().toISOString() },
    { recordId: "task-2", sprintId: "sprint-2", type: "started", timestamp: new Date().toISOString() },
  ];

  const subtasks: Subtask[] = [
    { id: "task-1", record_id: "task-1", status: "RUNNING", session_id: "sessions/session-1" } as any
  ];

  const state = deriveTasksPageState({
    tasks,
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: "All",
    taskScopeSprintId: "sprint-1",
    taskDispatches,
    recentEvents,
    subtasks,
  });

  const vm = state.taskViewModels.get("task-1")!;
  expect(vm.sessionId).toBe("session-1");
});

test("deriveTasksPageState: live enrichment by recordId", () => {
  const tasks = [createTask("task-1", "in_progress", "medium")];
  
  const subtasks: Subtask[] = [
    { id: "some-internal-id", record_id: "task-1", status: "RUNNING", session_id: "sessions/live-session" } as any
  ];

  const state = deriveTasksPageState({
    tasks,
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: "All",
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks,
  });

  const vm = state.taskViewModels.get("task-1")!;
  expect(vm.sessionId).toBe("live-session");
});

test("deriveTasksPageState: maintains column counts from deriveTaskBoardState", () => {
  const tasks = [
    createTask("1", "pending", "medium"),
    createTask("2", "in_progress", "medium"),
    createTask("3", "completed", "medium"),
  ];

  const state = deriveTasksPageState({
    tasks,
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: "All",
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(state.columns.length).toBe(3);
  expect(state.stats.total).toBe(3);
  expect(state.columns.find(c => c.status === "pending")?.count).toBe(1);
});
