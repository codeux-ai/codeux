import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDashboardDependencies } from "../../../../src/app/dependency-factory/dashboard-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { SprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { ActivityCacheService } from "../../../../src/server/activity-cache-service.js";
import { TaskRerunService } from "../../../../src/services/task-rerun-service.js";
import { WorkspaceManager } from "../../../../src/infrastructure/providers/cli/workspace-manager.js";

vi.mock("../../../../src/server/activity-cache-service.js", () => {
  const ActivityCacheService = vi.fn();
  ActivityCacheService.prototype.invalidateLiveActivitiesCache = vi.fn();
  return { ActivityCacheService };
});

vi.mock("../../../../src/services/task-rerun-service.js", () => {
  const TaskRerunService = vi.fn();
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
      },
      executionRepository: {
        findActiveSprintRun: vi.fn().mockReturnValue({ id: "run-1" }),
        createSprintRun: vi.fn(),
        updateSprintRun: vi.fn(),
        getLatestTaskRun: vi.fn().mockReturnValue(null),
        createTaskRun: vi.fn().mockReturnValue({ id: "reset-run-1" }),
        appendTaskRunEvent: vi.fn(),
        getTaskRunByDispatchId: vi.fn().mockReturnValue(null),
      },
      settingsRepository: {
        getDefaultDashboardSettings: vi.fn().mockReturnValue({}),
        resolveProjectDashboardSettings: vi.fn(),
        resolveSprintDashboardSettings: vi.fn().mockReturnValue({
          settings: {
            git: {
              sprintBranchScheme: "feature/sprint{sprint}",
            },
          },
        }),
      },
      projectAttentionService: {
        resolveItemsForDispatch: vi.fn(),
        resolveItemsForTask: vi.fn(),
      },
      connectionChatRepository: {},
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
    };

    mockSprintDeps = {
      sprintTaskDispatchService: {
        startTask: vi.fn(),
      },
      sprintOrchestrator: {},
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

    expect(ActivityCacheService).toHaveBeenCalledTimes(1);
    expect(TaskRerunService).toHaveBeenCalledTimes(1);

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
    expect(mockContext.fetchRecentActivities).toHaveBeenCalledWith("session1", 10);

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
    mockCoreDeps.executionRepository.createSprintRun.mockReturnValue({ id: "run-created" });

    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    const sprintRunId = await taskRerunArgs.resolveSprintRunId({ projectId: "project-1", sprintId: "sprint-1" });

    expect(sprintRunId).toBe("run-created");
    expect(mockCoreDeps.executionRepository.createSprintRun).toHaveBeenCalledWith({
      projectId: "project-1",
      sprintId: "sprint-1",
      triggerType: "dashboard",
      triggeredBy: "task_rerun",
      executorMode: "mixed",
      status: "running",
    });
    expect(mockCoreDeps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-created",
      expect.objectContaining({
        status: "running",
        startedAt: expect.any(String),
        lastHeartbeatAt: expect.any(String),
      }),
    );
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
    expect(WorkspaceManager).toHaveBeenCalledTimes(1);
    const workspaceManagerInstance = vi.mocked(WorkspaceManager).mock.results[0]?.value;
    expect(workspaceManagerInstance.buildWorktreePath).toHaveBeenCalledWith("/repo", "session-1", "HOST");
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
    expect(WorkspaceManager).not.toHaveBeenCalled();
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
