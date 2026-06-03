import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-dispatches-query-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("queryExecutionTaskDispatches latest-per-task", () => {
  it("surfaces a task's newest dispatch even when an older failed dispatch exists (rerun scenario)", async () => {
    const { executionRepository, projectRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Rerun Project",
      sourceType: "local",
      sourceRef: "/workspace/rerun-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Rerun Sprint",
      number: 1,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Reran task",
      promptMarkdown: "Do work",
    });

    // The original (now-completed) sprint run that produced a FAILED dispatch.
    const failedRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "dashboard",
      triggeredBy: "user:test",
      executorMode: "mixed",
      status: "completed",
    });
    const failedDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: failedRun.id,
      executorType: "docker_cli",
      queuedAt: "2026-01-01T10:00:00.000Z",
    });
    executionRepository.updateTaskDispatch(failedDispatch.id, {
      status: "failed",
      startedAt: "2026-01-01T10:00:00.000Z",
      finishedAt: "2026-01-01T10:05:00.000Z",
      lastHeartbeatAt: "2026-01-01T10:05:00.000Z",
      errorMessage: "Provider session FAILED",
    });

    // The rerun's fresh sprint run + dispatch that completed successfully (newer).
    const rerunRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "dashboard",
      triggeredBy: "task_rerun",
      executorMode: "mixed",
      status: "completed",
    });
    const rerunDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: rerunRun.id,
      executorType: "docker_cli",
      queuedAt: "2026-01-02T09:00:00.000Z",
    });
    executionRepository.updateTaskDispatch(rerunDispatch.id, {
      status: "completed",
      startedAt: "2026-01-02T09:00:00.000Z",
      finishedAt: "2026-01-02T09:06:00.000Z",
      lastHeartbeatAt: "2026-01-02T09:06:00.000Z",
    });

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);
    const taskDispatches = snapshot.taskDispatches.filter((d) => d.taskId === task.id);

    // The snapshot must represent the task by its newest dispatch, not the stale failed one.
    expect(taskDispatches).toHaveLength(1);
    expect(taskDispatches[0]?.id).toBe(rerunDispatch.id);
    expect(taskDispatches[0]?.status).toBe("completed");
    expect(taskDispatches[0]?.errorMessage ?? null).toBeNull();
  });
});
