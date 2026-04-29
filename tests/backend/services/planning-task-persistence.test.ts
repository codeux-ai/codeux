import { describe, it, expect, vi } from "vitest";
import { persistPlannedTasks } from "../../../src/services/planning-task-persistence.js";
import type { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { PlannedTaskDraft } from "../../../src/contracts/project-management-types.js";

describe("planning-task-persistence", () => {
  it("persists tasks and maps dependencies correctly", () => {
    let idCounter = 1;
    const mockRepo = {
      createTask: vi.fn((projectId, input) => {
        return { id: `task-${idCounter++}`, ...input };
      }),
    } as unknown as ProjectManagementRepository;

    const tasks: PlannedTaskDraft[] = [
      {
        key: "task1",
        title: "Task 1",
        description: "Desc 1",
        promptMarkdown: "Prompt 1",
      },
      {
        key: "task2",
        title: "Task 2",
        description: "Desc 2",
        promptMarkdown: "Prompt 2",
        priority: "high",
        executorType: "docker_cli",
        dependsOn: ["task1"],
      },
      {
        key: "task3",
        title: "Task 3",
        description: "Desc 3",
        promptMarkdown: "Prompt 3",
        dependsOn: ["task1", "task2"],
      },
    ];

    const result = persistPlannedTasks("proj-1", "sprint-1", tasks, mockRepo);

    expect(result.createdTaskIds).toEqual(["task-1", "task-2", "task-3"]);
    expect(result.taskIdsByKey.get("task1")).toBe("task-1");
    expect(result.taskIdsByKey.get("task2")).toBe("task-2");
    expect(result.taskIdsByKey.get("task3")).toBe("task-3");

    expect(mockRepo.createTask).toHaveBeenCalledTimes(3);

    // Verify Task 1
    expect(mockRepo.createTask).toHaveBeenNthCalledWith(1, "proj-1", {
      sprintId: "sprint-1",
      taskKey: "task1",
      title: "Task 1",
      description: "Desc 1",
      promptMarkdown: "Prompt 1",
      priority: "medium", // default
      executorType: "auto", // default
      dependsOnTaskIds: [],
      sortOrder: 0,
      status: "pending",
      isIndependent: true,
    });

    // Verify Task 2
    expect(mockRepo.createTask).toHaveBeenNthCalledWith(2, "proj-1", {
      sprintId: "sprint-1",
      taskKey: "task2",
      title: "Task 2",
      description: "Desc 2",
      promptMarkdown: "Prompt 2",
      priority: "high",
      executorType: "docker_cli",
      dependsOnTaskIds: ["task-1"],
      sortOrder: 1,
      status: "pending",
      isIndependent: false,
    });

    // Verify Task 3
    expect(mockRepo.createTask).toHaveBeenNthCalledWith(3, "proj-1", {
      sprintId: "sprint-1",
      taskKey: "task3",
      title: "Task 3",
      description: "Desc 3",
      promptMarkdown: "Prompt 3",
      priority: "medium",
      executorType: "auto",
      dependsOnTaskIds: ["task-1", "task-2"],
      sortOrder: 2,
      status: "pending",
      isIndependent: false,
    });
  });

  it("throws if a dependency is referenced before it is defined", () => {
    const mockRepo = {
      createTask: vi.fn(),
    } as unknown as ProjectManagementRepository;

    const tasks: PlannedTaskDraft[] = [
      {
        key: "task1",
        title: "Task 1",
        description: "Desc 1",
        promptMarkdown: "Prompt 1",
        dependsOn: ["task2"], // task2 is not defined yet
      },
      {
        key: "task2",
        title: "Task 2",
        description: "Desc 2",
        promptMarkdown: "Prompt 2",
      },
    ];

    expect(() => {
      persistPlannedTasks("proj-1", "sprint-1", tasks, mockRepo);
    }).toThrow('Planning agent returned dependency "task2" before defining it.');

    expect(mockRepo.createTask).not.toHaveBeenCalled();
  });

  it("throws if duplicate keys are provided", () => {
    let idCounter = 1;
    const mockRepo = {
      createTask: vi.fn((projectId, input) => {
        return { id: `task-${idCounter++}`, ...input };
      }),
    } as unknown as ProjectManagementRepository;

    const tasks: PlannedTaskDraft[] = [
      {
        key: "task1",
        title: "Task 1",
        description: "Desc 1",
        promptMarkdown: "Prompt 1",
      },
      {
        key: "task1", // duplicate
        title: "Task 1 (Duplicate)",
        description: "Desc 1 Duplicate",
        promptMarkdown: "Prompt 1 Duplicate",
      },
    ];

    expect(() => {
      persistPlannedTasks("proj-1", "sprint-1", tasks, mockRepo);
    }).toThrow('Planning agent returned duplicate task key: "task1". Task keys must be unique.');

    expect(mockRepo.createTask).toHaveBeenCalledTimes(1); // Only the first one succeeds
  });
});
