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
    expect(taskService.startSprintTask).toHaveBeenCalled();

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
