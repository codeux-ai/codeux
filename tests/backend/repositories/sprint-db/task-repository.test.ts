import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SprintDatabase } from "../../../../src/repositories/sprint-db/bootstrap.js";
import { TaskRepository, CreateTaskInput, UpdateTaskInput } from "../../../../src/repositories/sprint-db/task-repository.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("TaskRepository", () => {
  let db: SprintDatabase;
  let taskRepo: TaskRepository;
  const testDbPath = path.resolve(__dirname, "test-task-repo.db");

  beforeEach(async () => {
    // Ensure clean state
    await fs.rm(testDbPath, { force: true });
    await fs.rm(`${testDbPath}-wal`, { force: true });
    await fs.rm(`${testDbPath}-shm`, { force: true });

    db = new SprintDatabase(testDbPath);
    taskRepo = new TaskRepository(db);

    // Setup initial project and sprint needed for foreign key constraints
    db.db.exec(`
      INSERT INTO pm_projects (id, name, status, created_at, updated_at)
      VALUES ('proj-1', 'Test Project', 'ACTIVE', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');

      INSERT INTO pm_sprints (id, project_id, name, status, created_at, updated_at)
      VALUES ('sprint-1', 'proj-1', 'Sprint 1', 'ACTIVE', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    `);
  });

  afterEach(async () => {
    db.db.close();
    await fs.rm(testDbPath, { force: true });
    await fs.rm(`${testDbPath}-wal`, { force: true });
    await fs.rm(`${testDbPath}-shm`, { force: true });
  });

  it("should create and get a task", () => {
    const input: CreateTaskInput = {
      id: "task-1",
      sprintId: "sprint-1",
      title: "My First Task",
      description: "Description here",
      status: "PENDING",
      type: "FEATURE",
      sortIndex: 0
    };

    taskRepo.createTask(input);
    const task = taskRepo.getTask("task-1");

    expect(task).not.toBeNull();
    expect(task?.id).toBe("task-1");
    expect(task?.sprint_id).toBe("sprint-1");
    expect(task?.title).toBe("My First Task");
    expect(task?.description).toBe("Description here");
    expect(task?.status).toBe("PENDING");
    expect(task?.type).toBe("FEATURE");
    expect(task?.sort_index).toBe(0);
  });

  it("should list tasks ordered by sort_index", () => {
    taskRepo.createTask({
      id: "task-1", sprintId: "sprint-1", title: "Task 1", status: "PENDING", type: "FEATURE", sortIndex: 2
    });
    taskRepo.createTask({
      id: "task-2", sprintId: "sprint-1", title: "Task 2", status: "PENDING", type: "FEATURE", sortIndex: 1
    });

    const tasks = taskRepo.listTasks("sprint-1");

    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe("task-2");
    expect(tasks[1].id).toBe("task-1");
  });

  it("should update a task", () => {
    taskRepo.createTask({
      id: "task-1", sprintId: "sprint-1", title: "Task 1", status: "PENDING", type: "FEATURE", sortIndex: 0
    });

    taskRepo.updateTask("task-1", {
      title: "Updated Task 1",
      status: "IN_PROGRESS",
      description: "New description"
    });

    const task = taskRepo.getTask("task-1");
    expect(task?.title).toBe("Updated Task 1");
    expect(task?.status).toBe("IN_PROGRESS");
    expect(task?.description).toBe("New description");
  });

  it("should reorder tasks", () => {
    taskRepo.createTask({ id: "t1", sprintId: "sprint-1", title: "T1", status: "PENDING", type: "FEATURE", sortIndex: 0 });
    taskRepo.createTask({ id: "t2", sprintId: "sprint-1", title: "T2", status: "PENDING", type: "FEATURE", sortIndex: 1 });
    taskRepo.createTask({ id: "t3", sprintId: "sprint-1", title: "T3", status: "PENDING", type: "FEATURE", sortIndex: 2 });

    // Reverse order
    taskRepo.reorderTasks("sprint-1", ["t3", "t2", "t1"]);

    const tasks = taskRepo.listTasks("sprint-1");
    expect(tasks.length).toBe(3);
    expect(tasks[0].id).toBe("t3");
    expect(tasks[0].sort_index).toBe(0);
    expect(tasks[1].id).toBe("t2");
    expect(tasks[1].sort_index).toBe(1);
    expect(tasks[2].id).toBe("t1");
    expect(tasks[2].sort_index).toBe(2);
  });

  it("should delete a task", () => {
    taskRepo.createTask({ id: "t1", sprintId: "sprint-1", title: "T1", status: "PENDING", type: "FEATURE" });
    let task = taskRepo.getTask("t1");
    expect(task).not.toBeNull();

    taskRepo.deleteTask("t1");
    task = taskRepo.getTask("t1");
    expect(task).toBeNull();
  });
});
