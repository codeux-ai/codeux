import { describe, expect, it, vi } from "vitest";
import { SprintTaskDispatchService, ProviderCapReachedError } from "../../../src/services/sprint-task-dispatch-service.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { TaskService } from "../../../src/services/task-service.js";
import { ProviderConcurrencyService } from "../../../src/services/provider-concurrency-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

async function createFixture(options?: { provider?: string; julesCap?: number }) {
  const provider = options?.provider ?? "codex";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-dispatch-extra-"));
  const appStorage = new AppDbStorage(path.join(dir, "app.db"));
  const projectManagementRepository = new ProjectManagementRepository(appStorage);
  const executionRepository = new ExecutionRepository(appStorage);
  const taskService = {
    selectProviderForTask: vi.fn().mockReturnValue(provider),
    selectCliProviderForTask: vi.fn().mockReturnValue(provider),
    resolveTaskProvider: vi.fn().mockReturnValue(provider),
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
  const dashboardSettings = options?.julesCap !== undefined
    ? {
      ...DEFAULT_DASHBOARD_SETTINGS,
      aiProvider: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
        providers: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
          jules: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules, maxConcurrentTasks: options.julesCap },
        },
      },
    }
    : DEFAULT_DASHBOARD_SETTINGS;
  const service = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService as any,
    guardrailService as any,
    providerConcurrencyService,
    () => dashboardSettings,
    logger as any,
  );

  return { dir, projectManagementRepository, executionRepository, taskService, service, guardrailService };
}

describe("SprintTaskDispatchService Extra Coverage", () => {
  it("startTask respects providerOverride", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    
    const project = projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "T",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        executorMode: "docker_cli",
        status: "running",
    });
    
    taskService.startSprintTask.mockResolvedValue({ id: "sess-1", name: "session-1", provider: "override-provider" });

    const result = await service.startTask({
      task: { id: "T-1", record_id: task.id, provider: "override-provider" } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 1,
    });

    expect(result.provider).toBe("override-provider");
    expect(taskService.selectCliProviderForTask).not.toHaveBeenCalled();
  });

  it("startTask handles jules executor", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    
    const project = projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 2 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "T",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        executorMode: "jules",
        status: "running",
    });
    
    taskService.startSprintTask.mockResolvedValue({ id: "sess-2", name: "session-2", provider: "jules" });

    const result = await service.startTask({
      task: { id: "T-2", record_id: task.id } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 2,
    });

    expect(result.provider).toBe("jules");
  });

  it("startTask handles failure during session start", async () => {
    const { projectManagementRepository, taskService, service, executionRepository } = await createFixture();
    
    const project = projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 3 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "T",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        executorMode: "docker_cli",
        status: "running",
    });
    
    taskService.startSprintTask.mockRejectedValue(new Error("Failed to start session"));

    await expect(service.startTask({
      task: { id: "T-3", record_id: task.id } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 3,
    })).rejects.toThrow("Failed to start session");

    const dispatches = executionRepository.listTaskDispatches({ projectId: project.id });
    expect(dispatches[0].status).toBe("failed");
    expect(dispatches[0].errorMessage).toBe("Failed to start session");
  });

  it("requireTaskRecordId throws on missing id", async () => {
    const { service } = await createFixture();
    
    expect(() => (service as any).requireTaskRecordId({ id: "T" })).toThrow("Task T is missing its database record id.");
    expect(() => (service as any).requireTaskRecordId({ id: "T", record_id: "" })).toThrow("Task T is missing its database record id.");
  });

  it("resolveWorkerBranch and resolvePrUrl handle missing outputs", async () => {
    const { service } = await createFixture();
    
    expect((service as any).resolveWorkerBranch({})).toBeNull();
    expect((service as any).resolveWorkerBranch({ outputs: [] })).toBeNull();
    expect((service as any).resolveWorkerBranch({ outputs: [{}] })).toBeNull();
    
    expect((service as any).resolvePrUrl({})).toBeNull();
    expect((service as any).resolvePrUrl({ outputs: [] })).toBeNull();
    expect((service as any).resolvePrUrl({ outputs: [{}] })).toBeNull();
  });

  it("calculateDurationMs handles missing startedAt", async () => {
    const { service } = await createFixture();

    expect((service as any).calculateDurationMs({}, "2026-04-01T00:00:00Z")).toBeNull();
    expect((service as any).calculateDurationMs({ startedAt: "2026-04-01T00:00:00Z" }, "2026-04-01T00:00:01Z")).toBe(1000);
  });

  it("never exceeds the Jules cap and defers further dispatches, even across sprints", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture({
      provider: "jules",
      julesCap: 2,
    });
    const project = projectManagementRepository.createProject({
      name: "Cap", sourceType: "local", sourceRef: "/test", defaultBranch: "main",
    });
    // Two separate sprints to prove the cap is global (cross-sprint), not per-sprint.
    const sprintA = projectManagementRepository.createSprint(project.id, { name: "A", number: 1 });
    const sprintB = projectManagementRepository.createSprint(project.id, { name: "B", number: 2 });
    const runA = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprintA.id, executorMode: "jules", status: "running" });
    const runB = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprintB.id, executorMode: "jules", status: "running" });

    let counter = 0;
    taskService.startSprintTask.mockImplementation(async () => {
      counter += 1;
      return { id: `jules-session-${counter}`, name: `sessions/jules-session-${counter}`, provider: "jules" };
    });

    const dispatch = async (sprintId: string, sprintRunId: string, key: string) => {
      const taskRecord = projectManagementRepository.createTask(project.id, {
        sprintId, title: key, executorType: "jules",
      });
      return service.startTask({
        task: { id: key, record_id: taskRecord.id } as any,
        projectId: project.id,
        sprintId,
        sprintRunId,
        featureBranch: "feat",
        repoPath: "/test",
        sprintNumber: 1,
      });
    };

    // Two slots available: first two dispatches (across both sprints) succeed.
    await dispatch(sprintA.id, runA.id, "A-1");
    await dispatch(sprintB.id, runB.id, "B-1");

    // Cap reached globally: the third dispatch is deferred, not started.
    await expect(dispatch(sprintA.id, runA.id, "A-2")).rejects.toBeInstanceOf(ProviderCapReachedError);

    // The global running Jules count is exactly the cap — never exceeded.
    const running = executionRepository.listRunningProviderInvocationUsages(["jules"]);
    expect(running).toHaveLength(2);
    // Each claimed slot was re-keyed onto its real Jules session id for lifecycle release.
    expect(running.map((r: any) => r.sessionId).sort()).toEqual(["jules-session-1", "jules-session-2"]);
  });

  it("releases the Jules slot when dispatch fails so capacity is not leaked", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture({
      provider: "jules",
      julesCap: 1,
    });
    const project = projectManagementRepository.createProject({
      name: "Leak", sourceType: "local", sourceRef: "/test", defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 1 });
    const run = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, executorMode: "jules", status: "running" });

    taskService.startSprintTask.mockRejectedValueOnce(new Error("jules api boom"));

    const taskRecord = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id, title: "T", executorType: "jules",
    });
    await expect(service.startTask({
      task: { id: "T", record_id: taskRecord.id } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: run.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 1,
    })).rejects.toThrow("jules api boom");

    // The failed dispatch must not hold the only slot.
    expect(executionRepository.listRunningProviderInvocationUsages(["jules"])).toHaveLength(0);
  });
});
