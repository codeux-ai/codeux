import { expect, test } from "vitest";
import { deriveTaskBoardState } from "../../../dashboard/src/v2/lib/task-board-state.js";
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
  const tasks = Array.from({ length: 30 }, (_, i) => createTask(`${i}`, "pending", "low"));

  const state = deriveTaskBoardState(tasks, "all", "all", 20);
  expect(state.filteredTasks.length).toBe(30);
  expect(state.visibleTasks.length).toBe(20);

  expect(state.stats.total).toBe(30);

  const pendingColumn = state.columns.find(c => c.status === "pending")!;
  expect(pendingColumn.count).toBe(30);
  expect(pendingColumn.tasks.length).toBe(20);
});

test("deriveTaskBoardState: handles coding_completed correctly inside in_progress lane", () => {
  const tasks = [
    createTask("1", "coding_completed", "critical"),
    createTask("2", "in_progress", "high"),
    createTask("3", "pending", "low"),
    createTask("4", "completed", "low"),
  ];

  const state1 = deriveTaskBoardState(tasks, "all", "all", "All");

  // Total filtered and stats total
  expect(state1.filteredTasks.length).toBe(4);
  expect(state1.stats.total).toBe(4);

  // Stats
  expect(state1.stats.inProgress).toBe(2); // 1 in_progress + 1 coding_completed
  expect(state1.stats.completed).toBe(1);
  expect(state1.stats.critical).toBe(1);

  // Columns
  expect(state1.columns.length).toBe(3); // pending, in_progress, completed

  const inProgressCol = state1.columns.find(c => c.status === "in_progress");
  expect(inProgressCol).toBeDefined();
  expect(inProgressCol!.count).toBe(2);
  expect(inProgressCol!.tasks.map(t => t.status)).toContain("in_progress");
  expect(inProgressCol!.tasks.map(t => t.status)).toContain("coding_completed");
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
  ];

  const state = deriveTaskBoardState(tasks, "in_progress", "all", "All");

  expect(state.filteredTasks.length).toBe(2);
  const inProgressCol = state.columns.find(c => c.status === "in_progress")!;
  expect(inProgressCol.count).toBe(2);
});
