import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SprintTaskDispatchService, ProviderCapReachedError } from "../../../src/services/sprint-task-dispatch-service.js";
import { ProviderConcurrencyService } from "../../../src/services/provider-concurrency-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { JulesApiRequestError } from "../../../src/integrations/jules-api-client.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-dispatch-service-"));
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
  const guardrailService = {
    evaluate: vi.fn().mockReturnValue({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" }),
    evaluateQa: vi.fn().mockReturnValue({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" }),
    record: vi.fn(),
    getCounts: vi.fn(),
    reset: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => logger) };
  const providerConcurrencyService = new ProviderConcurrencyService({
    executionRepository,
    logger: logger as any,
  });
  const service = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService as any,
    guardrailService as any,
    providerConcurrencyService,
    () => DEFAULT_DASHBOARD_SETTINGS,
    logger as any,
  );

  return {
    guardrailService,
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
  it("starts docker-cli tasks through the shared runtime model", async () => {
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
      title: "Run in container",
      promptMarkdown: "Run this task in the isolated container workflow.",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    taskService.startSprintTask.mockResolvedValue({
      id: "session-1",
      name: "Container task",
      provider: "codex",
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
      id: "session-1",
      name: "Container task",
      provider: "codex",
    });
    expect(taskService.startSprintTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
      }),
      undefined,
      "feature/sprint-8",
      "/workspace/dispatch-project",
      8,
      expect.objectContaining({ projectId: project.id }),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ taskRecordId: taskRecord.id }),
    );

    const dispatches = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    expect(dispatches[0]).toMatchObject({
      taskId: taskRecord.id,
      executorType: "docker_cli",
      status: "running",
    });
  });

  it("re-queues docker-cli dispatches when the provider cap is reached during startup", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Dispatch Deferral Project",
      sourceType: "local",
      sourceRef: "/workspace/dispatch-deferral-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Dispatch Deferral Sprint",
      number: 9,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wait for provider slot",
      promptMarkdown: "The provider reaches its cap after task-run creation.",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    taskService.startSprintTask.mockRejectedValue(new ProviderCapReachedError("codex", 2, 2));

    await expect(service.startTask({
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
      featureBranch: "feature/sprint-9",
      repoPath: "/workspace/dispatch-deferral-project",
      sprintNumber: 9,
    })).rejects.toBeInstanceOf(ProviderCapReachedError);

    const [dispatch] = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    const taskRun = executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id);
    const task = projectManagementRepository.getTask(taskRecord.id);

    expect(dispatch).toMatchObject({
      taskId: taskRecord.id,
      status: "queued",
      errorMessage: null,
    });
    expect(taskRun).toMatchObject({
      state: "PENDING",
      provider: "codex",
      finishedAt: null,
      durationMs: null,
    });
    expect(task).toMatchObject({ status: "pending" });
  });

  it("resumes a queued provider-cap deferral when capacity is available", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Dispatch Resume Project",
      sourceType: "local",
      sourceRef: "/workspace/dispatch-resume-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Dispatch Resume Sprint",
      number: 10,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Resume queued task",
      promptMarkdown: "The provider cap clears on the next scheduling cycle.",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });
    const startArgs = {
      task: {
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
        title: taskRecord.title,
        prompt: taskRecord.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING" as const,
      },
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feature/sprint-10",
      repoPath: "/workspace/dispatch-resume-project",
      sprintNumber: 10,
    };
    const customSettings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      aiProvider: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
        providers: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
          codex: {
            provider: "codex" as any,
            maxConcurrentTasks: 2,
          },
        },
      },
    };
    const customService = new SprintTaskDispatchService(
      executionRepository,
      projectManagementRepository,
      taskService as any,
      (service as any).guardrailService,
      (service as any).providerConcurrencyService,
      () => customSettings,
      (service as any).logger,
    );
    vi.spyOn((service as any).providerConcurrencyService, "getGlobalRunningCounts")
      .mockReturnValueOnce({ codex: 2 })
      .mockReturnValue({ codex: 0 });

    await expect(customService.startTask(startArgs)).rejects.toBeInstanceOf(ProviderCapReachedError);
    taskService.startSprintTask.mockResolvedValue({
      id: "resumed-session",
      name: "Resumed session",
      provider: "codex",
    });

    const result = await customService.startTask(startArgs);

    expect(result).toMatchObject({
      id: "resumed-session",
      name: "Resumed session",
      provider: "codex",
    });
    expect(taskService.startSprintTask).toHaveBeenCalledTimes(1);
    const dispatches = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
      taskId: taskRecord.id,
    });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      status: "running",
      errorMessage: null,
    });
    const latestRun = executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id);
    expect(latestRun).toMatchObject({
      state: "RUNNING",
      sessionId: "resumed-session",
    });
  });

  it("does not revive a dispatch cancelled while session startup is in flight", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Cancelled Startup Project",
      sourceType: "local",
      sourceRef: "/workspace/cancelled-startup-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Cancelled Startup Sprint",
      number: 18,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Cancel during startup",
      promptMarkdown: "The sprint is cancelled while the provider starts.",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    taskService.startSprintTask.mockImplementation(async (
      _task: unknown,
      _sourceId: unknown,
      _featureBranch: unknown,
      _repoPath: unknown,
      _sprintNumber: unknown,
      _settingsScope: unknown,
      dispatchId: string,
      taskRunId: string,
    ) => {
      const cancelledAt = new Date().toISOString();
      executionRepository.updateSprintRun(sprintRun.id, {
        status: "cancelled",
        finishedAt: cancelledAt,
        lastHeartbeatAt: cancelledAt,
      });
      executionRepository.updateTaskDispatch(dispatchId, {
        status: "cancelled",
        finishedAt: cancelledAt,
        lastHeartbeatAt: cancelledAt,
      });
      executionRepository.updateTaskRun(taskRunId, {
        state: "BLOCKED",
        finishedAt: cancelledAt,
      });
      projectManagementRepository.updateTask(taskRecord.id, {
        status: "pending",
      });
      return {
        id: "late-session",
        name: "Late session",
        provider: "codex",
      };
    });

    await service.startTask({
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
      featureBranch: "feature/sprint-18",
      repoPath: "/workspace/cancelled-startup-project",
      sprintNumber: 18,
    });

    const [dispatch] = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    const taskRun = executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id);

    expect(dispatch).toMatchObject({ status: "cancelled" });
    expect(taskRun).toMatchObject({ state: "BLOCKED" });
    expect(projectManagementRepository.getTask(taskRecord.id)).toMatchObject({ status: "pending" });
  });

  it("creates a running Jules execution invocation as soon as the task is dispatched", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Jules Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/jules-dispatch-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Jules Dispatch Sprint",
      number: 9,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Run in Jules",
      promptMarkdown: "Run this task in Jules.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    taskService.resolveTaskProvider.mockReturnValue("jules");
    taskService.startSprintTask.mockResolvedValue({
      id: "jules-session-1",
      name: "sessions/jules-session-1",
      provider: "jules",
    });

    await service.startTask({
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
      featureBranch: "feature/sprint-9",
      repoPath: "/workspace/jules-dispatch-project",
      sprintNumber: 9,
    });

    const invocations = executionRepository.listExecutionInvocations({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    const julesInvocation = invocations.find((invocation) => invocation.taskId === taskRecord.id);

    expect(julesInvocation).toMatchObject({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: taskRecord.id,
      sprintRunId: sprintRun.id,
      type: "task_coding",
      status: "running",
      provider: "jules",
      model: "jules-agent",
      invocationSource: "EXTERNAL_API",
    });
    expect(julesInvocation?.dispatchId).toBeTruthy();
    expect(julesInvocation?.taskRunId).toBeTruthy();
    expect(julesInvocation?.providerInvocationId).toBeTruthy();

    const providerUsage = executionRepository.getProviderInvocationUsage(julesInvocation!.providerInvocationId!);
    expect(providerUsage).toMatchObject({
      sessionId: "jules-session-1",
      nativeSessionId: "jules-session-1",
      provider: "jules",
      purpose: "task_coding",
      status: "running",
      sprintRunId: sprintRun.id,
      dispatchId: julesInvocation?.dispatchId,
      taskRunId: julesInvocation?.taskRunId,
    });

    const messages = executionRepository.listExecutionInvocationMessages(julesInvocation!.id);
    expect(messages[0]).toMatchObject({
      role: "system",
      contentMarkdown: "Jules task dispatched. Waiting for remote session transcript.",
    });
  });

  it("reuses an active dispatch instead of creating duplicate task-run or provider invocation rows", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Duplicate Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/duplicate-dispatch-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Duplicate Dispatch Sprint",
      number: 19,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Run once in Jules",
      promptMarkdown: "This task must only start once.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    taskService.resolveTaskProvider.mockReturnValue("jules");
    taskService.startSprintTask.mockResolvedValue({
      id: "jules-session-once",
      name: "sessions/jules-session-once",
      provider: "jules",
    });

    const startArgs = {
      task: {
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
        title: taskRecord.title,
        prompt: taskRecord.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING" as const,
      },
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feature/sprint-19",
      repoPath: "/workspace/duplicate-dispatch-project",
      sprintNumber: 19,
    };

    await service.startTask(startArgs);
    taskService.startSprintTask.mockClear();

    const reused = await service.startTask(startArgs);

    expect(reused).toMatchObject({
      id: "jules-session-once",
      name: "sessions/jules-session-once",
      provider: "jules",
    });
    expect(taskService.startSprintTask).not.toHaveBeenCalled();
    expect(executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
      taskId: taskRecord.id,
    })).toHaveLength(1);
    expect(executionRepository.listExecutionInvocations({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    }).filter((invocation) => invocation.taskId === taskRecord.id)).toHaveLength(1);
    expect(executionRepository.listProviderInvocationsForTask(project.id, taskRecord.id)).toHaveLength(1);

    const latestRun = executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id);
    expect(latestRun).toMatchObject({
      state: "RUNNING",
      sessionId: "jules-session-once",
    });
    expect(executionRepository.listTaskRunEvents(latestRun!.id).filter((event) => event.eventType === "dispatch_started")).toHaveLength(1);
  });

  it("marks the dispatch-created Jules invocation failed when session creation fails", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Jules Failure Project",
      sourceType: "local",
      sourceRef: "/workspace/jules-failure-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Jules Failure Sprint",
      number: 10,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Fail in Jules",
      promptMarkdown: "This Jules dispatch fails.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    taskService.resolveTaskProvider.mockReturnValue("jules");
    taskService.startSprintTask.mockRejectedValue(new Error("Jules API unavailable"));

    await expect(service.startTask({
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
      featureBranch: "feature/sprint-10",
      repoPath: "/workspace/jules-failure-project",
      sprintNumber: 10,
    })).rejects.toThrow("Jules API unavailable");

    const [julesInvocation] = executionRepository.listExecutionInvocations({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    expect(julesInvocation).toMatchObject({
      taskId: taskRecord.id,
      type: "task_coding",
      status: "failed",
      provider: "jules",
      errorMessage: "Jules API unavailable",
      lastErrorMessage: "Jules API unavailable",
    });

    const providerUsage = executionRepository.getProviderInvocationUsage(julesInvocation.providerInvocationId!);
    expect(providerUsage?.status).toBe("failed");

    const dispatches = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
      taskId: taskRecord.id,
    });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      status: "failed",
      errorMessage: "Jules API unavailable",
    });

    const taskRun = executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id);
    expect(taskRun).toMatchObject({
      state: "FAILED",
      provider: "jules",
    });
    expect(executionRepository.listTaskRunEvents(taskRun!.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "dispatch_failed",
        payload: expect.objectContaining({
          dispatchId: dispatches[0]!.id,
          error: "Jules API unavailable",
        }),
      }),
    ]));

    const messages = executionRepository.listExecutionInvocationMessages(julesInvocation.id);
    expect(messages.some((message) => message.contentMarkdown.includes("Jules dispatch failed: Jules API unavailable"))).toBe(true);
  });

  it("defers Jules capacity responses without failing the task or leaking the claimed slot", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Jules Capacity Project",
      sourceType: "local",
      sourceRef: "/workspace/jules-capacity-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Jules Capacity Sprint",
      number: 21,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wait for hosted capacity",
      promptMarkdown: "Start when a hosted session slot becomes available.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "jules",
    });
    taskService.resolveTaskProvider.mockReturnValue("jules");
    taskService.startSprintTask.mockRejectedValue(new JulesApiRequestError(
      "Jules API create session failed (HTTP 400 INVALID_ARGUMENT): Maximum active sessions reached",
      400,
      "INVALID_ARGUMENT",
    ));
    const startArgs = {
      task: {
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
        title: taskRecord.title,
        prompt: taskRecord.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING" as const,
      },
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feature/sprint-21",
      repoPath: "/workspace/jules-capacity-project",
      sprintNumber: 21,
    };

    await expect(service.startTask(startArgs)).rejects.toBeInstanceOf(ProviderCapReachedError);
    await expect(service.startTask(startArgs)).rejects.toBeInstanceOf(ProviderCapReachedError);

    expect(taskService.startSprintTask).toHaveBeenCalledTimes(1);
    const [dispatch] = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
      taskId: taskRecord.id,
    });
    expect(dispatch).toMatchObject({ status: "queued", finishedAt: null, errorMessage: null });
    expect(executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id)).toMatchObject({
      state: "PENDING",
      finishedAt: null,
    });
    expect(projectManagementRepository.getTask(taskRecord.id)).toMatchObject({ status: "pending" });
    const [usage] = executionRepository.listProviderInvocationsForTask(project.id, taskRecord.id);
    expect(usage).toMatchObject({ provider: "jules", status: "cancelled" });
    const [invocation] = executionRepository.listExecutionInvocations({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    expect(invocation).toMatchObject({ provider: "jules", status: "cancelled", errorMessage: null });
  });

  it("reserves Jules slots for remotely active API sessions outside local accounting", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Remote Jules Capacity Project",
      sourceType: "local",
      sourceRef: "/workspace/remote-jules-capacity-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Remote Jules Capacity Sprint",
      number: 23,
    });
    const firstTask = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Use the final remote slot",
      promptMarkdown: "Start only if the API reports one slot.",
      executorType: "jules",
    });
    const secondTask = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wait behind the remote capacity cap",
      promptMarkdown: "Do not create a sixteenth session.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "jules",
    });
    const remoteSessions = Array.from({ length: 14 }, (_, index) => ({
      id: `remote-active-${index}`,
      name: `sessions/remote-active-${index}`,
      prompt: "Existing remote work",
      state: "IN_PROGRESS",
    }));
    const listJulesSessionsForCapacity = vi.fn().mockResolvedValue(remoteSessions);
    const capacityAwareService = new SprintTaskDispatchService(
      executionRepository,
      projectManagementRepository,
      taskService as any,
      (service as any).guardrailService,
      (service as any).providerConcurrencyService,
      () => DEFAULT_DASHBOARD_SETTINGS,
      (service as any).logger,
      listJulesSessionsForCapacity,
    );
    taskService.resolveTaskProvider.mockReturnValue("jules");
    taskService.startSprintTask.mockResolvedValue({
      id: "jules-final-slot",
      name: "sessions/jules-final-slot",
      provider: "jules",
    });
    const buildArgs = (taskRecord: typeof firstTask) => ({
      task: {
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
        title: taskRecord.title,
        prompt: taskRecord.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING" as const,
      },
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feature/sprint-23",
      repoPath: "/workspace/remote-jules-capacity-project",
      sprintNumber: 23,
    });

    await expect(capacityAwareService.startTask(buildArgs(firstTask))).resolves.toMatchObject({
      id: "jules-final-slot",
    });
    await expect(capacityAwareService.startTask(buildArgs(secondTask))).rejects.toMatchObject({
      provider: "jules",
      limit: 15,
      currentCount: 15,
    });

    expect(listJulesSessionsForCapacity).toHaveBeenCalledTimes(2);
    expect(taskService.startSprintTask).toHaveBeenCalledTimes(1);
    expect(projectManagementRepository.getTask(secondTask.id)).toMatchObject({ status: "pending" });
    expect(executionRepository.getLatestTaskRun(secondTask.id, sprintRun.id)).toMatchObject({
      state: "PENDING",
      finishedAt: null,
    });
  });

  it("defers Jules dispatch when the API capacity check is unavailable", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Jules Capacity Check Project",
      sourceType: "local",
      sourceRef: "/workspace/jules-capacity-check-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Jules Capacity Check Sprint",
      number: 24,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wait for a verified provider slot",
      promptMarkdown: "Fail closed when Jules cannot report active sessions.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "jules",
    });
    const capacityAwareService = new SprintTaskDispatchService(
      executionRepository,
      projectManagementRepository,
      taskService as any,
      (service as any).guardrailService,
      (service as any).providerConcurrencyService,
      () => DEFAULT_DASHBOARD_SETTINGS,
      (service as any).logger,
      vi.fn().mockRejectedValue(new Error("Jules list sessions unavailable")),
    );
    taskService.resolveTaskProvider.mockReturnValue("jules");

    await expect(capacityAwareService.startTask({
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
      featureBranch: "feature/sprint-24",
      repoPath: "/workspace/jules-capacity-check-project",
      sprintNumber: 24,
    })).rejects.toThrow("Provider concurrency cap reached for jules");

    expect(taskService.startSprintTask).not.toHaveBeenCalled();
    expect(projectManagementRepository.getTask(taskRecord.id)).toMatchObject({ status: "pending" });
  });

  it("defers a generic Jules failed precondition even when the bounded snapshot is under capacity", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Jules Precondition Capacity Project",
      sourceType: "local",
      sourceRef: "/workspace/jules-precondition-capacity-project",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Jules Precondition Capacity Sprint",
      number: 26,
    });
    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Recheck ambiguous provider capacity",
      promptMarkdown: "Treat the provider rejection as authoritative when pagination hides older running work.",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "jules",
    });
    const makeRemoteSessions = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: `precondition-active-${index}`,
      name: `sessions/precondition-active-${index}`,
      prompt: "Existing remote work",
      state: "IN_PROGRESS",
    }));
    const listJulesSessionsForCapacity = vi.fn()
      .mockResolvedValueOnce(makeRemoteSessions(14))
      .mockResolvedValueOnce(makeRemoteSessions(14));
    const capacityAwareService = new SprintTaskDispatchService(
      executionRepository,
      projectManagementRepository,
      taskService as any,
      (service as any).guardrailService,
      (service as any).providerConcurrencyService,
      () => DEFAULT_DASHBOARD_SETTINGS,
      (service as any).logger,
      listJulesSessionsForCapacity,
    );
    taskService.resolveTaskProvider.mockReturnValue("jules");
    taskService.startSprintTask.mockRejectedValue(new JulesApiRequestError(
      "Jules API create session failed (HTTP 400 FAILED_PRECONDITION): Precondition check failed.",
      400,
      "FAILED_PRECONDITION",
    ));

    await expect(capacityAwareService.startTask({
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
      featureBranch: "feature/sprint-26",
      repoPath: "/workspace/jules-precondition-capacity-project",
      sprintNumber: 26,
    })).rejects.toMatchObject({ provider: "jules", currentCount: 15 });

    expect(listJulesSessionsForCapacity).toHaveBeenCalledTimes(2);
    expect(taskService.startSprintTask).toHaveBeenCalledTimes(1);
    expect(projectManagementRepository.getTask(taskRecord.id)).toMatchObject({ status: "pending" });
    expect(executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id)).toMatchObject({
      state: "PENDING",
      finishedAt: null,
    });
  });

  it("defers task start and records wait event when concurrency cap is reached", async () => {
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
      title: "Run in container",
      promptMarkdown: "Run this task in the isolated container workflow.",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    const customSettings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      aiProvider: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
        providers: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
          codex: {
            provider: "codex" as any,
            maxConcurrentTasks: 2,
          },
        },
      },
    };

    const customService = new SprintTaskDispatchService(
      executionRepository,
      projectManagementRepository,
      taskService as any,
      (service as any).guardrailService,
      (service as any).providerConcurrencyService,
      () => customSettings,
      (service as any).logger,
    );

    vi.spyOn((service as any).providerConcurrencyService, "getGlobalRunningCounts").mockReturnValue({ codex: 2 });

    await expect(customService.startTask({
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
    })).rejects.toThrow("Provider concurrency cap reached for codex (limit 2, current 2); task deferred.");

    const latestRun = executionRepository.getLatestTaskRun(taskRecord.id, sprintRun.id);
    expect(latestRun).not.toBeNull();
    expect(latestRun!.state).toBe("PENDING");

    const dispatches = executionRepository.listTaskDispatches({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    expect(dispatches[0]).toMatchObject({
      taskId: taskRecord.id,
      executorType: "docker_cli",
      status: "queued",
    });

    const events = executionRepository.listTaskRunEvents(latestRun!.id);
    const waitEvent = events.find(e => e.eventType === "provider_concurrency_wait");
    expect(waitEvent).toBeDefined();
    expect(waitEvent!.payload).toEqual({
      provider: "codex",
      currentCount: 2,
      limit: 2,
    });
    expect(taskService.startSprintTask).not.toHaveBeenCalled();
    expect((service as any).guardrailService.record).not.toHaveBeenCalled();
  });
});
