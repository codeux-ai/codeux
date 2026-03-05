import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { SprintExporter } from "../../../../src/domain/sprint/migration/sprint-exporter.js";
import { SprintRepository } from "../../../../src/domain/sprints/sprint-repository.js";
import { TaskRepository } from "../../../../src/repositories/sprint-db/task-repository.js";
import { SprintDatabase } from "../../../../src/repositories/sprint-db/bootstrap.js";
import { SubtaskParser } from "../../../../src/infrastructure/repositories/subtask-parser.js";

vi.mock("fs/promises");
vi.mock("../../../../src/infrastructure/repositories/subtask-parser.js");

describe("SprintExporter", () => {
  let exporter: SprintExporter;
  let mockSprintRepo: vi.Mocked<SprintRepository>;
  let mockTaskRepo: vi.Mocked<TaskRepository>;
  let mockDb: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockSprintRepo = {
      getById: vi.fn(),
    } as any;
    mockTaskRepo = {
      listTasks: vi.fn(),
    } as any;
    mockDb = {
      db: {
        prepare: vi.fn(),
      },
    };
    exporter = new SprintExporter(mockSprintRepo, mockTaskRepo, mockDb as unknown as SprintDatabase);
  });

  it("should export sprint tasks to markdown files", async () => {
    const sprintId = "sprint-1";
    const outputDir = "/output";

    mockSprintRepo.getById.mockResolvedValue({ id: sprintId } as any);
    mockTaskRepo.listTasks.mockReturnValue([
      { id: "sprint-1-task1", title: "Task 1", description: "Desc 1", is_merged: 1, status: "PENDING" },
      { id: "task2", title: "Task 2", description: "Desc 2", is_merged: 0, status: "COMPLETED" },
    ] as any);

    const mockStmt = {
      all: vi.fn().mockReturnValueOnce([{ depends_on_task_id: "sprint-1-task2" }]).mockReturnValueOnce([]),
    };
    mockDb.db.prepare.mockReturnValue(mockStmt);

    (SubtaskParser.stringify as vi.Mock).mockReturnValue("mock markdown");

    await exporter.exportSprint(sprintId, outputDir);

    expect(fs.mkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(outputDir, "task1.md"), "mock markdown", "utf-8");
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(outputDir, "task2.md"), "mock markdown", "utf-8");

    expect(SubtaskParser.stringify).toHaveBeenCalledWith({
      id: "task1",
      title: "Task 1",
      prompt: "Desc 1",
      depends_on: ["task2"],
      is_independent: false,
      is_merged: true,
      status: "PENDING",
    });

    expect(SubtaskParser.stringify).toHaveBeenCalledWith({
      id: "task2",
      title: "Task 2",
      prompt: "Desc 2",
      depends_on: [],
      is_independent: true,
      is_merged: false,
      status: "COMPLETED",
    });
  });

  it("should throw error if sprint not found", async () => {
    mockSprintRepo.getById.mockResolvedValue(null);
    await expect(exporter.exportSprint("invalid", "/output")).rejects.toThrow("Sprint invalid not found");
  });

  it("should return early if no tasks found", async () => {
    mockSprintRepo.getById.mockResolvedValue({ id: "sprint-1" } as any);
    mockTaskRepo.listTasks.mockReturnValue([]);

    await exporter.exportSprint("sprint-1", "/output");

    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
