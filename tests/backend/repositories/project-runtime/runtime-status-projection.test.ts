import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { RuntimeStatusProjection } from "../../../../src/repositories/project-runtime/runtime-status-projection.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";

const tempDirs: string[] = [];

async function createProjection(): Promise<{
  storage: AppDbStorage;
  projection: RuntimeStatusProjection;
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-status-projection-test-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    storage,
    projection: new RuntimeStatusProjection(storage, storage.getDatabase()),
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RuntimeStatusProjection", () => {
  it("falls back to planned-task status when no run exists", async () => {
    const { projection, projectRepository } = await createProjection();
    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });

    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "pending",
    });

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.status).toBe("PENDING");
  });

  it("selects the latest run when mapping tasks", async () => {
    const { storage, projection, projectRepository } = await createProjection();
    const db = storage.getDatabase();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "pending",
    });

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-1", project.id, sprint.id, task.id, "FAILED", "2024-01-01T10:00:00Z");

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-2", project.id, sprint.id, task.id, "RUNNING", "2024-01-01T11:00:00Z");

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.status).toBe("RUNNING");
  });

  it("projects recent activity correctly", async () => {
    const { storage, projection, projectRepository } = await createProjection();
    const db = storage.getDatabase();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "pending",
    });

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-1", project.id, sprint.id, task.id, "RUNNING", "2024-01-01T10:00:00Z");

    db.prepare(`
      INSERT INTO task_run_events (id, task_run_id, event_type, originator, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "event-1",
      "run-1",
      "provider_activity",
      "agent",
      JSON.stringify({
        activityId: "act-1",
        activityName: "Activity 1",
        agentMessaged: { agentMessage: "Hello" }
      }),
      "2024-01-01T10:05:00Z"
    );

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.activities).toHaveLength(1);
    expect(status.subtasks[0]?.activities?.[0]).toMatchObject({
      id: "act-1",
      originator: "agent",
      agentMessaged: { agentMessage: "Hello" }
    });
  });
});
