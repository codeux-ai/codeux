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
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectWorkerAssignmentService } from "../../../src/domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { WorkerTaskDispatchService } from "../../../src/services/worker-task-dispatch-service.js";
import { VirtualWorkerService } from "../../../src/services/virtual-worker-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-virtual-worker-"));
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
    (projectId, sprintId) => (
      sprintId
        ? settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode
        : settingsRepository.resolveProjectDashboardSettings(projectId).settings.workers.executionMode
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
    (projectId, sprintId) => (
      sprintId
        ? settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode
        : settingsRepository.resolveProjectDashboardSettings(projectId).settings.workers.executionMode
    ),
  );

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

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("VirtualWorkerService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
      summaryMarkdown: "Should stay on MCP workers.",
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
    });
    const scheduleSpy = vi.spyOn(virtualWorkerService, "scheduleProject");

    await virtualWorkerService.reconcile();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(virtualProject.id, "reconcile");
  });

  it("claims queued virtual worker dispatches and cleans up its ephemeral endpoint", async () => {
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
      name: "Virtual Worker Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-worker-project",
      defaultBranch: "main",
    });
    const sprint = projectManagementRepository.createSprint(project.id, {
      name: "Virtual Worker Sprint",
      number: 12,
      featureBranch: "feature/sprint-12",
    });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Execute through virtual worker",
      promptMarkdown: "Handle this task with the virtual worker.",
      executorType: "mcp_worker",
      priority: "high",
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
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-15T10:00:00.000Z",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    const cliWorkflowService = {
      startTask: vi.fn().mockImplementation(async (args: { provider: string }) => {
        const session = sessionTracking.createSession({
          id: "cli-codex-virtual-worker",
          provider: "codex",
          taskId: task.id,
          title: "Virtual worker session",
          prompt: "virtual worker task",
          state: "RUNNING",
          featureBranch: sprint.featureBranch || "feature/sprint-12",
          workerBranch: "task/virtual-worker-branch",
          repoPath: project.baseDir,
        });

        setTimeout(() => {
          sessionTracking.updateSession(session.id, {
            state: "COMPLETED",
            prUrl: "https://example.com/pr/999",
            workerBranch: "task/virtual-worker-branch",
          });
          executionRepository.updateTaskRun(taskRun.id, {
            state: "COMPLETED",
            sessionId: session.id,
            sessionName: session.name,
            provider: args.provider,
            prUrl: "https://example.com/pr/999",
            workerBranch: "task/virtual-worker-branch",
            finishedAt: "2026-03-15T10:00:05.000Z",
          });
        }, 10);

        return session;
      }),
    };

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
      cliWorkflowService: cliWorkflowService as any,
    });

    virtualWorkerService.scheduleProject(project.id, "test");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(6_000);

    expect(cliWorkflowService.startTask).toHaveBeenCalledTimes(1);
    expect(executionRepository.getTaskDispatch(dispatch.id)?.status).toBe("completed");
    expect(projectManagementRepository.getTask(task.id)?.status).toBe("completed");
    expect(workerEndpointRepository.listWorkerEndpoints().filter((endpoint) => endpoint.endpointType === "virtual_cli")).toHaveLength(0);
    expect(projectWorkerAssignmentRepository.listAssignmentsForProject(project.id, { activeOnly: true })).toHaveLength(0);
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

  it("pickNextWorkerAttention skips merge_required items", async () => {
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
    });

    // Access private method directly — merge_required items must be skipped
    const result = (virtualWorkerService as any).pickNextWorkerAttention(project.id);
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

    const conflictResult = (virtualWorkerService as any).pickNextWorkerAttention(project.id);
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
    });

    // Should return early without scheduling anything
    virtualWorkerService.scheduleProject(project.id, "test");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);

    // No endpoint created, no startTask called
    expect(workerEndpointRepository.listWorkerEndpoints().filter(e => e.endpointType === "virtual_cli")).toHaveLength(0);
  });

  it("projectNeedsVirtualWorker returns true when queued dispatches exist", async () => {
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
      executorType: "mcp_worker",
      priority: "high",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
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
    });

    expect((virtualWorkerService as any).projectNeedsVirtualWorker(project.id)).toBe(true);
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
    });

    virtualWorkerService.start();
    // Calling start again should be a no-op (idempotent)
    virtualWorkerService.start();
    virtualWorkerService.stop();
    // Calling stop again should be safe
    virtualWorkerService.stop();
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
    });

    // Sprint-level settings should resolve to VIRTUAL
    expect((virtualWorkerService as any).resolveWorkerExecutionMode(project.id, sprint.id)).toBe("VIRTUAL");
    // Project-level also VIRTUAL (set above)
    expect((virtualWorkerService as any).resolveWorkerExecutionMode(project.id)).toBe("VIRTUAL");
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
            taskPrompt: "Preserve the current task change.",
          },
          featureBranchTaskContexts: [
            {
              taskKey: "T01",
              taskTitle: "Earlier merge",
              taskPrompt: "Keep the earlier merged edit.",
            },
          ],
        },
        openedAt: "2026-03-15T10:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-15T10:00:00.000Z",
      },
      "task/branch",
      "feature/branch",
      "Workspace guidance",
    );

    expect(prompt).toContain("Preserve the current task change.");
    expect(prompt).toContain("T01 Earlier merge");
    expect(prompt).toContain("Keep the earlier merged edit.");
    expect(prompt).toContain("Workspace guidance");
  });
});
