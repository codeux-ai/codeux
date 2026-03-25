import { describe, it, expect } from "vitest";
import { buildDependentTasksMap } from "../../../dashboard/src/v2/lib/task-relations.js";
import type { Task } from "../../../dashboard/src/v2/types.js";

describe("buildDependentTasksMap", () => {
  const createMockTask = (overrides: Partial<Task>): Task => ({
    recordId: "default-record-id",
    id: "default-id",
    source: "default-source",
    sprint: "default-sprint",
    sprintId: "default-sprint-id",
    title: "default-title",
    status: "todo",
    priority: "low",
    executorType: "default-executor",
    assignee: "default-assignee",
    time: "default-time",
    createdAt: "default-created-at",
    promptMarkdown: "default-prompt",
    description: "default-description",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
    ...overrides,
  });

  it("returns empty arrays for tasks with no dependents", () => {
    const tasks = [
      createMockTask({ recordId: "t1", id: "T-1", title: "Task 1" }),
      createMockTask({ recordId: "t2", id: "T-2", title: "Task 2" }),
    ];

    const result = buildDependentTasksMap(tasks);
    expect(result).toEqual({
      t1: [],
      t2: [],
    });
  });

  it("maps a single dependent correctly", () => {
    const tasks = [
      createMockTask({ recordId: "t1", id: "T-1", title: "Task 1", status: "done" }),
      createMockTask({ recordId: "t2", id: "T-2", title: "Task 2", dependsOnTaskIds: ["t1"], status: "todo" }),
    ];

    const result = buildDependentTasksMap(tasks);
    expect(result.t1).toEqual([
      { recordId: "t2", id: "T-2", title: "Task 2", status: "todo" },
    ]);
    expect(result.t2).toEqual([]);
  });

  it("maps multiple dependents correctly", () => {
    const tasks = [
      createMockTask({ recordId: "t1", id: "T-1", title: "Task 1" }),
      createMockTask({ recordId: "t2", id: "T-2", title: "Task 2", dependsOnTaskIds: ["t1"] }),
      createMockTask({ recordId: "t3", id: "T-3", title: "Task 3", dependsOnTaskIds: ["t1"] }),
    ];

    const result = buildDependentTasksMap(tasks);
    expect(result.t1).toEqual([
      { recordId: "t2", id: "T-2", title: "Task 2", status: "todo" },
      { recordId: "t3", id: "T-3", title: "Task 3", status: "todo" },
    ]);
  });

  it("ignores missing dependency IDs gracefully", () => {
    const tasks = [
      createMockTask({ recordId: "t1", id: "T-1", title: "Task 1", dependsOnTaskIds: ["missing-task-id"] }),
    ];

    const result = buildDependentTasksMap(tasks);
    expect(result.t1).toEqual([]); // "missing-task-id" is not a valid task, so it shouldn't cause an error and t1 has no dependents
  });

  it("handles complex relationships", () => {
    const tasks = [
      createMockTask({ recordId: "t1", id: "T-1", title: "Task 1" }),
      createMockTask({ recordId: "t2", id: "T-2", title: "Task 2", dependsOnTaskIds: ["t1"] }),
      createMockTask({ recordId: "t3", id: "T-3", title: "Task 3", dependsOnTaskIds: ["t2"] }),
      createMockTask({ recordId: "t4", id: "T-4", title: "Task 4", dependsOnTaskIds: ["t1", "t2"] }),
    ];

    const result = buildDependentTasksMap(tasks);
    expect(result.t1).toEqual([
      expect.objectContaining({ recordId: "t2" }),
      expect.objectContaining({ recordId: "t4" }),
    ]);
    expect(result.t2).toEqual([
      expect.objectContaining({ recordId: "t3" }),
      expect.objectContaining({ recordId: "t4" }),
    ]);
    expect(result.t3).toEqual([]);
    expect(result.t4).toEqual([]);
  });
});
