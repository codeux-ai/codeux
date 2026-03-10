import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { WorkerTaskDispatchService } from "../../../src/services/worker-task-dispatch-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-worker-dispatch-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const connectionRepository = new ConnectionChatRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const workerService = new WorkerTaskDispatchService(
    executionRepository,
    projectRepository,
    connectionRepository,
    () => DEFAULT_DASHBOARD_SETTINGS,
  );

  return {
    projectRepository,
    connectionRepository,
    executionRepository,
    workerService,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorkerTaskDispatchService", () => {
  it("claims queued worker dispatches and completes them through the shared runtime model", async () => {
    const { projectRepository, connectionRepository, executionRepository, workerService } = await createFixture();
    const project = projectRepository.createProject({
      name: "Worker Flow Project",
      sourceType: "local",
      sourceRef: "/workspace/worker-flow",
      defaultBranch: "main",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Worker Flow Sprint",
      number: 5,
      featureBranch: "feature/sprint-5",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Execute via worker",
      promptMarkdown: "Use the connected worker path.",
      executorType: "mcp_worker",
      priority: "critical",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-09T10:00:00.000Z",
    });

    connectionRepository.upsertConnection({
      connectionKey: "worker-claim-1",
      displayName: "Worker Claim 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const claim = workerService.pullNextDispatch({
      connectionKey: "worker-claim-1",
      projectId: project.id,
    });

    expect(claim).not.toBeNull();
    expect(claim?.dispatch).toMatchObject({
      id: dispatch.id,
      status: "running",
    });
    expect(claim?.task).toMatchObject({
      id: task.id,
      executorType: "mcp_worker",
      title: "Execute via worker",
    });
    expect(claim?.executionContext).toMatchObject({
      repoPath: "/workspace/worker-flow",
      featureBranch: "feature/sprint-5",
      defaultBranch: "main",
    });

    const completed = workerService.updateDispatch({
      connectionKey: "worker-claim-1",
      dispatchId: dispatch.id,
      leaseToken: claim?.leaseToken || "",
      state: "COMPLETED",
      sessionId: "worker-session-1",
      sessionName: "workers/worker-session-1",
      provider: "codex",
      workerBranch: "worker/feature-sprint-5",
      prUrl: "https://example.com/pr/123",
      summaryMarkdown: "Worker completed the implementation.",
    });

    expect(completed).toMatchObject({
      controlAction: null,
      dispatch: {
        id: dispatch.id,
        status: "completed",
      },
    });

    const updatedTask = projectRepository.getTask(task.id);
    expect(updatedTask?.status).toBe("completed");

    const updatedRun = executionRepository.getTaskRunByDispatchId(dispatch.id);
    expect(updatedRun).toMatchObject({
      connectionId: claim?.dispatch.connectionId,
      state: "COMPLETED",
      prUrl: "https://example.com/pr/123",
      sessionId: "worker-session-1",
    });

    expect(executionRepository.getLease("task_dispatch", dispatch.id)).toBeNull();
  });
});
