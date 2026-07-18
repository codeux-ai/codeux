import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../src/repositories/settings-defaults.js";
import { createDashboardDependencies } from "../../../../src/app/dependency-factory/dashboard-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { SprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { ActivityCacheService } from "../../../../src/server/activity-cache-service.js";
import { TaskRerunService } from "../../../../src/services/task-rerun-service.js";
import { WorkspaceManager } from "../../../../src/infrastructure/providers/cli/workspace-manager.js";
import { createLateBoundDependency } from "../../../../src/shared/late-bound-dependency.js";
import { ExecutionControlService } from "../../../../src/services/execution-control-service.js";

const taskRerunMockState = vi.hoisted(() => ({
  instances: [] as Array<{
    rerunTask: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../../../../src/server/activity-cache-service.js", () => {
  const ActivityCacheService = vi.fn();
  ActivityCacheService.prototype.invalidateLiveActivitiesCache = vi.fn();
  return { ActivityCacheService };
});

vi.mock("../../../../src/services/task-rerun-service.js", () => {
  const TaskRerunService = vi.fn().mockImplementation(function TaskRerunServiceMock() {
    const instance = {
      rerunTask: vi.fn().mockResolvedValue({ id: "T1" }),
    };
    taskRerunMockState.instances.push(instance);
    return instance;
  });
  return { TaskRerunService };
});

vi.mock("../../../../src/infrastructure/providers/cli/workspace-manager.js", () => {
  const WorkspaceManager = vi.fn().mockImplementation(function WorkspaceManagerMock() {
    return {
    buildWorktreePath: vi.fn().mockReturnValue("/repo/.worktrees/session-1"),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    };
  });
  return { WorkspaceManager };
});

describe("Dashboard Factory", () => {
  let mockContext: any;
  let mockCoreDeps: any;
  let mockSprintDeps: any;

  beforeEach(() => {
    vi.clearAllMocks();
    taskRerunMockState.instances.length = 0;

    mockContext = {
      runtimeContext: {
        lastStatus: { subtasks: ["mock-subtask"] },
      },
      resolveSessionNameFromTask: vi.fn(),
      fetchRecentActivities: vi.fn(),
      resolveGitStatusRepoPath: vi.fn(),
      fetchGitStatusForRepo: vi.fn(),
      invalidateGitStatusCache: vi.fn(),
      resolveSessionName: vi.fn(),
      extractSessionId: vi.fn(),
    };

    mockCoreDeps = {
      logger: {
        child: vi.fn().mockReturnValue({}),
      },
      projectRuntimeRepository: {
        getSelectedProjectStatus: vi.fn().mockReturnValue({ project_id: "project-1", sprint_id: "sprint-1", sprint_number: 3, feature_branch: "feature/sprint3", repo_path: "/repo", subtasks: ["mock-subtask"] }),
        getSelectedProjectLiveStatus: vi.fn().mockReturnValue({ project_id: "project-1", sprint_id: "sprint-1", sprint_number: 3, feature_branch: "feature/sprint3", repo_path: "/repo", subtasks: ["mock-subtask"] }),
        getProjectStatus: vi.fn().mockReturnValue({ project_id: "project-1", sprint_id: "sprint-1", sprint_number: 3, source_id: "source-1", feature_branch: "feature/sprint3", repo_path: "/repo", subtasks: [{ record_id: "task1", id: "T1", title: "Task", prompt: "Do it", depends_on: [], is_independent: true }] }),
        syncDashboardStatus: vi.fn(),
      },
      projectManagementRepository: {
        getTask: vi.fn().mockReturnValue({ id: "task1", taskKey: "T1", projectId: "project-1", sprintId: "sprint-1" }),
        getSprint: vi.fn().mockReturnValue({ id: "sprint-1", projectId: "project-1", number: 3, featureBranch: "feature/sprint3" }),
        getProject: vi.fn().mockReturnValue({ id: "project-1", baseDir: "/repo" }),
        listTasks: vi.fn().mockReturnValue([
          { id: "task1", dependsOnTaskIds: [] },
          { id: "task2", dependsOnTaskIds: ["task1"] },
        ]),
        updateTask: vi.fn(),
        replaceSprintLinkedIssues: vi.fn(),
        listSprintLinkedIssues: vi.fn(),
      },
      executionRepository: {
        findActiveSprintRun: vi.fn().mockReturnValue({ id: "run-1" }),
        createSprintRun: vi.fn(),
        updateSprintRun: vi.fn(),
        getTaskDispatch: vi.fn().mockReturnValue({
          id: "dispatch-1",
          taskId: "task1",
          projectId: "project-1",
          sprintId: "sprint-1",
          sprintRunId: "run-1",
          status: "failed",
          queuedAt: "2026-03-09T10:00:00.000Z",
          startedAt: "2026-03-09T10:01:00.000Z",
          finishedAt: "2026-03-09T10:02:00.000Z",
        }),
        getLatestTaskRun: vi.fn().mockReturnValue(null),
        getLatestTaskWorkspaceResumeTarget: vi.fn().mockReturnValue(null),
        getLatestTaskRunWithWorkspace: vi.fn().mockReturnValue(null),
        createTaskRun: vi.fn().mockReturnValue({ id: "reset-run-1" }),
        appendTaskRunEvent: vi.fn(),
        getTaskRunByDispatchId: vi.fn().mockReturnValue(null),
      },
      sprintRunLifecycleService: {
        createRun: vi.fn(),
        markRunning: vi.fn(),
      },
      settingsRepository: {
        getDefaultDashboardSettings: vi.fn().mockReturnValue({}),
        resolveProjectDashboardSettings: vi.fn(),
        resolveSprintDashboardSettings: vi.fn().mockReturnValue({
          settings: {
            ...DEFAULT_DASHBOARD_SETTINGS,
            git: {
              ...DEFAULT_DASHBOARD_SETTINGS.git,
              sprintBranchScheme: "feature/sprint{sprint}",
            },
          },
        }),
      },
      projectAttentionService: {
        resolveItemsForDispatch: vi.fn(),
        resolveItemsForTask: vi.fn(),
        resolveItems: vi.fn(),
        resolveItemsForSprintRun: vi.fn(),
      },
      connectionChatRepository: {},
      chatProviderRepository: { id: "chat-provider-repository" },
      chatProviderSecretService: { id: "chat-provider-secret-service" },
      chatProviderVerificationService: { id: "chat-provider-verification-service" },
      chatConnectorRegistry: { id: "chat-connector-registry" },
      headlessAuthService: { configuration: { mode: "local", remoteCredentialManagement: false } },
      projectWorkerAssignmentRepository: {},
      agentPresetSyncService: {},
      activeDispatchRegistry: {
        requestStop: vi.fn().mockResolvedValue(undefined),
      },
      providerRunner: {},
      julesApi: {},
      memoryService: {},
      agentPresetRepository: {
        getAgentPreset: vi.fn(),
      },
      sprintIssueService: {
        searchJiraIssues: vi.fn(),
        closeLinkedIssues: vi.fn(),
      },
      sprintPreviewService: {},
      memoryPromotionService: {},
      embeddingModelManager: {},
      knowledgeService: {},
      sessionTracking: {},
      providerConcurrencyService: {},
      schedulerRepository: {},
      qaReviewRepository: {
        resetTaskReviewRuns: vi.fn(),
      },
      guardrailService: {
        reset: vi.fn(),
      },
    };

    mockSprintDeps = {
      sprintTaskDispatchService: {
        startTask: vi.fn(),
      },
      sprintOrchestrator: {
        setUnplannedSprintPlanner: vi.fn(),
      },
      taskService: {},
    };
  });

  it("should create dashboard dependencies and wire them correctly", () => {
    const result = createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    expect(result.activityCacheService).toBeDefined();
    expect(result.taskRerunService).toBeDefined();
    expect(result.chatProviderRepository).toBe(mockCoreDeps.chatProviderRepository);
    expect(result.chatProviderSecretService).toBe(mockCoreDeps.chatProviderSecretService);
    expect(result.chatProviderVerificationService).toBe(mockCoreDeps.chatProviderVerificationService);
    expect(result.chatConnectorRegistry).toBe(mockCoreDeps.chatConnectorRegistry);
    expect((result.chatProviderIngressService as any).registry).toBe(mockCoreDeps.chatConnectorRegistry);
    expect((result.chatProviderSessionRuntimeService as any).registry).toBe(mockCoreDeps.chatConnectorRegistry);
    expect((result.chatProviderOutboundService as any).adapter.registry).toBe(mockCoreDeps.chatConnectorRegistry);
    const dashboardManagementHandlerDeps = (result.chatThreadRuntimeService as any)
      .deps.chatManagementActionService.deps.managementToolHandler.deps;
    expect(dashboardManagementHandlerDeps.chatProviderRepository).toBe(mockCoreDeps.chatProviderRepository);
    expect(dashboardManagementHandlerDeps.chatProviderSecretService).toBe(mockCoreDeps.chatProviderSecretService);
    expect(dashboardManagementHandlerDeps.chatProviderVerificationService).toBe(mockCoreDeps.chatProviderVerificationService);
    expect(dashboardManagementHandlerDeps.chatProviderOutboundService).toBe(result.chatProviderOutboundService);
    expect(dashboardManagementHandlerDeps.chatConnectorRegistry).toBe(mockCoreDeps.chatConnectorRegistry);

    expect(ActivityCacheService).toHaveBeenCalledTimes(1);
    expect(TaskRerunService).toHaveBeenCalledTimes(1);
    expect(mockSprintDeps.sprintOrchestrator.setUnplannedSprintPlanner).toHaveBeenCalledOnce();

    // Get the arguments passed to ActivityCacheService constructor
    const activityCacheArgs = vi.mocked(ActivityCacheService).mock.calls[0][0];

    // Verify getSubtasks
    const subtasks = activityCacheArgs.getSubtasks();
    expect(subtasks).toEqual(["mock-subtask"]);

    // Test resolveSessionNameFromTask
    activityCacheArgs.resolveSessionNameFromTask("task1");
    expect(mockContext.resolveSessionNameFromTask).toHaveBeenCalledWith("task1");

    // Test fetchRecentActivities
    activityCacheArgs.fetchRecentActivities("session1", 10);
    expect(mockContext.fetchRecentActivities).toHaveBeenCalledWith("session1", 10, undefined);

    // Test resolveGitStatusRepoPath
    activityCacheArgs.resolveGitStatusRepoPath();
    expect(mockContext.resolveGitStatusRepoPath).toHaveBeenCalled();

    // Test fetchGitStatusForRepo
    activityCacheArgs.fetchGitStatusForRepo("/repo", 1000);
    expect(mockContext.fetchGitStatusForRepo).toHaveBeenCalledWith("/repo", 1000);

    // Test invalidateGitStatusCache
    activityCacheArgs.invalidateGitStatusCache("/repo");
    expect(mockContext.invalidateGitStatusCache).toHaveBeenCalledWith("/repo");

    // Get the arguments passed to TaskRerunService constructor
    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];

    const taskContext = taskRerunArgs.resolveTaskContext("task1");
    expect(mockCoreDeps.projectManagementRepository.getTask).toHaveBeenCalledWith("task1");
    expect(mockCoreDeps.projectRuntimeRepository.getProjectStatus).toHaveBeenCalledWith("project-1", "sprint-1");
    expect(taskContext).toEqual({
      task: expect.objectContaining({ record_id: "task1", id: "T1" }),
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintNumber: 3,
      sourceId: "source-1",
      repoPath: "/repo",
      featureBranch: "feature/sprint3",
    });

    taskRerunArgs.updateTaskPlanningStatus("task1", "pending");
    expect(mockCoreDeps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task1", { status: "pending" });

    // Test startTask
    taskRerunArgs.resolveSprintRunId({ projectId: "project-1", sprintId: "sprint-1", sprintNumber: 3, featureBranch: "feature/sprint3" });
    expect(mockCoreDeps.executionRepository.findActiveSprintRun).toHaveBeenCalledWith("project-1", "sprint-1");

    taskRerunArgs.startTask({ task: "t1", projectId: "project-1", sprintId: "sprint-1", sprintRunId: "run-1", sourceId: "s1", featureBranch: "f1", repoPath: "r1", sprintNumber: 1 });
    expect(mockSprintDeps.sprintTaskDispatchService.startTask).toHaveBeenCalledWith({
      task: "t1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      sourceId: "s1",
      featureBranch: "f1",
      repoPath: "r1",
      sprintNumber: 1,
      providerConfigId: undefined,
      resumeWorkspaceSessionId: undefined,
      resumeWorkerBranch: undefined,
      forceFreshWorkspace: undefined,
    });

    // Test resolveSessionName
    taskRerunArgs.resolveSessionName("s1");
    expect(mockContext.resolveSessionName).toHaveBeenCalledWith("s1");

    // Test extractSessionId
    taskRerunArgs.extractSessionId("s2");
    expect(mockContext.extractSessionId).toHaveBeenCalledWith("s2");

    // Test persistMergedFlag
    taskRerunArgs.persistMergedFlag({ taskId: "task1", merged: true });
    expect(mockCoreDeps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
      "task1",
      { isMerged: true, mergeIndicator: "MERGED" }
    );

    expect(taskRerunArgs.listSprintTaskDependencies("project-1", "sprint-1")).toEqual([
      { taskId: "task1", dependsOnTaskIds: [] },
      { taskId: "task2", dependsOnTaskIds: ["task1"] },
    ]);
  });

  it("wires dashboard chat runtime to project-scoped local Git settings", () => {
    const localGitSettings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      git: {
        ...DEFAULT_DASHBOARD_SETTINGS.git,
        githubMode: "LOCAL" as const,
        defaultBranch: "main",
      },
      cliWorkflow: {
        ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
        executionMode: "DOCKER" as const,
      },
    };
    mockCoreDeps.settingsRepository.resolveProjectDashboardSettings.mockReturnValue({
      settings: localGitSettings,
      sources: {},
    });

    const result = createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const chatRuntimeDeps = (result.chatThreadRuntimeService as unknown as {
      deps: {
        getDashboardSettings: (scope?: { projectId?: string; sprintId?: string | null }) => typeof DEFAULT_DASHBOARD_SETTINGS;
      };
    }).deps;
    const scopedSettings = chatRuntimeDeps.getDashboardSettings({ projectId: "project-1" });

    expect(scopedSettings.git.githubMode).toBe("LOCAL");
    expect(scopedSettings.cliWorkflow.executionMode).toBe("DOCKER");
    expect(mockCoreDeps.settingsRepository.resolveProjectDashboardSettings).toHaveBeenCalledWith("project-1");
  });

  it("links late-bound services so execution control can call task reruns after factory construction", async () => {
    const result = createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const rerunResult = await result.executionControlService.retryTaskDispatch("dispatch-1");
    const taskRerunInstance = taskRerunMockState.instances[0];

    expect(rerunResult).toEqual({ id: "T1" });
    expect(mockCoreDeps.executionRepository.getTaskDispatch).toHaveBeenCalledWith("dispatch-1");
    expect(mockCoreDeps.executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "reset-run-1",
      "dispatch_retry_requested",
      "user",
      { dispatchId: "dispatch-1", requestedBy: "dashboard" },
      { sourceEventKey: "dashboard-retry:dispatch-1" },
    );
    expect(mockCoreDeps.projectAttentionService.resolveItemsForDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      "dispatch_retry_requested",
    );
    expect(taskRerunInstance.rerunTask).toHaveBeenCalledWith("task1");
  });

  it("fails clearly when a late-bound task rerun service is accessed before linking", async () => {
    const taskRerunServiceRef = createLateBoundDependency<TaskRerunService>("dashboard task rerun service");
    const executionControlDeps: ConstructorParameters<typeof ExecutionControlService>[0] = {
      projectManagementRepository: mockCoreDeps.projectManagementRepository,
      executionRepository: mockCoreDeps.executionRepository,
      projectAttentionService: mockCoreDeps.projectAttentionService,
      taskRerunService: taskRerunServiceRef,
      sprintOrchestrator: mockSprintDeps.sprintOrchestrator,
      julesApi: mockCoreDeps.julesApi,
      activeDispatchRegistry: mockCoreDeps.activeDispatchRegistry,
      logger: mockCoreDeps.logger.child({ component: "execution-control-service" }),
    };
    const executionControlService = new ExecutionControlService(executionControlDeps);

    await expect(executionControlService.retryTaskDispatch("dispatch-1")).rejects.toThrow(
      'Late-bound dependency "dashboard task rerun service" has not been linked.',
    );
  });

  it("getSubtasks handles missing lastStatus", () => {
    mockCoreDeps.projectRuntimeRepository.getSelectedProjectLiveStatus.mockReturnValue({ subtasks: [] });
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const activityCacheArgs = vi.mocked(ActivityCacheService).mock.calls[0][0];
    expect(activityCacheArgs.getSubtasks()).toEqual([]);
  });

  it("resolveTaskContext builds synthetic task when runtime task is unavailable", () => {
    mockCoreDeps.projectRuntimeRepository.getProjectStatus.mockReturnValue({ subtasks: [] });
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const ctx = taskRerunArgs.resolveTaskContext("task1");
    expect(ctx).not.toBeNull();
    expect(ctx!.task.id).toBe("T1");
    expect(ctx!.task.record_id).toBe("task1");
    expect(ctx!.task.status).toBe("PENDING");
    expect(ctx!.featureBranch).toBe("feature/sprint3");
    expect(ctx!.repoPath).toBe("/repo");
    expect(ctx!.sprintNumber).toBe(3);
  });

  it("resolveTaskContext recovers the previous bound CLI workspace when the latest runtime task lost session evidence", () => {
    mockCoreDeps.projectRuntimeRepository.getProjectStatus.mockReturnValue({
      project_id: "project-1",
      sprint_id: "sprint-1",
      sprint_number: 3,
      source_id: "source-1",
      feature_branch: "feature/sprint3",
      repo_path: "/repo",
      subtasks: [{
        record_id: "task1",
        id: "T1",
        title: "Task",
        prompt: "Do it",
        depends_on: [],
        status: "BLOCKED",
        session_id: undefined,
        worker_branch: undefined,
      }],
    });
    mockCoreDeps.executionRepository.getLatestTaskWorkspaceResumeTarget.mockReturnValue({
      sessionId: "cli-codex-workspace",
      sessionName: "sessions/cli-codex-workspace",
      workerBranch: "task/worker-old",
      prUrl: "https://example.com/pr/1",
    });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const ctx = taskRerunArgs.resolveTaskContext("task1");

    expect(mockCoreDeps.executionRepository.getLatestTaskWorkspaceResumeTarget).toHaveBeenCalledWith("task1");
    expect(mockCoreDeps.executionRepository.getLatestTaskRunWithWorkspace).not.toHaveBeenCalled();
    expect(ctx!.task.session_id).toBe("cli-codex-workspace");
    expect(ctx!.task.session_name).toBe("sessions/cli-codex-workspace");
    expect(ctx!.task.worker_branch).toBe("task/worker-old");
    expect(ctx!.task.pr_url).toBe("https://example.com/pr/1");
  });

  it("resolveTaskContext falls back to the latest worker branch run when no workspace binding exists", () => {
    mockCoreDeps.projectRuntimeRepository.getProjectStatus.mockReturnValue({
      project_id: "project-1",
      sprint_id: "sprint-1",
      sprint_number: 3,
      source_id: "source-1",
      feature_branch: "feature/sprint3",
      repo_path: "/repo",
      subtasks: [{
        record_id: "task1",
        id: "T1",
        title: "Task",
        prompt: "Do it",
        depends_on: [],
        status: "BLOCKED",
        session_id: undefined,
        worker_branch: undefined,
      }],
    });
    mockCoreDeps.executionRepository.getLatestTaskRunWithWorkspace.mockReturnValue({
      sessionId: "cli-codex-old",
      sessionName: "sessions/cli-codex-old",
      workerBranch: "task/worker-old",
      prUrl: "https://example.com/pr/1",
    });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const ctx = taskRerunArgs.resolveTaskContext("task1");

    expect(mockCoreDeps.executionRepository.getLatestTaskWorkspaceResumeTarget).toHaveBeenCalledWith("task1");
    expect(mockCoreDeps.executionRepository.getLatestTaskRunWithWorkspace).toHaveBeenCalledWith("task1");
    expect(ctx!.task.session_id).toBe("cli-codex-old");
    expect(ctx!.task.session_name).toBe("sessions/cli-codex-old");
    expect(ctx!.task.worker_branch).toBe("task/worker-old");
    expect(ctx!.task.pr_url).toBe("https://example.com/pr/1");
  });

  it("resolveTaskContext lets the latest workspace binding override stale runtime session metadata", () => {
    mockCoreDeps.projectRuntimeRepository.getProjectStatus.mockReturnValue({
      project_id: "project-1",
      sprint_id: "sprint-1",
      sprint_number: 3,
      source_id: "source-1",
      feature_branch: "feature/sprint3",
      repo_path: "/repo",
      subtasks: [{
        record_id: "task1",
        id: "T1",
        title: "Task",
        prompt: "Do it",
        depends_on: [],
        status: "FAILED",
        session_id: "cli-codex-provider-session",
        session_name: "sessions/cli-codex-provider-session",
        worker_branch: "task/stale-worker",
        pr_url: "https://example.com/pr/stale",
      }],
    });
    mockCoreDeps.executionRepository.getLatestTaskWorkspaceResumeTarget.mockReturnValue({
      sessionId: "cli-codex-workspace-session",
      sessionName: "sessions/cli-codex-workspace-session",
      workerBranch: "task/workspace-worker",
      prUrl: "https://example.com/pr/workspace",
    });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const ctx = taskRerunArgs.resolveTaskContext("task1");

    expect(ctx!.task.session_id).toBe("cli-codex-workspace-session");
    expect(ctx!.task.session_name).toBe("sessions/cli-codex-workspace-session");
    expect(ctx!.task.worker_branch).toBe("task/workspace-worker");
    expect(ctx!.task.pr_url).toBe("https://example.com/pr/workspace");
  });

  it("resolveTaskContext derives the sprint branch instead of reusing stale project runtime data", () => {
    mockCoreDeps.projectRuntimeRepository.getProjectStatus.mockReturnValue({
      subtasks: [],
      feature_branch: "feature/sprint-26",
      repo_path: "/repo",
      sprint_number: 26,
    });
    mockCoreDeps.projectManagementRepository.getSprint.mockReturnValue({
      id: "sprint-1",
      projectId: "project-1",
      number: 89,
      featureBranch: null,
    });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const ctx = taskRerunArgs.resolveTaskContext("task1");

    expect(mockCoreDeps.projectRuntimeRepository.getProjectStatus).toHaveBeenCalledWith("project-1", "sprint-1");
    expect(ctx).not.toBeNull();
    expect(ctx!.featureBranch).toBe("feature/sprint");
    expect(ctx!.sprintNumber).toBe(89);
  });

  it("resolveTaskContext returns null when feature branch and repo path are both unavailable", () => {
    mockCoreDeps.projectRuntimeRepository.getProjectStatus.mockReturnValue({ subtasks: [] });
    mockCoreDeps.projectManagementRepository.getSprint.mockReturnValue({ id: "sprint-1", projectId: "project-1", number: 3 });
    mockCoreDeps.projectManagementRepository.getProject.mockReturnValue({ id: "project-1" });
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    expect(taskRerunArgs.resolveTaskContext("task1")).toBeNull();
  });

  it("resolveTaskContext returns null when the task, sprint, or project cannot be resolved", () => {
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];

    mockCoreDeps.projectManagementRepository.getTask.mockReturnValueOnce(null);
    expect(taskRerunArgs.resolveTaskContext("missing-task")).toBeNull();

    mockCoreDeps.projectManagementRepository.getTask.mockReturnValue({ id: "task1", taskKey: "T1", projectId: "project-1", sprintId: "sprint-1" });
    mockCoreDeps.projectManagementRepository.getSprint.mockReturnValueOnce(null);
    expect(taskRerunArgs.resolveTaskContext("task1")).toBeNull();

    mockCoreDeps.projectManagementRepository.getSprint.mockReturnValue({ id: "sprint-1", projectId: "project-1", number: 3, featureBranch: "feature/sprint3" });
    mockCoreDeps.projectManagementRepository.getProject.mockReturnValueOnce(null);
    expect(taskRerunArgs.resolveTaskContext("task1")).toBeNull();
  });

  it("resolveSprintRunId creates and timestamps a sprint run when none is active", async () => {
    mockCoreDeps.executionRepository.findActiveSprintRun.mockReturnValue(null);
    mockCoreDeps.sprintRunLifecycleService.createRun.mockReturnValue({ id: "run-created" });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const sprintRun = await taskRerunArgs.resolveSprintRunId({ projectId: "project-1", sprintId: "sprint-1" });

    expect(sprintRun).toEqual({ sprintRunId: "run-created", created: true });
    expect(mockCoreDeps.sprintRunLifecycleService.createRun).toHaveBeenCalledWith({
      projectId: "project-1",
      sprintId: "sprint-1",
      triggerType: "dashboard",
      triggeredBy: "task_rerun",
      executorMode: "mixed",
      status: "running",
    });
    expect(mockCoreDeps.sprintRunLifecycleService.markRunning).toHaveBeenCalledWith(
      "run-created",
      expect.objectContaining({
        startedAt: expect.any(String),
        lastHeartbeatAt: expect.any(String),
      }),
    );
  });

  it("resolveSprintRunId reports reused active sprint runs without creating a new one", async () => {
    mockCoreDeps.executionRepository.findActiveSprintRun.mockReturnValue({ id: "run-active" });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const sprintRun = await taskRerunArgs.resolveSprintRunId({ projectId: "project-1", sprintId: "sprint-1" });

    expect(sprintRun).toEqual({ sprintRunId: "run-active", created: false });
    expect(mockCoreDeps.executionRepository.createSprintRun).not.toHaveBeenCalled();
  });

  it("resumeSprintRun delegates to sprint recovery after rerun-created runs", async () => {
    mockSprintDeps.sprintOrchestrator.recoverSprintRun = vi.fn().mockResolvedValue({ ok: true });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    await taskRerunArgs.resumeSprintRun("run-created");

    expect(mockSprintDeps.sprintOrchestrator.recoverSprintRun).toHaveBeenCalledWith("run-created");
  });

  it("clearTaskWorktree removes the session worktree when a latest task run exists", async () => {
    mockCoreDeps.executionRepository.getLatestTaskRun = vi.fn().mockReturnValue({ sessionId: "session-1" });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    await taskRerunArgs.clearTaskWorktree({ taskId: "task1", repoPath: "/repo" });

    expect(mockCoreDeps.executionRepository.getLatestTaskRun).toHaveBeenCalledWith("task1");
    expect(WorkspaceManager).toHaveBeenCalled();
    const workspaceManagerInstance = vi.mocked(WorkspaceManager).mock.results.at(-1)?.value;
    expect(workspaceManagerInstance.buildWorktreePath).toHaveBeenCalledWith("/repo", "session-1", "DOCKER");
    expect(workspaceManagerInstance.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/session-1");
  });

  it("clearTaskWorktree exits early when there is no latest session", async () => {
    mockCoreDeps.executionRepository.getLatestTaskRun = vi.fn().mockReturnValue(null);

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    await taskRerunArgs.clearTaskWorktree({ taskId: "task1", repoPath: "/repo" });

    expect(mockCoreDeps.executionRepository.getLatestTaskRun).toHaveBeenCalledWith("task1");
    const workspaceManagerInstances = vi.mocked(WorkspaceManager).mock.results.map((result) => result.value);
    expect(workspaceManagerInstances.every((instance) => !instance.removeWorktree.mock.calls.length)).toBe(true);
  });

  it("creates a clean pending task run snapshot for dependent resets", async () => {
    mockCoreDeps.executionRepository.getLatestTaskRun = vi.fn()
      .mockReturnValueOnce({ id: "existing-run", provider: "jules", mode: "jules" })
      .mockReturnValueOnce({ id: "existing-run", provider: "jules", mode: "jules" });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    await taskRerunArgs.createResetTaskRun({
      taskId: "task1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      reason: "dependent_task_reset",
    });

    expect(mockCoreDeps.executionRepository.createTaskRun).toHaveBeenCalledWith({
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task1",
      sprintRunId: "run-1",
      provider: "jules",
      mode: "jules",
      state: "PENDING",
    });
    expect(mockCoreDeps.executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "reset-run-1",
      "task_reset",
      "user",
      {
        taskId: "task1",
        reason: "dependent_task_reset",
      },
      expect.objectContaining({
        sourceEventKey: "task-reset:task1:run-1:dependent_task_reset",
      }),
    );
  });

  it("resolves task attention when a task is reset", async () => {
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    await taskRerunArgs.resolveTaskAttention({
      taskId: "task1",
      projectId: "project-1",
    });

    expect(mockCoreDeps.projectAttentionService.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task1",
      expect.arrayContaining([
        "worker_dispatch_blocked",
        "merge_required",
        "merge_conflict",
        "ci_fix_required",
      ]),
      "task_rerun_reset",
    );
  });

  it("updates executor overrides and cancels active dispatches correctly", async () => {
    mockCoreDeps.executionRepository.listTaskDispatches = vi.fn().mockReturnValue([
      { id: "queued-1", status: "queued" },
      { id: "running-1", status: "running" },
      { id: "cancel-1", status: "cancel_requested" },
      { id: "completed-1", status: "completed" },
    ]);
    mockCoreDeps.executionRepository.updateTaskDispatch = vi.fn();
    mockCoreDeps.executionRepository.getTaskRunByDispatchId = vi.fn()
      .mockReturnValueOnce({ id: "run-queued", startedAt: "2026-03-09T10:00:00.000Z" })
      .mockReturnValueOnce({ id: "run-running", startedAt: "2026-03-09T10:01:00.000Z" })
      .mockReturnValueOnce({ id: "run-cancel", startedAt: "2026-03-09T10:02:00.000Z" });
    mockCoreDeps.executionRepository.updateTaskRun = vi.fn();
    mockCoreDeps.executionRepository.appendTaskRunEvent = vi.fn();

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];

    taskRerunArgs.updateTaskExecutorOverride("task1", "jules");
    taskRerunArgs.updateTaskExecutorOverride("task1", "codex");
    expect(mockCoreDeps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task1", { executorType: "jules" });
    expect(mockCoreDeps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task1", { executorType: "docker_cli" });

    await taskRerunArgs.cancelActiveDispatch("task1", "project-1");

    expect(mockCoreDeps.executionRepository.listTaskDispatches).toHaveBeenCalledWith({ projectId: "project-1", taskId: "task1" });
    expect(mockCoreDeps.activeDispatchRegistry.requestStop).toHaveBeenCalledWith("running-1", "Task rerun requested from dashboard.");
    expect(mockCoreDeps.executionRepository.updateTaskDispatch).toHaveBeenCalledTimes(3);
    expect(mockCoreDeps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "queued-1",
      expect.objectContaining({
        status: "cancelled",
        errorMessage: "Cancelled: task rerun requested.",
      }),
    );
    expect(mockCoreDeps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "running-1",
      expect.objectContaining({
        status: "cancelled",
        errorMessage: "Cancelled: task rerun requested.",
      }),
    );
    expect(mockCoreDeps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "cancel-1",
      expect.objectContaining({
        status: "cancelled",
        errorMessage: "Cancelled: task rerun requested.",
      }),
    );
    expect(mockCoreDeps.executionRepository.updateTaskRun).toHaveBeenCalledTimes(3);
    expect(mockCoreDeps.executionRepository.appendTaskRunEvent).toHaveBeenCalledTimes(3);
  });
});
