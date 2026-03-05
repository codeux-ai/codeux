import { describe, it, expect, vi } from "vitest";
import { SprintImporter } from "../../../../../src/domain/sprint/migration/sprint-importer.js";
import { SubtaskFileRepository } from "../../../../../src/infrastructure/repositories/subtask-file-repository.js";
import { ProjectService } from "../../../../../src/domain/project/project-service.js";
import { SprintRepository } from "../../../../../src/domain/sprints/sprint-repository.js";
import { TaskRepository } from "../../../../../src/repositories/sprint-db/task-repository.js";
import * as fsPromises from "fs/promises";
import { TaskStatus } from "../../../../../src/contracts/app-types.js";

vi.mock("fs/promises", () => ({
  readdir: vi.fn()
}));

describe("SprintImporter", () => {
  it("imports sprints and preserves isMerged flag", async () => {
    const subtaskRepo = {
      loadSubtasks: vi.fn().mockResolvedValue([
        { id: "t01", title: "Task 1", prompt: "Do 1", depends_on: [], is_merged: true, status: TaskStatus.COMPLETED },
        { id: "t02", title: "Task 2", prompt: "Do 2", depends_on: ["t01"], is_merged: false, status: TaskStatus.PENDING },
      ])
    } as unknown as SubtaskFileRepository;

    const projectService = {
      getProjectBySourceAndDir: vi.fn().mockReturnValue({ id: "proj-1" }),
      createProject: vi.fn()
    } as unknown as ProjectService;

    const sprintRepo = {
      create: vi.fn().mockResolvedValue({ id: "sprint-1" })
    } as unknown as SprintRepository;

    const taskRepo = {
      createTask: vi.fn()
    } as unknown as TaskRepository;

    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { isDirectory: () => true, name: "sprint1-subtasks" } as any
    ]);

    const importer = new SprintImporter(subtaskRepo, projectService, sprintRepo, taskRepo);
    await importer.importSprints("src-1", "/dir", "/mock/sprints");

    expect(sprintRepo.create).toHaveBeenCalledWith({
      projectId: "proj-1",
      name: "Sprint 1",
      goal: null,
      startDate: null,
      endDate: null,
    });

    expect(taskRepo.createTask).toHaveBeenCalledWith({
      id: "sprint-1-t01",
      sprintId: "sprint-1",
      title: "Task 1",
      description: "Do 1",
      status: TaskStatus.COMPLETED,
      type: "SUBTASK",
      sortIndex: 0,
      dependencies: [],
      isMerged: true,
    });

    expect(taskRepo.createTask).toHaveBeenCalledWith({
      id: "sprint-1-t02",
      sprintId: "sprint-1",
      title: "Task 2",
      description: "Do 2",
      status: TaskStatus.PENDING,
      type: "SUBTASK",
      sortIndex: 1,
      dependencies: ["sprint-1-t01"],
      isMerged: false,
    });
  });
});
