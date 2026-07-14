import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { GuardrailRepository } from "../../../src/repositories/guardrail-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectWorkerAssignmentService } from "../../../src/domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { WorkerTaskDispatchService } from "../../../src/services/worker-task-dispatch-service.js";
import { VirtualWorkerService } from "../../../src/services/virtual-worker-service.js";
import { GuardrailService } from "../../../src/services/guardrail-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as cliProcessRunner from "../../../src/services/cli-process-runner.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-virtual-worker-"));
  tempDirs.push(dir);
  const appStorage = new AppDbStorage(path.join(dir, "app.db"));
  const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
  const sessionTracking = new SessionTrackingRepository(path.join(dir, "session-tracking.db"));
  const projectManagementRepository = new ProjectManagementRepository(appStorage);
  const executionRepository = new ExecutionRepository(appStorage);
  const workerEndpointRepository = new WorkerEndpointRepository(appStorage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(appStorage);
  const projectAttentionRepository = new ProjectAttentionRepository(appStorage);
  const projectWorkerAssignmentService = new ProjectWorkerAssignmentService(
    projectWorkerAssignmentRepository,
    workerEndpointRepository,
  );
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository,
    projectWorkerAssignmentRepository,
    (projectId, sprintId, resolver) => (
      sprintId
        ? (resolver || settingsRepository).resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode
        : (resolver || settingsRepository).resolveProjectDashboardSettings(projectId).settings.workers.executionMode
    ),
  );
  const workerTaskDispatchService = new WorkerTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    new ConnectionChatRepository(appStorage, undefined, workerEndpointRepository),
    workerEndpointRepository,
    projectWorkerAssignmentService,
    projectAttentionService,
    () => DEFAULT_DASHBOARD_SETTINGS,
    (projectId, sprintId, resolver) => (
      sprintId
        ? (resolver || settingsRepository).resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode
        : (resolver || settingsRepository).resolveProjectDashboardSettings(projectId).settings.workers.executionMode
    ),
  );
  workerTaskDispatchService.claimNextDispatchForWorker = vi.fn().mockReturnValue(null);

  return {
    dir,
    settingsRepository,
    sessionTracking,
    projectManagementRepository,
    executionRepository,
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectAttentionService,
    workerTaskDispatchService,
  };
}

function createSchedulingService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  hasAvailableCapacity = vi.fn().mockResolvedValue(true),
): VirtualWorkerService {
  return new VirtualWorkerService({
    settingsRepository: fixture.settingsRepository,
    sessionTracking: fixture.sessionTracking,
    executionRepository: fixture.executionRepository,
    projectManagementRepository: fixture.projectManagementRepository,
    workerEndpointRepository: fixture.workerEndpointRepository,
    projectWorkerAssignmentRepository: fixture.projectWorkerAssignmentRepository,
    projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
      fixture.projectWorkerAssignmentRepository,
      fixture.workerEndpointRepository,
    ),
    projectAttentionService: fixture.projectAttentionService,
    workerTaskDispatchService: fixture.workerTaskDispatchService,
    cliWorkflowService: { startTask: vi.fn() } as any,
    providerConcurrencyService: { hasAvailableCapacity } as any,
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("VirtualWorkerService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("duplicate attention items in the same sprint do not repeatedly hit settingsRepository during one scheduling pass", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualProject = projectManagementRepository.createProject({
      name: "Virtual Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-project",
      defaultBranch: "main",
    });

    settingsRepository.saveProjectSettings(virtualProject.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    const sprint = projectManagementRepository.createSprint(virtualProject.id, {
      name: "Sprint 1",
      number: 1,
      goal: "Test caching",
    });

    // Create duplicate open attention items in the same sprint
    for (let i = 0; i < 5; i++) {
      projectAttentionService.openItem({
        projectId: virtualProject.id,
        sprintId: sprint.id,
        taskId: null,
        sprintRunId: null,
        dispatchId: null,
        attentionType: "action_required",
        severity: "high",
        ownerType: "worker",
        title: `Virtual attention ${i}`,
        summaryMarkdown: "Needs worker action.",
        payload: null,
      });
    }

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    // Mock resolveEffectiveDashboardSettings by spying on settingsRepository
    const settingsSpy = vi.spyOn(settingsRepository, "getProjectSettings");

    await virtualWorkerService.reconcile();

    // The repository-level effective settings cache may already be warm from
    // setup, but this scheduling pass must not repeatedly hit settings rows for
    // duplicate attention items in the same sprint.
    expect(settingsSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("reconcile does not overlap exclusive attention or already-scheduled project work", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualProject = projectManagementRepository.createProject({
      name: "Virtual Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-project",
      defaultBranch: "main",
    });

    settingsRepository.saveProjectSettings(virtualProject.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    // Add an attention item so it gets picked up as a candidate
    projectAttentionService.openItem({
      projectId: virtualProject.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "action_required",
      severity: "high",
      ownerType: "worker",
      title: "Virtual attention",
      summaryMarkdown: "Action needed",
      payload: null,
    });

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    // Mock projectNeedsVirtualWorker to observe it
    const spyProjectNeeds = vi.spyOn(virtualWorkerService as any, "projectNeedsVirtualWorker");
    const scheduleSpy = vi.spyOn(virtualWorkerService, "scheduleProject");

    const attentionItem = projectAttentionService.listActiveProjectItems(virtualProject.id)[0];
    const reservationId = `attention:${attentionItem.id}:test`;
    (virtualWorkerService as any).cycleRegistry.tryReserve({
      id: reservationId,
      projectId: virtualProject.id,
      kind: "attention",
      attentionItemId: attentionItem.id,
    }, 1);

    await virtualWorkerService.reconcile();

    expect(spyProjectNeeds).toHaveBeenCalled();
    expect(scheduleSpy).not.toHaveBeenCalled();

    (virtualWorkerService as any).cycleRegistry.release(reservationId);
    (virtualWorkerService as any).scheduledProjects.add(virtualProject.id);
    spyProjectNeeds.mockClear();

    await virtualWorkerService.reconcile();

    expect(spyProjectNeeds).not.toHaveBeenCalled();
  });

  it("reconcile only schedules projects that still need virtual worker execution", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualProject = projectManagementRepository.createProject({
      name: "Virtual Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-project",
      defaultBranch: "main",
    });
    const connectedProject = projectManagementRepository.createProject({
      name: "Connected Project",
      sourceType: "local",
      sourceRef: "/workspace/connected-project",
      defaultBranch: "main",
    });

    settingsRepository.saveProjectSettings(virtualProject.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    projectAttentionService.openItem({
      projectId: virtualProject.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "action_required",
      severity: "high",
      ownerType: "worker",
      title: "Virtual attention",
      summaryMarkdown: "Needs worker action.",
      payload: null,
    });
    projectAttentionService.openItem({
      projectId: connectedProject.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "action_required",
      severity: "high",
      ownerType: "worker",
      title: "Connected attention",
      summaryMarkdown: "Clarification cooldown active for this project.",
      payload: null,
    });

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });
    const scheduleSpy = vi.spyOn(virtualWorkerService, "scheduleProject");
    const listProjectsSpy = vi.spyOn(projectManagementRepository, "listProjects");
    const activeAttentionSpy = vi.spyOn(projectAttentionService, "listProjectIdsWithOpenWorkerAttention");
    const pendingDispatchesSpy = vi.spyOn(executionRepository, "listProjectIdsWithPendingDispatches");

    await virtualWorkerService.reconcile();

    expect(listProjectsSpy).toHaveBeenCalledTimes(0);
    expect(activeAttentionSpy).toHaveBeenCalled();
    expect(pendingDispatchesSpy).toHaveBeenCalled();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(virtualProject.id, "reconcile", expect.any(Function));
  });

  it("escalates unsupported worker attention items to a human attention item", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const project = projectManagementRepository.createProject({
      name: "Virtual Attention Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-attention-project",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Virtual Attention Sprint",
      number: 18,
      featureBranch: "feature/sprint-18",
    });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Needs manual review",
      promptMarkdown: "Investigate the blocked worker condition.",
      executorType: "mcp_worker",
      priority: "high",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    const originalItem = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "action_required",
      severity: "high",
      ownerType: "worker",
      title: "Virtual worker blocked",
      summaryMarkdown: "The worker needs help with a non-merge blocker.",
      payload: {
        reason: "needs_manual_review",
      },
    });

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    virtualWorkerService.scheduleProject(project.id, "test_attention_escalation");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);

    const resolvedOriginal = projectAttentionService.getItem(originalItem.id);
    expect(resolvedOriginal?.status).toBe("resolved");

    const activeItems = projectAttentionService.listActiveProjectItems(project.id);
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0]?.ownerType).toBe("human");
    expect(activeItems[0]?.attentionType).toBe("human_escalation_required");
    expect(activeItems[0]?.title).toContain("Virtual worker escalation");
    expect(activeItems[0]?.payload?.sourceAttentionItemId).toBe(originalItem.id);
    expect(activeItems[0]?.payload?.escalatedBy).toBe("virtual_worker");

    expect(workerEndpointRepository.listWorkerEndpoints().filter((endpoint) => endpoint.endpointType === "virtual_cli")).toHaveLength(0);
    expect(projectWorkerAssignmentRepository.listAssignmentsForProject(project.id, { activeOnly: true })).toHaveLength(0);
  });

  it("peekNextWorkerAttention skips merge_required items", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const project = projectManagementRepository.createProject({
      name: "Merge Required Skip Project",
      sourceType: "local",
      sourceRef: "/workspace/merge-required-skip",
      defaultBranch: "main",
    });

    // Create a merge_required item — should be skipped by virtual worker
    projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      title: "Merge required",
      summaryMarkdown: "PR ready for merge.",
      payload: null,
    });

    settingsRepository.saveProjectSettings(project.id, {
      ciIntelligence: {
        resolveMergeConflicts: true,
      },
    });

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    // Access private method directly — merge_required items must be skipped
    const result = (virtualWorkerService as any).peekNextWorkerAttention(project.id);
    expect(result).toBeNull();

    // merge_conflict items should still be picked up
    projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge conflict",
      summaryMarkdown: "Conflicting changes.",
      payload: null,
    });

    const conflictResult = (virtualWorkerService as any).peekNextWorkerAttention(project.id);
    expect(conflictResult).not.toBeNull();
    expect(conflictResult.attentionType).toBe("merge_conflict");
  });

  it("scheduleProject is a no-op for non-virtual projects", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const project = projectManagementRepository.createProject({
      name: "Non-Virtual Project",
      sourceType: "local",
      sourceRef: "/workspace/non-virtual",
      defaultBranch: "main",
    });

    // Default settings — not VIRTUAL mode
    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    // Should return early without scheduling anything
    virtualWorkerService.scheduleProject(project.id, "test");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);

    // No endpoint created, no startTask called
    expect(workerEndpointRepository.listWorkerEndpoints().filter(e => e.endpointType === "virtual_cli")).toHaveLength(0);
  });

  it("projectNeedsVirtualWorker returns true when open worker attention exists", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const project = projectManagementRepository.createProject({
      name: "Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/dispatch-project",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Dispatch Sprint",
      number: 20,
      featureBranch: "feature/sprint-20",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Dispatch task",
      promptMarkdown: "Do the thing.",
      executorType: "docker_cli",
      priority: "high",
    });
    projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "action_required",
      severity: "high",
      ownerType: "worker",
      title: "Plan approval required",
      summaryMarkdown: "Needs automated worker follow-up.",
      payload: {
        sessionId: "session-1",
        sessionState: "AWAITING_PLAN_APPROVAL",
      },
    });

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    expect((virtualWorkerService as any).projectNeedsVirtualWorker(project.id)).toBe(true);
  });

  it("projectNeedsVirtualWorker returns true for virtual projects with pending dispatches and no attention", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const project = projectManagementRepository.createProject({
      name: "Pending Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/pending-dispatch-project",
      defaultBranch: "main",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Pending Dispatch Sprint",
      number: 1,
    });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Pending dispatch task",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    } as any);

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    expect((virtualWorkerService as any).projectNeedsVirtualWorker(project.id)).toBe(true);
  });

  it("runs two independent project dispatch cycles concurrently and cleans reservations", async () => {
    const fixture = await createFixture();
    const project = fixture.projectManagementRepository.createProject({
      name: "Parallel Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/parallel-dispatch",
      defaultBranch: "main",
    });
    fixture.settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex", maxConcurrency: 2 },
    });
    const sprint = fixture.projectManagementRepository.createSprint(project.id, { name: "Parallel Sprint", number: 1 });
    const sprintRun = fixture.executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    for (const title of ["Independent one", "Independent two"]) {
      const task = fixture.projectManagementRepository.createTask(project.id, { sprintId: sprint.id, title });
      fixture.executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        executorType: "docker_cli",
        status: "queued",
      } as any);
    }

    const service = createSchedulingService(fixture);
    const resolveCycles: Array<() => void> = [];
    const cycleSpy = vi.spyOn(service as any, "runProjectCycle").mockImplementation(() => (
      new Promise<void>((resolve) => resolveCycles.push(resolve))
    ));

    service.scheduleProject(project.id, "parallel_test");
    await vi.advanceTimersByTimeAsync(0);

    expect(cycleSpy).toHaveBeenCalledTimes(2);
    expect((service as any).cycleRegistry.countProject(project.id)).toBe(2);

    // A second scheduling signal cannot duplicate the active task/dispatch work.
    service.scheduleProject(project.id, "duplicate_signal");
    await vi.advanceTimersByTimeAsync(0);
    expect(cycleSpy).toHaveBeenCalledTimes(2);

    resolveCycles.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect((service as any).cycleRegistry.countProject(project.id)).toBe(0);
    expect((service as any).activeCycles.size).toBe(0);
    service.stop();
  });

  it("enforces project max concurrency and avoids two cycles for the same task", async () => {
    const fixture = await createFixture();
    const project = fixture.projectManagementRepository.createProject({
      name: "Bounded Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/bounded-dispatch",
      defaultBranch: "main",
    });
    fixture.settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex", maxConcurrency: 2 },
    });
    const sprint = fixture.projectManagementRepository.createSprint(project.id, { name: "Bounded Sprint", number: 1 });
    const sprintRun = fixture.executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    const firstTask = fixture.projectManagementRepository.createTask(project.id, { sprintId: sprint.id, title: "Shared task" });
    const secondTask = fixture.projectManagementRepository.createTask(project.id, { sprintId: sprint.id, title: "Other task" });
    for (const taskId of [firstTask.id, firstTask.id, secondTask.id]) {
      fixture.executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId,
        sprintRunId: sprintRun.id,
        executorType: "docker_cli",
        status: "queued",
      } as any);
    }

    const service = createSchedulingService(fixture);
    const cycleSpy = vi.spyOn(service as any, "runProjectCycle").mockReturnValue(new Promise<void>(() => undefined));

    service.scheduleProject(project.id, "bounded_test");
    await vi.advanceTimersByTimeAsync(0);

    expect(cycleSpy).toHaveBeenCalledTimes(2);
    const scheduledTaskIds = cycleSpy.mock.calls.map((call) => call[3].taskId);
    expect(new Set(scheduledTaskIds).size).toBe(2);
    expect((service as any).cycleRegistry.countProject(project.id)).toBe(2);
    service.stop();
  });

  it("gives worker attention precedence over queued coding dispatches", async () => {
    const fixture = await createFixture();
    const project = fixture.projectManagementRepository.createProject({
      name: "Attention First Project",
      sourceType: "local",
      sourceRef: "/workspace/attention-first",
      defaultBranch: "main",
    });
    fixture.settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex", maxConcurrency: 3 },
    });
    const sprint = fixture.projectManagementRepository.createSprint(project.id, { name: "Attention Sprint", number: 1 });
    const task = fixture.projectManagementRepository.createTask(project.id, { sprintId: sprint.id, title: "Queued task" });
    const sprintRun = fixture.executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    fixture.executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    } as any);
    const attention = fixture.projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: null,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "Repair CI",
      summaryMarkdown: "Repair before more coding starts.",
      payload: null,
    });

    const service = createSchedulingService(fixture);
    const cycleSpy = vi.spyOn(service as any, "runProjectCycle").mockReturnValue(new Promise<void>(() => undefined));

    service.scheduleProject(project.id, "attention_test");
    await vi.advanceTimersByTimeAsync(0);

    expect(cycleSpy).toHaveBeenCalledOnce();
    expect(cycleSpy.mock.calls[0]?.[3]).toEqual({ kind: "attention", attentionItemId: attention.id });
    expect((service as any).cycleRegistry.hasAttention(project.id)).toBe(true);
    service.stop();
  });

  it("does not create an endpoint or claim a dispatch while provider pressure denies capacity", async () => {
    const fixture = await createFixture();
    const project = fixture.projectManagementRepository.createProject({
      name: "Pressure Project",
      sourceType: "local",
      sourceRef: "/workspace/pressure-project",
      defaultBranch: "main",
    });
    fixture.settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex", maxConcurrency: 2 },
    });
    const sprint = fixture.projectManagementRepository.createSprint(project.id, { name: "Pressure Sprint", number: 1 });
    const task = fixture.projectManagementRepository.createTask(project.id, { sprintId: sprint.id, title: "Wait for capacity" });
    const sprintRun = fixture.executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    const dispatch = fixture.executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    } as any);
    const hasAvailableCapacity = vi.fn().mockResolvedValue(false);
    const service = createSchedulingService(fixture, hasAvailableCapacity);

    await (service as any).runProjectCycle(project.id, "pressure_test", undefined, {
      kind: "dispatch",
      dispatchId: dispatch.id,
      taskId: task.id,
      sprintId: sprint.id,
    });

    expect(hasAvailableCapacity).toHaveBeenCalledWith("codex", expect.any(Number));
    expect(fixture.workerTaskDispatchService.claimNextDispatchForWorker).not.toHaveBeenCalled();
    expect(fixture.workerEndpointRepository.listWorkerEndpoints().filter((endpoint) => endpoint.endpointType === "virtual_cli")).toEqual([]);
    expect(fixture.executionRepository.getTaskDispatch(dispatch.id)?.status).toBe("queued");
  });

  it("does not schedule or claim a queued dispatch for the clarification's task", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Pending Clarification Project",
      sourceType: "local",
      sourceRef: "/workspace/pending-clarification",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Clarification Sprint",
      number: 1,
    });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wait for manager",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    } as any);
    projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: null,
      attentionType: "worker_clarification",
      severity: "high",
      ownerType: "human",
      title: "Worker clarification requested",
      summaryMarkdown: "Should compatibility be preserved?",
      payload: { type: "worker_clarification", status: "pending" },
    });
    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex" },
    });

    const service = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: { hasAvailableCapacity: vi.fn().mockResolvedValue(true) } as any,
    });
    const scheduleSpy = vi.spyOn(service, "scheduleProject");

    await service.reconcile();

    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(workerTaskDispatchService.claimNextDispatchForWorker).not.toHaveBeenCalled();
    expect(projectAttentionService.listActiveProjectItems(project.id)).toEqual([
      expect.objectContaining({ ownerType: "human", attentionType: "worker_clarification", status: "open" }),
    ]);
  });

  it("schedules and claims an unrelated queued dispatch while another task awaits clarification", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "Scoped Clarification Project",
      sourceType: "local",
      sourceRef: "/workspace/scoped-clarification",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Scoped Clarification Sprint",
      number: 1,
    });
    const blockedTask = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wait for manager",
    });
    const unrelatedTask = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Continue independently",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const unrelatedDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: unrelatedTask.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    } as any);
    projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: blockedTask.id,
      sprintRunId: sprintRun.id,
      dispatchId: null,
      attentionType: "worker_clarification",
      severity: "high",
      ownerType: "human",
      title: "Worker clarification requested",
      summaryMarkdown: "Which compatibility behavior is required?",
      payload: { type: "worker_clarification", status: "pending" },
    });
    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex" },
    });

    const service = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: { hasAvailableCapacity: vi.fn().mockResolvedValue(true) } as any,
    });

    expect((service as any).projectNeedsVirtualWorker(project.id)).toBe(true);

    const claim = {
      dispatch: unrelatedDispatch,
      leaseToken: "unrelated-lease",
      sprint: { id: sprint.id },
    } as any;
    vi.mocked(workerTaskDispatchService.claimNextDispatchForWorker).mockReturnValue(claim);
    const handleDispatch = vi.spyOn(service as any, "handleTaskDispatch").mockResolvedValue(undefined);

    await (service as any).runProjectCycle(project.id, "test");

    expect(workerTaskDispatchService.claimNextDispatchForWorker).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      dispatchId: unrelatedDispatch.id,
      taskId: unrelatedTask.id,
      sprintId: sprint.id,
    }));
    expect(handleDispatch).toHaveBeenCalledWith(expect.any(String), claim);
    expect(projectAttentionService.listActiveProjectItems(project.id)).toEqual([
      expect.objectContaining({ ownerType: "human", attentionType: "worker_clarification", status: "open" }),
    ]);
  });

  it("taskless general clarifications do not suppress coding dispatch scheduling", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();
    const project = projectManagementRepository.createProject({
      name: "General Clarification Project",
      sourceType: "local",
      sourceRef: "/workspace/general-clarification",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "General Clarification Sprint",
      number: 1,
    });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Independent coding task",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    } as any);
    projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "worker_clarification",
      severity: "high",
      ownerType: "human",
      title: "General clarification requested",
      summaryMarkdown: "Which general convention should be preferred?",
      payload: { type: "worker_clarification", status: "pending" },
    });
    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex" },
    });

    const service = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: { hasAvailableCapacity: vi.fn().mockResolvedValue(true) } as any,
    });

    expect((service as any).projectNeedsVirtualWorker(project.id)).toBe(true);
  });

  it("start and stop manage the reconcile timer", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    virtualWorkerService.start();
    // Calling start again should be a no-op (idempotent)
    virtualWorkerService.start();
    virtualWorkerService.stop();
    // Calling stop again should be safe
    virtualWorkerService.stop();
  });

  it("logs initial reconcile failures during start", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();
    const logger = { error: vi.fn() };

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
      logger: logger as any,
    });
    const error = new Error("initial reconcile failed");
    vi.spyOn(virtualWorkerService, "reconcile").mockRejectedValueOnce(error);

    virtualWorkerService.start();
    await Promise.resolve();
    await Promise.resolve();
    virtualWorkerService.stop();

    expect(logger.error).toHaveBeenCalledWith("Virtual worker reconcile failed", { error });
  });

  it("getProviderLabel returns correct labels", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    expect((virtualWorkerService as any).getProviderLabel("claude-code")).toBe("Claude Code");
    expect((virtualWorkerService as any).getProviderLabel("gemini")).toBe("Gemini");
    expect((virtualWorkerService as any).getProviderLabel("codex")).toBe("Codex");
  });

  it("readRequiredString throws on empty values", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    expect((virtualWorkerService as any).readRequiredString("hello", "test")).toBe("hello");
    expect(() => (virtualWorkerService as any).readRequiredString("", "test")).toThrow("Missing test");
    expect(() => (virtualWorkerService as any).readRequiredString(null, "field")).toThrow("Missing field");
  });

  it("resolveWorkerExecutionMode uses sprint-level settings when sprintId provided", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const project = projectManagementRepository.createProject({
      name: "Sprint Settings Project",
      sourceType: "local",
      sourceRef: "/workspace/sprint-settings",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Sprint With Settings",
      number: 30,
      featureBranch: "feature/sprint-30",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
      },
    });
    const baseProjectSettings = settingsRepository.resolveProjectDashboardSettings(project.id).settings;
    settingsRepository.saveSprintSettings(sprint.id, baseProjectSettings, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
      },
    });

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: { startTask: vi.fn() } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    // Cover resolveDashboardSettings with sprintId
    const settings = (virtualWorkerService as any).resolveDashboardSettings(project.id, sprint.id);
    expect(settings.workers.executionMode).toBe("VIRTUAL");
    // Cover resolveCycleSettings
    const cycleSettings = (virtualWorkerService as any).resolveCycleSettings(project.id);
    expect(cycleSettings).toBeDefined();
    expect(cycleSettings.workers.virtualWorkerProvider).toBe("gemini");
  });

  it("builds merge conflict prompts from both current and legacy attention payload fields", async () => {
    const {
      settingsRepository,
      sessionTracking,
      projectManagementRepository,
      executionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
      workerTaskDispatchService,
    } = await createFixture();

    const virtualWorkerService = new VirtualWorkerService({
      settingsRepository,
      sessionTracking,
      executionRepository,
      projectManagementRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        projectWorkerAssignmentRepository,
        workerEndpointRepository,
      ),
      projectAttentionService,
      workerTaskDispatchService,
      cliWorkflowService: {
        startTask: vi.fn(),
      } as any,
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });

    const prompt = (virtualWorkerService as any).buildMergeConflictPrompt(
      {
        id: "attention-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: null,
        dispatchId: null,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        status: "open",
        assignedWorkerEndpointId: null,
        title: "Merge conflict",
        summaryMarkdown: "Summary body",
        payload: {
          currentTask: {
            taskPrompt: "Preserve the current task change in monitoring/dag-conflict-b-2026-07-03T16-28-17-794Z/beta.md.",
          },
          featureBranchTaskContexts: [
            {
              taskKey: "T01",
              taskTitle: "Earlier merge",
              taskPrompt: "Keep the earlier merged edit for dag-conflict-2026-07-03T16-28-17-794Z-B-T01.",
            },
          ],
          lastVirtualWorkerError: "Merge conflict resolution mutated required prompt timestamp literals.",
          lastVirtualWorkerProvider: "opencode",
          lastVirtualWorkerSessionId: "virtual-merge-opencode-test",
          lastVirtualWorkerFailedAt: "2026-07-03T18:41:17.409Z",
        },
        openedAt: "2026-03-15T10:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-15T10:00:00.000Z",
      },
      "task/branch",
      "feature/branch",
      "Workspace guidance",
      "## PROJECT CONTEXT FROM MEMORY\n- [patterns] Prefer preserving both branch intents.",
      "Record durable merge learnings in .task-learnings.md",
    );

    expect(prompt).toContain("Preserve exact literal identifiers");
    expect(prompt).toContain("Do not normalize, reformat, or reinterpret timestamp-like strings");
    expect(prompt).toContain("copy required existing lines verbatim");
    expect(prompt).toContain("repair it to the exact literal from the task prompt");
    expect(prompt).toContain("Preserve the current task change in monitoring/dag-conflict-b-2026-07-03T16-28-17-794Z/beta.md.");
    expect(prompt).toContain("T01 Earlier merge");
    expect(prompt).toContain("Keep the earlier merged edit for dag-conflict-2026-07-03T16-28-17-794Z-B-T01.");
    expect(prompt).toContain("Previous automatic merge-conflict attempt failed");
    expect(prompt).toContain("Provider: opencode");
    expect(prompt).toContain("Session: virtual-merge-opencode-test");
    expect(prompt).toContain("Error: Merge conflict resolution mutated required prompt timestamp literals.");
    expect(prompt).not.toContain("2026-07-03T16:28:17Z");
    expect(prompt).toContain("## PROJECT CONTEXT FROM MEMORY");
    expect(prompt).toContain("Record durable merge learnings in .task-learnings.md");
    expect(prompt).toContain("Workspace guidance");
  });

  it("buildCiFixPrompt formats correctly", async () => {
    const { virtualWorkerService } = await setupService();

    const prompt = (virtualWorkerService as any).buildCiFixPrompt(
      {
        summaryMarkdown: "Fix CI",
        payload: {
          failedChecks: ["lint", "test"],
          failedJobLabels: ["Lint Job"],
          failedLogSnippets: ["Error: lint failed"],
          failedRuns: [
            {
              id: 123,
              name: "CI",
              workflowName: "Main CI",
              status: "completed",
              conclusion: "failure",
              event: "pull_request",
              headBranch: "fix/branch",
              url: "https://github.com/test/actions/runs/123",
              updatedAt: "2026-06-13T15:00:00Z",
              failedJobs: [
                {
                  id: 456,
                  name: "Lint Job",
                  conclusion: "failure",
                  failedSteps: ["Run lint"],
                  logExcerpt: "Error: lint failed",
                  logCommand: "gh run view 123 --job 456 --log-failed",
                },
              ],
            },
          ],
          prUrl: "https://github.com/test/pr/1",
          prNumber: 1,
          taskKey: "T01",
          taskTitle: "Original feature",
          taskPrompt: "Do the task",
        }
      },
      "fix/branch",
      "Workspace guidance context",
      "## PROJECT CONTEXT FROM MEMORY\n- [error] This suite flakes when env vars are missing.",
      "Record durable CI learnings in .task-learnings.md",
    );

    expect(prompt).toContain("# CI Fix Job");
    expect(prompt).toContain("You are not starting or reimplementing the original task");
    expect(prompt).toContain("- PR: #1 (https://github.com/test/pr/1)");
    expect(prompt).toContain("- Original task: T01 - Original feature");
    expect(prompt).toContain("## Failed CI Details");
    expect(prompt).toContain("### Failed Run 1: Main CI");
    expect(prompt).toContain("- Run ID: 123");
    expect(prompt).toContain("- Run URL: https://github.com/test/actions/runs/123");
    expect(prompt).toContain("1. Lint Job");
    expect(prompt).toContain("- Job ID: 456");
    expect(prompt).toContain("- Failed steps: Run lint");
    expect(prompt).toContain("- Log command: gh run view 123 --job 456 --log-failed");
    expect(prompt).toContain("## PROJECT CONTEXT FROM MEMORY");
    expect(prompt).toContain("lint, test");
    expect(prompt).toContain("Lint Job");
    expect(prompt).toContain("Error: lint failed");
    expect(prompt).toContain("## Original Task Context (Reference Only)");
    expect(prompt).toContain("Do the task");
    expect(prompt).toContain("Record durable CI learnings in .task-learnings.md");
    expect(prompt).toContain("Fix CI");
    expect(prompt).toContain("Workspace guidance context");
  });

  it("buildCiFixPrompt excludes historical runs from persisted repair attention", async () => {
    const { virtualWorkerService } = await setupService();

    const prompt = (virtualWorkerService as any).buildCiFixPrompt(
      {
        summaryMarkdown: "Fix CI",
        payload: {
          failedJobLabels: ["Old Job", "Newest Linux", "Newest Windows"],
          failedLogSnippets: ["old assertion", "new linux assertion", "new windows error"],
          failedRuns: [
            {
              id: 10,
              name: "CI",
              workflowName: "CI",
              status: "completed",
              conclusion: "failure",
              event: "push",
              headBranch: "fix/branch",
              url: "https://github.com/test/actions/runs/10",
              updatedAt: "2026-06-13T14:00:00Z",
              failedJobs: [{ id: 100, name: "Old Job", conclusion: "failure", failedSteps: ["test"], logExcerpt: "old assertion", logCommand: "old log" }],
            },
            {
              id: 11,
              name: "CI",
              workflowName: "CI",
              status: "completed",
              conclusion: "failure",
              event: "pull_request",
              headBranch: "fix/branch",
              url: "https://github.com/test/actions/runs/11",
              updatedAt: "2026-06-13T15:00:00Z",
              failedJobs: [
                { id: 110, name: "Newest Linux", conclusion: "failure", failedSteps: ["test"], logExcerpt: "new linux assertion", logCommand: "new linux log" },
                { id: 111, name: "Newest Windows", conclusion: "failure", failedSteps: ["build"], logExcerpt: "new windows error", logCommand: "new windows log" },
              ],
            },
          ],
        },
      },
      "fix/branch",
      "Workspace guidance",
    );

    expect(prompt).toContain("### Failed Run 1: CI");
    expect(prompt).toContain("- Run ID: 11");
    expect(prompt).toContain("1. Newest Linux");
    expect(prompt).toContain("2. Newest Windows");
    expect(prompt).toContain("new linux assertion");
    expect(prompt).toContain("new windows error");
    expect(prompt).not.toContain("Run ID: 10");
    expect(prompt).not.toContain("Old Job");
    expect(prompt).not.toContain("old assertion");
  });

  it("buildDispatchSummary formats correctly", async () => {
    const { virtualWorkerService } = await setupService();

    const claim = {
      project: { name: "Project A" },
      sprint: { name: "Sprint 1" },
      task: { taskKey: "T1", title: "Task 1" },
    };
    const session = {
      provider: "codex",
      state: "COMPLETED",
      outputs: [{ pullRequest: { url: "url", workerBranch: "branch" } }]
    };

    const summary = (virtualWorkerService as any).buildDispatchSummary(claim as any, session as any);
    expect(summary).toContain("Project A");
    expect(summary).toContain("Sprint 1");
    expect(summary).toContain("T1 Task 1");
    expect(summary).toContain("virtual");
    expect(summary).toContain("codex");
    expect(summary).toContain("COMPLETED");
    expect(summary).toContain("branch");
    expect(summary).toContain("url");
  });

  it("resolveCiFixAttention completes successfully", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:123",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix it",
      payload: { repoPath: "/test", branchName: "fix/branch" },
    });

    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorktreePath").mockReturnValue("/tmp/wt");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockResolvedValue({ worktreePath: "/tmp/wt" });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("guidance");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((virtualWorkerService as any), "runProviderWithRetry").mockResolvedValue(undefined);
    (virtualWorkerService as any).prService = {
      hasUnpushedCommits: vi.fn().mockResolvedValue(true),
      hasWorkerBranchCommitsAgainstFeature: vi.fn().mockResolvedValue(true),
    };
    const runCommandSpy = vi.spyOn(cliProcessRunner, "runCommandStrict")
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", code: 0 })
      .mockResolvedValueOnce({ ok: true, stdout: "cafebabe\n", stderr: "", code: 0 });

    const execRepo = (virtualWorkerService as any).deps.executionRepository;
    vi.spyOn(execRepo, "createExecutionInvocation").mockReturnValue({ id: "exec-inv-1" });
    vi.spyOn(execRepo, "appendExecutionInvocationMessage").mockReturnValue({});
    vi.spyOn(execRepo, "updateExecutionInvocation").mockReturnValue({});

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");
    
    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("resolved");
    expect(runCommandSpy.mock.calls.some((call) => (
      call[0] === "git"
      && JSON.stringify(call[1]) === JSON.stringify(["push", "-u", "origin", "refs/heads/fix/branch:refs/heads/fix/branch"])
      && call[2] === "/test"
    ))).toBe(true);
  });

  it("escalates CI fix runs that produce no patch and have nothing unpublished", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:no-op-cifix",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix it",
      payload: { repoPath: "/test", branchName: "fix/branch", featureBranch: "feature/base" },
    });

    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorktreePath").mockReturnValue("/tmp/wt");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockResolvedValue({ worktreePath: "/tmp/wt" });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("guidance");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((virtualWorkerService as any), "runProviderWithRetry").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockResolvedValue({
      ok: true,
      stdout: "old-head\n",
      stderr: "",
      code: 0,
    });
    (virtualWorkerService as any).prService = {
      hasUnpushedCommits: vi.fn().mockResolvedValue(false),
      hasWorkerBranchCommitsAgainstFeature: vi.fn().mockResolvedValue(true),
    };

    const execRepo = (virtualWorkerService as any).deps.executionRepository;
    vi.spyOn(execRepo, "createExecutionInvocation").mockReturnValue({ id: "exec-inv-noop" });
    vi.spyOn(execRepo, "appendExecutionInvocationMessage").mockReturnValue({});
    vi.spyOn(execRepo, "updateExecutionInvocation").mockReturnValue({});

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("resolved");
    expect(updatedItem?.payload?.workerOutcome).toBe("needs_human_escalation");
    expect(updatedItem?.summaryMarkdown).toContain("without producing a patch or unpublished branch commits");

    const humanEscalations = projectAttentionService.listActiveProjectItems(project.id)
      .filter((attentionItem) => attentionItem.attentionType === "human_escalation_required");
    expect(humanEscalations).toHaveLength(1);
    expect(humanEscalations[0]?.summaryMarkdown).toContain("refusing to mark the fix as pushed");
  });

  it("requeues a failed CI invocation until the CI-fix guardrail is exhausted", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();
    let count = 0;
    (virtualWorkerService as any).deps.guardrailService = {
      evaluate: vi.fn(() => ({
        allowed: count < 5,
        count,
        cap: 5,
        action: "BLOCK_AND_ESCALATE",
      })),
      record: vi.fn(() => { count += 1; }),
      reset: vi.fn(),
      getCounts: vi.fn(() => ({})),
    };
    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:ci-retry",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix it",
      payload: { repoPath: "/test", branchName: "fix/branch" },
    });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("provider bootstrap failed"));

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    const retried = projectAttentionService.getItem(item.id);
    expect(retried).toMatchObject({
      status: "open",
      assignedWorkerEndpointId: null,
      payload: expect.objectContaining({
        lastVirtualWorkerError: "provider bootstrap failed",
        ciFixRetryCount: 1,
        ciFixRetryCap: 5,
      }),
    });
    expect(projectAttentionService.listActiveProjectItems(project.id)
      .some((attentionItem) => attentionItem.attentionType === "human_escalation_required")).toBe(false);
  });

  it("creates a human handoff when a failed CI invocation reaches the guardrail", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();
    let count = 4;
    (virtualWorkerService as any).deps.guardrailService = {
      evaluate: vi.fn(() => ({
        allowed: count < 5,
        count,
        cap: 5,
        action: "BLOCK_AND_ESCALATE",
      })),
      record: vi.fn(() => { count += 1; }),
      reset: vi.fn(),
      getCounts: vi.fn(() => ({})),
    };
    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:ci-handoff",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix it",
      payload: { repoPath: "/test", branchName: "fix/branch" },
    });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("fifth attempt failed"));

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(projectAttentionService.getItem(item.id)?.status).toBe("resolved");
    const handoffs = projectAttentionService.listActiveProjectItems(project.id)
      .filter((attentionItem) => attentionItem.attentionType === "human_escalation_required");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.summaryMarkdown).toContain("Attempts: 5/5");
    expect(handoffs[0]?.summaryMarkdown).toContain("fifth attempt failed");
  });

  it("reuses an existing task workspace for CI autofix when the branch already has a CLI session", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, sessionTracking } = await setupServiceWithProject();

    sessionTracking.createSession({
      id: "cli-codex-existing",
      provider: "codex",
      state: "COMPLETED",
      repoPath: "/test",
      workerBranch: "fix/branch",
      featureBranch: "main",
    });

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:reuse",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix it",
      payload: { repoPath: "/test", branchName: "fix/branch" },
    });

    const buildWorkspaceRef = vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorkspaceRef")
      .mockReturnValue("/tmp/reused-worktree");
    const prepareWorktree = vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree")
      .mockResolvedValue({ worktreePath: "/tmp/reused-worktree", resumed: true });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("guidance");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((virtualWorkerService as any), "runProviderWithRetry").mockResolvedValue(undefined);

    const execRepo = (virtualWorkerService as any).deps.executionRepository;
    vi.spyOn(execRepo, "createExecutionInvocation").mockReturnValue({ id: "exec-inv-reuse" });
    vi.spyOn(execRepo, "appendExecutionInvocationMessage").mockReturnValue({});
    vi.spyOn(execRepo, "updateExecutionInvocation").mockReturnValue({});

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(buildWorkspaceRef).toHaveBeenCalledWith("/test", "cli-codex-existing", expect.anything());
    expect(prepareWorktree).toHaveBeenCalledWith(
      "/test",
      "/tmp/reused-worktree",
      "fix/branch",
      "fix/branch",
      "cli-codex-existing",
      expect.anything(),
      { remoteOnly: true },
    );
  });

  it("defaults task-scoped CI fixes to the coding session, provider, and model", async () => {
    const {
      virtualWorkerService,
      projectAttentionService,
      project,
      projectManagementRepository,
      executionRepository,
      sessionTracking,
    } = await setupServiceWithProject();
    const sprint = projectManagementRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T-CI",
      title: "Task CI continuation",
      promptMarkdown: "Implement the task",
      status: "coding_completed",
      isIndependent: true,
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      provider: "codex",
      state: "COMPLETED",
      sessionId: "cli-codex-task-session",
      sessionName: "sessions/cli-codex-task-session",
      workerBranch: "fix/task-ci",
    });
    executionRepository.appendTaskRunEvent(taskRun.id, "cli_workspace_bound", "system", {
      workspaceSessionId: "cli-codex-workspace-session",
      worktreePath: "docker-volume://cli-codex-workspace-session",
      executionMode: "DOCKER",
    });
    sessionTracking.createSession({
      id: "cli-codex-task-session",
      provider: "codex",
      state: "COMPLETED",
      repoPath: "/test",
      workerBranch: "fix/task-ci",
      featureBranch: "main",
    });
    executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      sessionId: "cli-codex-task-session",
      provider: "codex",
      purpose: "task_coding",
      status: "completed",
      model: "gpt-5.6-sol",
      nativeSessionId: "native-codex-task-session",
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix CI",
      payload: { repoPath: "/test", branchName: "fix/task-ci" },
    });

    const settings = (virtualWorkerService as any).resolveDashboardSettings(project.id, sprint.id);
    const continuation = await (virtualWorkerService as any).resolveTaskCiFixContinuation(item, settings);

    expect(continuation).toMatchObject({
      provider: "codex",
      sessionId: "cli-codex-task-session",
      resumeSessionId: "cli-codex-workspace-session",
      continueSessionId: "native-codex-task-session",
      taskRunId: taskRun.id,
      providerSettings: { model: "gpt-5.6-sol" },
    });
  });

  it("uses the explicit CI Fix route when same-session continuation is disabled", async () => {
    const { virtualWorkerService, projectAttentionService, project, projectManagementRepository, settingsRepository } = await setupServiceWithProject();
    const sprint = projectManagementRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T-ROUTED-CI",
      title: "Routed CI fix",
      promptMarkdown: "Implement the task",
      status: "coding_completed",
      isIndependent: true,
    });
    settingsRepository.saveProjectSettings(project.id, {
      aiProvider: {
        invocationRouting: {
          ci_fix: { continueTaskSession: false },
        },
      },
    } as any);
    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "ci_fix_required",
      severity: "high",
      ownerType: "worker",
      title: "CI Fix",
      summaryMarkdown: "Fix CI",
      payload: { repoPath: "/test", branchName: "fix/task-ci" },
    });

    const settings = (virtualWorkerService as any).resolveDashboardSettings(project.id, sprint.id);
    await expect((virtualWorkerService as any).resolveTaskCiFixContinuation(item, settings)).resolves.toBeNull();
  });

  it("falls back to HOST mode for CI autofix when docker is unavailable", async () => {
    const { virtualWorkerService } = await setupService();

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(false);

    await expect((virtualWorkerService as any).resolveVirtualWorkerWorkflowSettings({
      workflowSettings: {
        ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
        executionMode: "DOCKER",
      },
      sessionId: "sess-1",
      repoPath: "/test",
      purpose: "ci_fix",
    })).resolves.toEqual(expect.objectContaining({ executionMode: "HOST" }));
  });

  it("keeps merge conflict resolution Docker-only when docker is unavailable", async () => {
    const { virtualWorkerService } = await setupService();

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(false);

    await expect((virtualWorkerService as any).resolveVirtualWorkerWorkflowSettings({
      workflowSettings: {
        ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
        executionMode: "DOCKER",
      },
      sessionId: "sess-1",
      repoPath: "/test",
      purpose: "merge_conflict",
    })).rejects.toThrow("Docker is unavailable");
  });

  it("resolveMergeConflictAttention covers execution path", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, projectManagementRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:456",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const sprint = projectManagementRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task conflict",
      promptMarkdown: "Resolve task merge conflict.",
      status: "coding_completed",
      isIndependent: true,
      isMerged: false,
      mergeIndicator: "MERGE_CONFLICT",
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorktreePath").mockReturnValue("/tmp/wt");
    const prepareWorktree = vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree")
      .mockResolvedValue({ worktreePath: "/tmp/wt" });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("guidance");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("diff --git a/file.txt b/file.txt");
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "applyPatchToBranch")
      .mockResolvedValue({ hasChanges: true, commitSha: "merge-fix-sha" });
    vi.spyOn((virtualWorkerService as any), "runProviderWithRetry").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockResolvedValue({
      ok: true,
      stdout: "initial-head\n",
      stderr: "",
      code: 0,
    });

    const execRepo = (virtualWorkerService as any).deps.executionRepository;
    vi.spyOn(execRepo, "createExecutionInvocation").mockReturnValue({ id: "exec-inv-2" });
    vi.spyOn(execRepo, "appendExecutionInvocationMessage").mockReturnValue({});
    vi.spyOn(execRepo, "updateExecutionInvocation").mockReturnValue({});

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    vi.spyOn((virtualWorkerService as any), "runMergeIntoSource").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "ensureMergeConflictResolved").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "finalizeMergeCommit").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "ensureTargetMergedIntoSource").mockResolvedValue(undefined);

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(prepareWorktree).toHaveBeenCalledWith(
      "/test",
      "/tmp/wt",
      "src",
      "tgt",
      undefined,
      expect.anything(),
      { remoteOnly: true },
    );
    expect(projectManagementRepository.getTask(task.id)?.mergeIndicator).toBeNull();
    expect(projectManagementRepository.getTask(task.id)?.isMerged).toBe(false);
  });

  it("keeps merge-conflict attention open when the worker records no merge evidence", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:no-merge-evidence",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorktreePath").mockReturnValue("/tmp/wt");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockResolvedValue({ worktreePath: "/tmp/wt" });
    vi.spyOn((virtualWorkerService as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("guidance");
    vi.spyOn((virtualWorkerService as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((virtualWorkerService as any).workspaceArtifactService, "applyPatchToBranch")
      .mockResolvedValue({ hasChanges: false });
    vi.spyOn((virtualWorkerService as any), "runProviderWithRetry").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockResolvedValue({
      ok: true,
      stdout: "initial-head\n",
      stderr: "",
      code: 0,
    });
    (virtualWorkerService as any).prService = {
      hasUnpushedCommits: vi.fn().mockResolvedValue(false),
      hasWorkerBranchCommitsAgainstFeature: vi.fn().mockResolvedValue(false),
    };

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    vi.spyOn((virtualWorkerService as any), "runMergeIntoSource").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "ensureMergeConflictResolved").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "finalizeMergeCommit").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "ensureTargetMergedIntoSource").mockResolvedValue(undefined);

    await (virtualWorkerService as any).resolveMergeConflictAttention(endpoint.id, item);

    const updated = projectAttentionService.getItem(item.id);
    expect(updated?.status).toBe("open");
    expect(updated?.payload?.lastVirtualWorkerError).toContain("without recording merge evidence");
    expect(projectAttentionService.listActiveProjectItems(project.id)
      .some((attentionItem) => attentionItem.attentionType === "human_escalation_required")).toBe(false);
  });

  it("records the merge-conflict guardrail attempt even when the resolution fails", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, projectManagementRepository } = await setupServiceWithProject();

    const record = vi.fn();
    (virtualWorkerService as any).deps.guardrailService = {
      record,
      evaluate: vi.fn(() => ({ allowed: true, count: 0, cap: 3, action: "BLOCK_AND_ESCALATE" })),
      reset: vi.fn(),
      getCounts: vi.fn(() => ({})),
    };

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:gr-fail",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task conflict",
      promptMarkdown: "Resolve task merge conflict.",
      isIndependent: true,
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    // Fail the attempt *after* it has been counted, exercising the catch/escalate path.
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("boom"));

    await (virtualWorkerService as any).resolveMergeConflictAttention(endpoint.id, item);

    // A failed attempt still consumes the retry budget, but it remains worker-owned
    // until the configured cap is exhausted.
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.any(String), "merge_conflict");
    const updated = projectAttentionService.getItem(item.id);
    expect(updated?.status).toBe("open");
    expect(updated?.payload?.lastVirtualWorkerError).toBe("boom");
    const active = projectAttentionService.listActiveProjectItems(project.id);
    expect(active.some((i) => i.attentionType === "human_escalation_required")).toBe(false);
  });

  it("tracks taskless main-merge conflict attempts on the attention payload without guardrail FK errors", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, settingsRepository, dir } = await setupServiceWithProject();

    settingsRepository.saveProjectSettings(project.id, {
      guardrails: {
        enabled: true,
        perTaskTotalCeiling: 0,
        jobs: {
          ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs,
          merge_conflict: { cap: 3, onLimit: "BLOCK_AND_ESCALATE" },
        },
      },
    });
    (virtualWorkerService as any).deps.guardrailService = new GuardrailService(
      new GuardrailRepository(new AppDbStorage(path.join(dir, "app.db"))),
      (scope) => settingsRepository.resolveProjectDashboardSettings(scope.projectId).settings.guardrails,
    );

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:main-merge-gr",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Main merge conflict",
      summaryMarkdown: "Resolve final feature to main conflict",
      payload: { repoPath: "/test", conflictingBranches: { source: "feature/sprint-1", target: "main" } },
    });

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("boom"));

    await expect((virtualWorkerService as any).resolveMergeConflictAttention(endpoint.id, item)).resolves.toBeUndefined();

    const updated = projectAttentionService.getItem(item.id);
    expect(updated?.status).toBe("open");
    expect(updated?.payload?.mergeConflictResolutionAttempts).toBe(1);
    expect(updated?.payload?.mergeConflictGuardrailSubject).toBe(`attention:${item.id}`);
    expect(updated?.payload?.lastVirtualWorkerError).toBe("boom");
    const active = projectAttentionService.listActiveProjectItems(project.id);
    expect(active.some((i) => i.attentionType === "human_escalation_required")).toBe(false);
  });

  it("escalates without running a provider once the merge-conflict guardrail cap is reached", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const record = vi.fn();
    (virtualWorkerService as any).deps.guardrailService = {
      record,
      evaluate: vi.fn(() => ({ allowed: false, count: 3, cap: 3, action: "BLOCK_AND_ESCALATE" })),
      reset: vi.fn(),
      getCounts: vi.fn(() => ({})),
    };

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:gr-cap",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: {
        repoPath: "/test",
        conflictingBranches: { source: "src", target: "tgt" },
        mergeConflictResolutionAttempts: 3,
      },
    });

    const prepareWorktree = vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree")
      .mockResolvedValue({ worktreePath: "/tmp/wt" });

    await (virtualWorkerService as any).resolveMergeConflictAttention(endpoint.id, item);

    // Cap reached -> no provider work and no new attempt recorded; escalate to a human.
    expect(prepareWorktree).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    const active = projectAttentionService.listActiveProjectItems(project.id);
    expect(active.some((i) => i.attentionType === "human_escalation_required")).toBe(true);
  });

  it("skips a redundant container run when the conflict is already resolved on the remote", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, projectManagementRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:already-resolved",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const sprint = projectManagementRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Already resolved conflict",
      promptMarkdown: "Resolve task merge conflict.",
      status: "coding_completed",
      isIndependent: true,
      isMerged: false,
      mergeIndicator: "MERGE_CONFLICT",
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    (virtualWorkerService as any).deps.guardrailService = {
      evaluate: vi.fn(() => ({ allowed: false, count: 5, cap: 5, action: "BLOCK_AND_ESCALATE" })),
      record: vi.fn(),
      reset: vi.fn(),
      getCounts: vi.fn(() => ({})),
    };
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(true);
    const prepareWorktree = vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree");

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(prepareWorktree).not.toHaveBeenCalled();
    const resolved = projectAttentionService.getItem(item.id);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.payload?.alreadyResolved).toBe(true);
    expect(projectManagementRepository.getTask(task.id)?.mergeIndicator).toBeNull();
    expect(projectManagementRepository.getTask(task.id)?.isMerged).toBe(false);
    expect(projectAttentionService.listActiveProjectItems(project.id)
      .some((attentionItem) => attentionItem.attentionType === "human_escalation_required")).toBe(false);
  });

  it("does not clear a merge conflict when the worker branch is still ahead of the target", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, projectManagementRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:still-ahead",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const sprint = projectManagementRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Still ahead conflict",
      promptMarkdown: "Resolve task merge conflict.",
      status: "coding_completed",
      isIndependent: true,
      isMerged: false,
      mergeIndicator: "MERGE_CONFLICT",
    });
    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: null,
      dispatchId: null,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    const prepareWorktree = vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree")
      .mockRejectedValue(new Error("stop after non-redundant path"));

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(prepareWorktree).toHaveBeenCalled();
    expect(projectManagementRepository.getTask(task.id)?.mergeIndicator).toBe("MERGE_CONFLICT");
    expect(projectManagementRepository.getTask(task.id)?.isMerged).toBe(false);
    expect(projectAttentionService.getItem(item.id)?.payload?.alreadyResolved).not.toBe(true);
  });

  it("routes merge preparation through the workspace runner for docker-volume workspaces", async () => {
    const { virtualWorkerService, sessionTracking } = await setupServiceWithProject();

    const runWorkspaceCommand = vi.spyOn((virtualWorkerService as any).workspaceManager, "runWorkspaceCommand")
      .mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0 } as any);
    const activitySpy = vi.spyOn(sessionTracking, "appendActivity");

    const hasConflicts = await (virtualWorkerService as any).runMergeIntoSource(
      "docker-volume://merge-workspace",
      "origin/main",
      "session-1",
    );

    expect(hasConflicts).toBe(false);
    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "docker-volume://merge-workspace",
      "git",
      ["merge", "--no-ff", "--no-commit", "origin/main"],
    );
    expect(activitySpy).toHaveBeenCalledWith("session-1", expect.objectContaining({
      originator: "system",
      description: "Prepared merge of origin/main into the source branch without conflicts.",
    }));
  });

  it("merges the local target ref (no origin/) in LOCAL git mode", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const runWorkspaceCommand = vi.spyOn((virtualWorkerService as any).workspaceManager, "runWorkspaceCommand")
      .mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0 } as any);

    // LOCAL mode passes the bare local branch as the merge ref — the seeded merge
    // workspace has no `origin` remote, so `origin/<branch>` would not be mergeable.
    await (virtualWorkerService as any).runMergeIntoSource(
      "docker-volume://merge-workspace",
      "feature/CODUX-15-qs-dag-merge-conflict-4",
      "session-1",
    );

    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "docker-volume://merge-workspace",
      "git",
      ["merge", "--no-ff", "--no-commit", "feature/CODUX-15-qs-dag-merge-conflict-4"],
    );
  });

  it("rejects merge conflict resolution when the target branch is not in HEAD", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const runWorkspaceCommand = vi.spyOn((virtualWorkerService as any).workspaceManager, "runWorkspaceCommand")
      .mockRejectedValue(new Error("not ancestor"));

    await expect((virtualWorkerService as any).ensureTargetMergedIntoSource(
      "docker-volume://merge-workspace",
      "origin/main",
    )).rejects.toThrow("origin/main is not contained");

    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "docker-volume://merge-workspace",
      "git",
      ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
    );
  });

  it("verifies against the local target ref in LOCAL git mode", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const runWorkspaceCommand = vi.spyOn((virtualWorkerService as any).workspaceManager, "runWorkspaceCommand")
      .mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0 } as any);

    await (virtualWorkerService as any).ensureTargetMergedIntoSource(
      "docker-volume://merge-workspace",
      "feature/CODUX-15-qs-dag-merge-conflict-4",
    );

    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "docker-volume://merge-workspace",
      "git",
      ["merge-base", "--is-ancestor", "feature/CODUX-15-qs-dag-merge-conflict-4", "HEAD"],
    );
  });

  it("ensureMergeConflictResolved stages agent edits that were left unstaged", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const calls: string[][] = [];
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "diff" && args.includes("--diff-filter=U")) {
          // Index still records unmerged entries because the agent never staged.
          return { ok: true, stdout: "dashboard/foo.tsx\n", stderr: "", code: 0 } as any;
        }
        if (args[0] === "grep") {
          // No matches -> git grep exits non-zero, surfaced as a throw.
          throw new Error("exit 1");
        }
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).ensureMergeConflictResolved("/wt")).resolves.toBeUndefined();
    // The resolution must be staged so the merge can be committed downstream.
    expect(calls).toContainEqual(["add", "-A", "--", ".", ":(exclude).code-ux"]);
  });

  it("ensureMergeConflictResolved throws only when conflict markers survive", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        if (args[0] === "diff" && args.includes("--diff-filter=U")) {
          return { ok: true, stdout: "dashboard/foo.tsx\n", stderr: "", code: 0 } as any;
        }
        if (args[0] === "grep") {
          // git grep found a surviving conflict marker.
          return { ok: true, stdout: "dashboard/foo.tsx\n", stderr: "", code: 0 } as any;
        }
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).ensureMergeConflictResolved("/wt"))
      .rejects.toThrow("Unresolved merge conflicts remain: dashboard/foo.tsx");
  });

  it("runMergeIntoSource resolves Code UX runtime conflicts to the target side without invoking a provider", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const calls: string[][] = [];
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "merge") {
          throw new Error("merge conflict");
        }
        if (args[0] === "diff" && args.includes("--diff-filter=U")) {
          return { ok: true, stdout: ".code-ux/mockup.log\n", stderr: "", code: 0 } as any;
        }
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).runMergeIntoSource(
      "/wt",
      "feature/sprint",
      "session-1",
    )).resolves.toBe(false);

    expect(calls).toContainEqual(["checkout", "--theirs", "--", ".code-ux"]);
    expect(calls).toContainEqual(["add", "-A", "--", ".code-ux"]);
  });

  it("ensureMergeConflictResolved is a no-op when nothing is unmerged", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const calls: string[][] = [];
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        calls.push(args);
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).ensureMergeConflictResolved("/wt")).resolves.toBeUndefined();
    expect(calls).not.toContainEqual(["add", "-A"]);
  });

  it("ensureMergeConflictResolved falls back to git status when diff cannot list unresolved files", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const calls: string[][] = [];
    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "diff" && args.includes("--diff-filter=U")) {
          throw new Error("git diff usage failed");
        }
        if (args[0] === "status") {
          return { ok: true, stdout: "UU README.md\0M  src/clean.ts\0", stderr: "", code: 0 } as any;
        }
        if (args[0] === "grep") {
          throw new Error("exit 1");
        }
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).ensureMergeConflictResolved("/wt")).resolves.toBeUndefined();
    expect(calls).toContainEqual(["status", "--porcelain", "-z"]);
    expect(calls).toContainEqual(["grep", "--cached", "-l", "-E", "^(<{7}|>{7})( |$)", "--", "README.md"]);
  });

  it("rejects merge conflict resolutions that mutate required timestamp marker literals", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        if (args[0] === "grep") {
          return {
            ok: true,
            stdout: "monitoring/dag-conflict-shared/ledger.md:3:dag-conflict-2026-07-03T16:28-17-794Z-B T02 completed 2026-07-03T17:25:33Z\n",
            stderr: "",
            code: 0,
          } as any;
        }
        if (args[0] === "ls-files") {
          return {
            ok: true,
            stdout: "monitoring/dag-conflict-b-2026-07-03T16:28-17-794Z/beta.md\n",
            stderr: "",
            code: 0,
          } as any;
        }
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).ensureMergeConflictPreservesPromptLiterals("/wt", {
      summaryMarkdown: "",
      payload: {
        currentTask: {
          taskPrompt: "Use marker `dag-conflict-2026-07-03T16-28-17-794Z-B`.",
        },
      },
    })).rejects.toThrow("mutated required prompt timestamp literals");
  });

  it("allows merge conflict resolutions that preserve required timestamp marker literals", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    vi.spyOn((virtualWorkerService as any), "runWorkspaceCommand").mockImplementation(
      async (_path: string, _cmd: string, args: string[]) => {
        if (args[0] === "grep") {
          throw new Error("exit 1");
        }
        if (args[0] === "ls-files") {
          return {
            ok: true,
            stdout: "monitoring/dag-conflict-b-2026-07-03T16-28-17-794Z/beta.md\n",
            stderr: "",
            code: 0,
          } as any;
        }
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      },
    );

    await expect((virtualWorkerService as any).ensureMergeConflictPreservesPromptLiterals("/wt", {
      summaryMarkdown: "",
      payload: {
        currentTask: {
          taskPrompt: "Use marker `dag-conflict-2026-07-03T16-28-17-794Z-B`.",
        },
      },
    })).resolves.toBeUndefined();
  });

  it("keeps merge conflict attention retryable when provider execution fails before the cap is exhausted", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:999",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("Provider failed"));

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("open");
    expect(updatedItem?.assignedWorkerEndpointId).toBeNull();
    expect(updatedItem?.payload?.lastVirtualWorkerError).toBe("Provider failed");
    expect(updatedItem?.payload?.mergeConflictRetryCount).toBe(1);

    const activeItems = projectAttentionService.listActiveProjectItems(project.id);
    expect(activeItems.some(i => i.attentionType === "human_escalation_required")).toBe(false);
  });

  it("escalates to human when provider execution fails after the merge conflict cap is exhausted", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:999-cap",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: {
        repoPath: "/test",
        conflictingBranches: { source: "src", target: "tgt" },
        mergeConflictResolutionAttempts: 2,
      },
    });

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("Provider failed"));

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("resolved");

    const activeItems = projectAttentionService.listActiveProjectItems(project.id);
    expect(activeItems.some(i => i.attentionType === "human_escalation_required")).toBe(true);
  });

  it("keeps merge conflict attention retryable when provider execution is cancelled by shutdown", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, sessionTracking } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:cancelled-merge",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge Conflict",
      summaryMarkdown: "Resolve it",
      payload: { repoPath: "/test", conflictingBranches: { source: "src", target: "tgt" } },
    });

    vi.spyOn((virtualWorkerService as any).dockerService, "isAvailable").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(false);
    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree")
      .mockRejectedValue(new Error("Command spawner host exited (code=null, signal=SIGHUP)"));
    vi.spyOn((virtualWorkerService as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("claimed");
    expect(updatedItem?.payload?.workerOutcome).toBeUndefined();

    const activeItems = projectAttentionService.listActiveProjectItems(project.id);
    expect(activeItems.some(i => i.attentionType === "human_escalation_required")).toBe(false);

    const sessions = sessionTracking.listSessions(10).sessions;
    expect(sessions.find(session => session.id.startsWith("virtual-merge-codex-"))?.state).toBe("CANCELLED");
  });

  it("resolveActionRequiredAttention covers auto-approve plan path", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, settingsRepository } = await setupServiceWithProject();

    settingsRepository.saveProjectSettings(project.id, {
      automationInterventions: {
        autoApprovePlan: true,
      },
    });

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:789",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "action_required",
      severity: "medium",
      ownerType: "worker",
      title: "Action Required",
      summaryMarkdown: "Awaiting plan approval",
      payload: { sessionId: "sess-1", sessionState: "AWAITING_PLAN_APPROVAL" },
    });

    const approveSpy = vi.spyOn((virtualWorkerService as any).deps, "approveSessionPlan").mockResolvedValue(undefined);

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(approveSpy).toHaveBeenCalledWith("sess-1");
    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("resolved");
    expect(updatedItem?.payload?.resolutionReason).toBe("virtual_worker_auto_approved_plan");
  });

  it("resolveActionRequiredAttention covers auto-answer clarification path", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository, settingsRepository, projectManagementRepository } = await setupServiceWithProject();

    settingsRepository.saveProjectSettings(project.id, {
      automationInterventions: {
        autoAnswerClarification: true,
      },
    });

    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
      goal: "Test Goal",
    });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      id: "TASK-1",
      title: "Test Task",
    });

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:012",
      displayName: "Virtual Worker",
      status: "connected",
      transport: "internal",
      capabilities: {},
    });

    const item = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "action_required",
      severity: "medium",
      ownerType: "worker",
      title: "Action Required",
      summaryMarkdown: "Awaiting user feedback",
      payload: { sessionId: "sess-2", sessionState: "AWAITING_USER_FEEDBACK" },
    });

    vi.spyOn((virtualWorkerService as any).deps.sprintExecutionStateService, "loadSubtasks").mockResolvedValue([]);
    const replySpy = vi.spyOn((virtualWorkerService as any).deps.workerInboxReplyService, "generateClarificationReply").mockResolvedValue("Test Reply");
    const sendSpy = vi.spyOn((virtualWorkerService as any).deps, "sendSessionMessage").mockResolvedValue(undefined);

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(replySpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith("sess-2", "Test Reply");
    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("resolved");
    expect(updatedItem?.payload?.resolutionReason).toBe("virtual_worker_auto_answered_clarification");
  });

  async function setupService() {
    const deps = await createFixture();
    const virtualWorkerService = new VirtualWorkerService({
      ...deps,
      projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
        deps.projectWorkerAssignmentRepository,
        deps.workerEndpointRepository,
      ),
      cliWorkflowService: { startTask: vi.fn() } as any,
      sprintExecutionStateService: { loadSubtasks: vi.fn() } as any,
      workerInboxReplyService: { generateClarificationReply: vi.fn() } as any,
      instructionService: {} as any,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
      providerConcurrencyService: {
        hasAvailableCapacity: vi.fn().mockResolvedValue(true),
      } as any,
    });
    return { ...deps, virtualWorkerService };
  }

  async function setupServiceWithProject() {
    const res = await setupService();
    const project = res.projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    res.settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "codex" }
    });
    return { ...res, project };
  }
});
