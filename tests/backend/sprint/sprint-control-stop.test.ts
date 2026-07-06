import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { ExecutionControlService } from "../../../src/services/execution-control-service.js";
import { SprintRunLifecycleService } from "../../../src/services/sprint-run-lifecycle-service.js";
import { QaReviewRepository } from "../../../src/repositories/qa-review-repository.js";

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

async function createFixture(): Promise<{
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  qaReviewRepository: QaReviewRepository;
  service: ExecutionControlService;
  requestStop: ReturnType<typeof vi.fn>;
  stopProviderContainers: ReturnType<typeof vi.fn>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-sprint-stop-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const qaReviewRepository = new QaReviewRepository(storage);
  const requestStop = vi.fn().mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { accepted: true };
  });
  const stopProviderContainers = vi.fn().mockResolvedValue(["container-1"]);
  const sprintRunLifecycleService = new SprintRunLifecycleService({
    executionRepository,
    projectManagementRepository: projectRepository,
  });

  const service = new ExecutionControlService({
    projectManagementRepository: projectRepository,
    executionRepository,
    sprintRunLifecycleService,
    projectAttentionService: new ProjectAttentionService(
      new ProjectAttentionRepository(storage),
      new ProjectWorkerAssignmentRepository(storage),
    ),
    taskRerunService: { rerunTask: vi.fn() } as any,
    sprintOrchestrator: { execute: vi.fn(), setConsecutiveFailures: vi.fn() } as any,
    julesApi: { sendSessionMessage: vi.fn().mockResolvedValue({ ok: true }) } as any,
    activeDispatchRegistry: { requestStop } as any,
    qaReviewRepository,
    stopProviderContainers,
  });

  return { projectRepository, executionRepository, qaReviewRepository, service, requestStop, stopProviderContainers };
}

afterEach(async () => {
  try {
    for (const storage of storages.splice(0)) {
      storage.close();
    }
  } finally {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
});

describe("sprint stop control", () => {
  it("tears down running task containers immediately and marks dispatches cancelled", async () => {
    const { projectRepository, executionRepository, service, requestStop } = await createFixture();
    const project = projectRepository.createProject({
      name: "Stop Project",
      sourceType: "local",
      sourceRef: "/workspace/stop-project",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Stop Sprint", number: 1 });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Running docker task" });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      state: "RUNNING",
      startedAt: new Date().toISOString(),
    });

    const cancelledRun = await service.cancelSprintRun(sprintRun.id);

    expect(requestStop).toHaveBeenCalledWith(dispatch.id, "Sprint run was cancelled from the dashboard.");
    expect(cancelledRun.status).toBe("cancelled");
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      status: "cancelled",
      connectionId: null,
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      state: "BLOCKED",
      connectionId: null,
    });
    expect(projectRepository.getTask(task.id)).toMatchObject({
      status: "pending",
    });
  });

  it("keeps stop idempotent once the sprint run is already cancelled", async () => {
    const { projectRepository, executionRepository, service, requestStop } = await createFixture();
    const project = projectRepository.createProject({
      name: "Idempotent Stop Project",
      sourceType: "local",
      sourceRef: "/workspace/idempotent-stop-project",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Idempotent Stop Sprint", number: 2 });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });

    const first = await service.cancelSprintRun(sprintRun.id);
    const second = await service.cancelSprintRun(sprintRun.id);

    expect(first.status).toBe("cancelled");
    expect(second.status).toBe("cancelled");
    expect(requestStop).not.toHaveBeenCalled();
  });

  it("cancels running QA provider invocations that are not attached to task dispatches", async () => {
    const { projectRepository, executionRepository, qaReviewRepository, service, stopProviderContainers } = await createFixture();
    const project = projectRepository.createProject({
      name: "QA Stop Project",
      sourceType: "local",
      sourceRef: "/workspace/qa-stop-project",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "QA Stop Sprint", number: 3 });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "QA reviewed task" });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      state: "COMPLETED",
      startedAt: "2026-07-06T10:00:00.000Z",
      finishedAt: "2026-07-06T10:05:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      sessionId: "qa-review-session-1",
      provider: "opencode",
      purpose: "qa_review",
      status: "running",
      startedAt: "2026-07-06T10:06:00.000Z",
    });
    const executionInvocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      providerInvocationId: providerInvocation.id,
      type: "qa_review",
      status: "running",
      startedAt: "2026-07-06T10:06:00.000Z",
    });
    const qaRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      triggerType: "task_completion",
      runIndex: 1,
      startedAt: "2026-07-06T10:06:00.000Z",
    });

    const cancelledRun = await service.cancelSprintRun(sprintRun.id);

    expect(cancelledRun.status).toBe("cancelled");
    expect(stopProviderContainers).toHaveBeenCalledWith(["qa-review-session-1"]);
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
      errorMessage: "Sprint run was cancelled from the dashboard.",
    });
    expect(executionRepository.listExecutionInvocationMessages(executionInvocation.id).at(-1)).toMatchObject({
      role: "system",
      contentMarkdown: expect.stringContaining("Sprint run was cancelled from the dashboard."),
    });
    expect(qaReviewRepository.getRun(qaRun.id)).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
      summaryMarkdown: "Sprint run was cancelled from the dashboard.",
    });
  });
});
