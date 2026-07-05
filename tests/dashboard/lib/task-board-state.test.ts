import { expect, test } from "vitest";
import { deriveTaskBoardState, getTaskLane } from "../../../dashboard/src/v2/lib/task-board-state.js";
import { buildTaskFilterAnnouncement } from "../../../dashboard/src/v2/lib/tasks/task-board-view-model.js";
import type { Task, TaskPriority, TaskStatus } from "../../../dashboard/src/v2/types.js";

function createTask(id: string, status: TaskStatus, priority: TaskPriority): Task {
  return {
    id,
    recordId: id,
    status,
    priority,
    source: "source",
    sprint: "sprint",
    sprintId: "sprint",
    title: "title",
    executorType: "auto",
    assignee: "assignee",
    time: "time",
    createdAt: "date",
    promptMarkdown: "",
    description: "",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
  };
}

test("deriveTaskBoardState: applies status and priority filters", () => {
  const tasks = [
    createTask("1", "pending", "critical"),
    createTask("2", "in_progress", "high"),
    createTask("3", "pending", "low"),
  ];

  const state1 = deriveTaskBoardState(tasks, "all", "all", "All");
  expect(state1.filteredTasks.length).toBe(3);
  expect(state1.stats.total).toBe(3);
  expect(state1.stats.critical).toBe(1);

  const state2 = deriveTaskBoardState(tasks, "pending", "all", "All");
  expect(state2.filteredTasks.length).toBe(2);
  expect(state2.columns.length).toBe(1);
  expect(state2.columns[0].status).toBe("pending");
  expect(state2.columns[0].count).toBe(2);

  const state3 = deriveTaskBoardState(tasks, "all", "critical", "All");
  expect(state3.filteredTasks.length).toBe(1);
  expect(state3.columns.find(c => c.status === "pending")?.count).toBe(1);
  expect(state3.columns.find(c => c.status === "in_progress")?.count).toBe(0);
});

test("deriveTaskBoardState: applies list window and caps visible tasks but retains counts in stats and column headers", () => {
  const tasks = [
    ...Array.from({ length: 30 }, (_, i) => createTask(`pending-${i}`, "pending", "low")),
    ...Array.from({ length: 4 }, (_, i) => createTask(`done-${i}`, "completed", "critical")),
  ];

  const state = deriveTaskBoardState(tasks, "all", "all", 20);
  expect(state.filteredTasks.length).toBe(34);
  expect(state.visibleTasks.length).toBe(20);

  expect(state.stats.total).toBe(34);
  expect(state.stats.completed).toBe(4);
  expect(state.stats.critical).toBe(4);

  const pendingColumn = state.columns.find(c => c.status === "pending")!;
  const completedColumn = state.columns.find(c => c.status === "completed")!;
  expect(pendingColumn.count).toBe(30);
  expect(pendingColumn.tasks.length).toBe(20);
  expect(completedColumn.count).toBe(4);
  expect(completedColumn.tasks.length).toBe(0);
});

test("deriveTaskBoardState: handles mapped statuses correctly inside in_progress lane", () => {
  const tasks = [
    createTask("1", "coding_completed", "critical"),
    createTask("2", "in_progress", "high"),
    createTask("3", "pending", "low"),
    createTask("4", "completed", "low"),
    createTask("5", "QA_REVIEW_FAILED", "medium"),
  ];

  const state1 = deriveTaskBoardState(tasks, "all", "all", "All");

  // Total filtered and stats total
  expect(state1.filteredTasks.length).toBe(5);
  expect(state1.stats.total).toBe(5);

  // Stats
  expect(state1.stats.inProgress).toBe(3);
  expect(state1.stats.completed).toBe(1);
  expect(state1.stats.critical).toBe(1);

  // Columns
  expect(state1.columns.length).toBe(3); // pending, in_progress, completed

  const inProgressCol = state1.columns.find(c => c.status === "in_progress");
  expect(inProgressCol).toBeDefined();
  expect(inProgressCol!.count).toBe(3);
  expect(inProgressCol!.tasks.map(t => t.status)).toContain("in_progress");
  expect(inProgressCol!.tasks.map(t => t.status)).toContain("coding_completed");
  expect(inProgressCol!.tasks.map(t => t.status)).toContain("QA_REVIEW_FAILED");
});

test("deriveTaskBoardState: handles filtered status view when filtering by all", () => {
  const tasks = [
    createTask("1", "coding_completed", "critical"),
  ];

  // when filtered by "all", "in_progress" column should contain the coding_completed task.
  const state = deriveTaskBoardState(tasks, "all", "all", "All");

  const inProgressCol = state.columns.find(c => c.status === "in_progress")!;
  expect(inProgressCol.count).toBe(1);
});

test("deriveTaskBoardState: filtered views - filtering by in_progress shows both in_progress and coding_completed", () => {
  const tasks = [
    createTask("1", "coding_completed", "critical"),
    createTask("2", "in_progress", "high"),
    createTask("3", "pending", "low"),
    createTask("4", "QA_REVIEW_FAILED", "medium"),
  ];

  const state = deriveTaskBoardState(tasks, "in_progress", "all", "All");

  expect(state.filteredTasks.length).toBe(3);
  const inProgressCol = state.columns.find(c => c.status === "in_progress")!;
  expect(inProgressCol.count).toBe(3);
  expect(inProgressCol.tasks.map((task) => task.id)).toEqual(["1", "2", "4"]);
});

test("deriveTaskBoardState: keeps empty columns stable for empty all-status boards", () => {
  const state = deriveTaskBoardState([], "all", "all", "All");

  expect(state.filteredTasks).toEqual([]);
  expect(state.visibleTasks).toEqual([]);
  expect(state.stats).toEqual({
    total: 0,
    inProgress: 0,
    completed: 0,
    critical: 0,
  });
  expect(state.columns).toEqual([
    { status: "pending", count: 0, tasks: [] },
    { status: "in_progress", count: 0, tasks: [] },
    { status: "completed", count: 0, tasks: [] },
  ]);
});

test("getTaskLane: correctly maps statuses to lanes", () => {
  expect(getTaskLane("pending")).toBe("pending");
  expect(getTaskLane("completed")).toBe("completed");
  expect(getTaskLane("in_progress")).toBe("in_progress");
  expect(getTaskLane("coding_completed")).toBe("in_progress");
  expect(getTaskLane("QA_REVIEW_FAILED")).toBe("in_progress");
});

test("buildTaskFilterAnnouncement describes filtered result scope and visible count", () => {
  expect(buildTaskFilterAnnouncement({
    totalCount: 3,
    visibleCount: 2,
    statusFilter: "in_progress",
    priorityFilter: "critical",
    scopeLabel: "selected sprint",
  })).toBe("Task board now shows 3 tasks, 2 currently visible in selected sprint for In Progress status and critical priority.");
});
