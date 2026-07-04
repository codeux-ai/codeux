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

    const messages = executionRepository.listExecutionInvocationMessages(julesInvocation.id);
    expect(messages.some((message) => message.contentMarkdown.includes("Jules dispatch failed: Jules API unavailable"))).toBe(true);
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
