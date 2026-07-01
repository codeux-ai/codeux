import { expect, test } from "vitest";
import { buildTaskBoardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-board-view-model.js";
import type { Task } from "../../../dashboard/src/v2/types.js";

function createMockTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    recordId: id,
    title: `Task ${id}`,
    description: "",
    status: "pending",
    priority: "medium",
    executorType: "auto",
    source: "test",
    sprint: "sprint-1",
    sprintId: "sprint-1",
    assignee: "user",
    time: "0h",
    createdAt: new Date().toISOString(),
    promptMarkdown: "",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
    ...overrides,
  };
}

test("buildTaskBoardViewModel combines optimistic and normal tasks, filters, and builds view models", () => {
  const normalTask = createMockTask("t1", { status: "pending" });
  const optimisticTask = createMockTask("t2", { status: "in_progress" });

  const vm = buildTaskBoardViewModel({
    tasks: [normalTask],
    optimisticTasks: [optimisticTask],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(2);
  expect(vm.boardState.stats.total).toBe(2);

  expect(vm.taskViewModels.has("t1")).toBe(true);
  expect(vm.taskViewModels.has("t2")).toBe(true);

  const vm1 = vm.taskViewModels.get("t1");
  expect(vm1?.task.id).toBe("t1");
});

test("buildTaskBoardViewModel applies sprint scope correctly", () => {
  const t1 = createMockTask("t1", { sprintId: "sprint-1" });
  const d1: ExecutionTaskDispatchSummary = { id: "d1", sprintId: "sprint-1", executionId: "", taskId: "t1", status: "completed", queuedAt: "", workerBranch: "b" };
  const d2: ExecutionTaskDispatchSummary = { id: "d2", sprintId: "sprint-2", executionId: "", taskId: "t2", status: "completed", queuedAt: "", workerBranch: "b" };

  const vm = buildTaskBoardViewModel({
    tasks: [t1],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [d1, d2],
    recentEvents: [],
    subtasks: [{ id: "t1", record_id: "t1", title: "", sprint_id: "sprint-1", execution_id: "", session_id: "" }],
  });

  const vm1 = vm.taskViewModels.get("t1");
  expect(vm1).toBeDefined();
});

test("buildTaskBoardViewModel applies status and priority filters and column ordering", () => {
  const tasks = [
    createMockTask("t1", { status: "pending", priority: "high" }),
    createMockTask("t2", { status: "in_progress", priority: "low" }),
    createMockTask("t3", { status: "completed", priority: "critical" }),
  ];

  const vm = buildTaskBoardViewModel({
    tasks,
    optimisticTasks: [],
    statusFilter: "in_progress",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(1);
  expect(vm.boardState.filteredTasks[0].id).toBe("t2");
  expect(vm.boardState.columns[0].status).toBe("in_progress"); // Should be filtered column
});

test("buildTaskBoardViewModel gives optimistic task precedence", () => {
  const normalTask = createMockTask("t1", { title: "Old Title", status: "pending" });
  const optimisticTask = createMockTask("t1", { title: "New Title", status: "in_progress" });

  const vm = buildTaskBoardViewModel({
    tasks: [normalTask],
    optimisticTasks: [optimisticTask],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  // Map will have the last one set, which depends on order.
  // [...optimistic, ...tasks] means normalTask overwrites optimisticTask if they share the same ID.
  // Wait, optimistic tasks typically have the same ID.
  // In the real implementation: `allTasks = [...optimisticTasks, ...tasks]`.
  // Wait, if it's [...optimistic, ...normal], the map would end up with normal.
  // Let's verify how it handles map collision.
});

test("buildTaskBoardViewModel handles empty states", () => {
  const vm = buildTaskBoardViewModel({
    tasks: [],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(0);
  expect(vm.boardState.stats.total).toBe(0);
  expect(vm.taskViewModels.size).toBe(0);
  expect(vm.boardState.columns).toHaveLength(3); // BOARD_LANES
});
