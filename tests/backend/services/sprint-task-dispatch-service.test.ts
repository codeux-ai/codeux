import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SprintTaskDispatchService } from "../../../src/services/sprint-task-dispatch-service.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-dispatch-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectManagementRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const taskService = {
    selectProviderForTask: vi.fn().mockReturnValue("codex"),
    selectCliProviderForTask: vi.fn().mockReturnValue("codex"),
    resolveTaskProvider: vi.fn().mockReturnValue("codex"),
    startSprintTask: vi.fn(),
  };
  const service = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService as any,
  );

  return {
    projectManagementRepository,
    executionRepository,
    taskService,
    service,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SprintTaskDispatchService", () => {
  it("queues mcp worker tasks without starting the provider workflow locally", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/dispatch-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Dispatch Sprint",
      number: 8,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Queue to worker",
      promptMarkdown: "Send this task to a connected worker.",
      executorType: "mcp_worker",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    const result = await service.startTask({
      task: {
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
        title: taskRecord.title,
        prompt: taskRecord.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feature/sprint-8",
      repoPath: "/workspace/dispatch-project",
      sprintNumber: 8,
    });

    expect(result).toMatchObject({
      id: expect.any(String),
      runtimeLabel: "MCP WORKER",
    });
    expect(taskService.startSprintTask).not.toHaveBeenCalled();

    const dispatches = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    expect(dispatches[0]).toMatchObject({
      taskId: taskRecord.id,
      executorType: "mcp_worker",
      status: "queued",
    });
  });
});
