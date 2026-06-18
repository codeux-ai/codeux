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
    });

    // Mock resolveEffectiveDashboardSettings by spying on settingsRepository
    const settingsSpy = vi.spyOn(settingsRepository, "getProjectSettings");

    await virtualWorkerService.reconcile();

    // The first resolution gets cached, the subsequent ones hit the cache
    // 2 times: once for resolveDashboardSettings(projectId) and once for resolveDashboardSettings(projectId, sprintId)
    // because sprintId ?? "" resolves to different keys.
    expect(settingsSpy).toHaveBeenCalledTimes(2);
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
    });
    const scheduleSpy = vi.spyOn(virtualWorkerService, "scheduleProject");

    await virtualWorkerService.reconcile();

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
      "## PROJECT CONTEXT FROM MEMORY\n- [patterns] Prefer preserving both branch intents.",
      "Record durable merge learnings in .task-learnings.md",
    );

    expect(prompt).toContain("Preserve the current task change.");
    expect(prompt).toContain("T01 Earlier merge");
    expect(prompt).toContain("Keep the earlier merged edit.");
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
    expect(prepareWorktree).toHaveBeenCalledWith("/test", "/tmp/reused-worktree", "fix/branch", "fix/branch", "cli-codex-existing", expect.anything());
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
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:456",
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

    vi.spyOn((virtualWorkerService as any), "runMergeIntoSource").mockResolvedValue(true);
    vi.spyOn((virtualWorkerService as any), "ensureMergeConflictResolved").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "finalizeMergeCommit").mockResolvedValue(undefined);
    vi.spyOn((virtualWorkerService as any), "ensureTargetMergedIntoSource").mockResolvedValue(undefined);

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");
  });

  it("skips a redundant container run when the conflict is already resolved on the remote", async () => {
    const { virtualWorkerService, projectAttentionService, project, workerEndpointRepository } = await setupServiceWithProject();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:already-resolved",
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

    vi.spyOn((virtualWorkerService as any), "isMergeConflictResolvedOnRemote").mockResolvedValue(true);
    const prepareWorktree = vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree");

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    expect(prepareWorktree).not.toHaveBeenCalled();
    const resolved = projectAttentionService.getItem(item.id);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.payload?.alreadyResolved).toBe(true);
  });

  it("routes merge preparation through the workspace runner for docker-volume workspaces", async () => {
    const { virtualWorkerService, sessionTracking } = await setupServiceWithProject();

    const runWorkspaceCommand = vi.spyOn((virtualWorkerService as any).workspaceManager, "runWorkspaceCommand")
      .mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0 } as any);
    const activitySpy = vi.spyOn(sessionTracking, "appendActivity");

    const hasConflicts = await (virtualWorkerService as any).runMergeIntoSource(
      "docker-volume://merge-workspace",
      "main",
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

  it("rejects merge conflict resolution when the target branch is not in HEAD", async () => {
    const { virtualWorkerService } = await setupServiceWithProject();

    const runWorkspaceCommand = vi.spyOn((virtualWorkerService as any).workspaceManager, "runWorkspaceCommand")
      .mockRejectedValue(new Error("not ancestor"));

    await expect((virtualWorkerService as any).ensureTargetMergedIntoSource(
      "docker-volume://merge-workspace",
      "main",
    )).rejects.toThrow("origin/main is not contained");

    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "docker-volume://merge-workspace",
      "git",
      ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
    );
  });

  it("escalates to human when provider execution fails during handleAttentionItem", async () => {
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

    vi.spyOn((virtualWorkerService as any).workspaceManager, "prepareWorktree").mockRejectedValue(new Error("Provider failed"));

    await (virtualWorkerService as any).handleAttentionItem(endpoint.id, item, "test");

    const updatedItem = projectAttentionService.getItem(item.id);
    expect(updatedItem?.status).toBe("resolved"); // The original item is resolved because it's escalated

    const activeItems = projectAttentionService.listActiveProjectItems(project.id);
    expect(activeItems.some(i => i.attentionType === "human_escalation_required")).toBe(true);
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
