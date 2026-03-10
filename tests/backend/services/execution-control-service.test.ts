import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ExecutionControlService } from "../../../src/services/execution-control-service.js";

const tempDirs: string[] = [];

async function createFixture(): Promise<{
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  service: ExecutionControlService;
  rerunTask: ReturnType<typeof vi.fn>;
  executeOrchestrator: ReturnType<typeof vi.fn>;
  requestStop: ReturnType<typeof vi.fn>;
  sendSessionMessage: ReturnType<typeof vi.fn>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-execution-control-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const rerunTask = vi.fn().mockResolvedValue({ id: "task-1" });
  const executeOrchestrator = vi.fn().mockResolvedValue({ content: [] });
  const requestStop = vi.fn().mockResolvedValue({ accepted: true });
  const sendSessionMessage = vi.fn().mockResolvedValue({ ok: true });

  const service = new ExecutionControlService({
    projectManagementRepository: projectRepository,
    executionRepository,
    taskRerunService: {
      rerunTask,
    } as any,
    sprintOrchestrator: {
      execute: executeOrchestrator,
    } as any,
    julesApi: {
      sendSessionMessage,
    } as any,
    activeDispatchRegistry: {
      requestStop,
    } as any,
  });

  return {
    projectRepository,
    executionRepository,
    service,
    rerunTask,
    executeOrchestrator,
    requestStop,
    sendSessionMessage,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ExecutionControlService", () => {
  it("starts sprint orchestration through the sprint orchestrator", async () => {
    const { projectRepository, service, executeOrchestrator } = await createFixture();
    const project = projectRepository.createProject({
      name: "Execution Control Project",
      sourceType: "local",
      sourceRef: "/workspace/control-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Execution Control Sprint",
      number: 1,
    });

    await service.orchestrateSprint(project.id, sprint.id);

    expect(executeOrchestrator).toHaveBeenCalledWith(expect.objectContaining({
      action: "orchestrate",
      project_id: project.id,
      sprint_id: sprint.id,
      wait: true,
    }));
  });

  it("rejects orchestration while a sprint cancellation is still pending for active work", async () => {
    const { projectRepository, executionRepository, service, executeOrchestrator } = await createFixture();
    const project = projectRepository.createProject({
      name: "Pending Cancel Project",
      sourceType: "local",
      sourceRef: "/workspace/pending-cancel-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Pending Cancel Sprint",
      number: 1,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "cancel_requested",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Active cancel task",
    });
    executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "cancel_requested",
    });

    await expect(service.orchestrateSprint(project.id, sprint.id)).rejects.toThrow("cancellation is still pending");
    expect(executeOrchestrator).not.toHaveBeenCalled();
  });

  it("pauses sprint runs and records a sprint event", async () => {
    const { projectRepository, executionRepository, service } = await createFixture();
    const project = projectRepository.createProject({
      name: "Pause Project",
      sourceType: "local",
      sourceRef: "/workspace/pause-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Pause Sprint",
      number: 1,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });

    const paused = service.pauseSprintRun(sprintRun.id);

    expect(paused.status).toBe("paused");
    expect(executionRepository.listSprintRunEvents(sprintRun.id)[0]).toMatchObject({
      eventType: "sprint_pause_requested",
      originator: "user",
    });
  });

  it("cancels queued dispatches within a cancelled sprint run", async () => {
    const { projectRepository, executionRepository, service } = await createFixture();
    const project = projectRepository.createProject({
      name: "Cancel Project",
      sourceType: "local",
      sourceRef: "/workspace/cancel-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Cancel Sprint",
      number: 2,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Cancel queued dispatch",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      status: "queued",
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

    const cancelled = service.cancelSprintRun(sprintRun.id);

    expect(cancelled.status).toBe("cancelled");
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      status: "cancelled",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      state: "BLOCKED",
    });
  });

  it("retries terminal dispatches through the task rerun service", async () => {
    const { projectRepository, executionRepository, service, rerunTask } = await createFixture();
    const project = projectRepository.createProject({
      name: "Retry Project",
      sourceType: "local",
      sourceRef: "/workspace/retry-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Retry Sprint",
      number: 3,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Retry failed dispatch",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "failed",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "failed",
    });

    await service.retryTaskDispatch(dispatch.id);

    expect(rerunTask).toHaveBeenCalledWith(task.id);
  });

  it("marks running docker dispatches as cancel requested and asks the active executor to stop", async () => {
    const { projectRepository, executionRepository, service, requestStop } = await createFixture();
    const project = projectRepository.createProject({
      name: "Running Cancel Project",
      sourceType: "local",
      sourceRef: "/workspace/running-cancel-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Running Cancel Sprint",
      number: 4,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Cancel running docker dispatch",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
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
      mode: "docker_cli",
      state: "RUNNING",
      startedAt: new Date().toISOString(),
    });

    const updated = await service.cancelTaskDispatch(dispatch.id);

    expect(updated.status).toBe("cancel_requested");
    expect(requestStop).toHaveBeenCalledWith(dispatch.id, "Dispatch was cancelled from the dashboard.");
    expect(executionRepository.listTaskRunEvents(taskRun.id)[0]).toMatchObject({
      eventType: "dispatch_cancel_requested",
    });
  });

  it("finalizes running jules dispatches immediately after sending the close message", async () => {
    const { projectRepository, executionRepository, service, requestStop, sendSessionMessage } = await createFixture();
    const project = projectRepository.createProject({
      name: "Jules Cancel Project",
      sourceType: "local",
      sourceRef: "/workspace/jules-cancel-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Jules Cancel Sprint",
      number: 5,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Cancel running jules dispatch",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "jules",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "jules",
      state: "RUNNING",
      sessionId: "session-123",
      startedAt: new Date().toISOString(),
    });

    const updated = await service.cancelTaskDispatch(dispatch.id);

    expect(updated.status).toBe("cancelled");
    expect(sendSessionMessage).toHaveBeenCalledWith(
      "session-123",
      "Task cancelled, please close this task now. Do not continue implementation.",
    );
    expect(requestStop).not.toHaveBeenCalled();
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      state: "BLOCKED",
    });
    expect(projectRepository.getTask(task.id)).toMatchObject({
      status: "pending",
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "jules_stop_requested",
        }),
        expect.objectContaining({
          eventType: "dispatch_cancelled",
          payload: expect.objectContaining({
            force: false,
          }),
        }),
      ]),
    );
  });
});
