import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDashboardDependencies } from "../../../../src/app/dependency-factory/dashboard-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { SprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { ActivityCacheService } from "../../../../src/server/activity-cache-service.js";
import { TaskRerunService } from "../../../../src/services/task-rerun-service.js";

vi.mock("../../../../src/server/activity-cache-service.js", () => {
  const ActivityCacheService = vi.fn();
  ActivityCacheService.prototype.invalidateLiveActivitiesCache = vi.fn();
  return { ActivityCacheService };
});

vi.mock("../../../../src/services/task-rerun-service.js", () => {
  const TaskRerunService = vi.fn();
  return { TaskRerunService };
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
        updateTask: vi.fn(),
      },
      executionRepository: {
        findActiveSprintRun: vi.fn().mockReturnValue({ id: "run-1" }),
        createSprintRun: vi.fn(),
        updateSprintRun: vi.fn(),
      },
      settingsRepository: {
        resolveProjectDashboardSettings: vi.fn(),
      },
      projectAttentionService: {
        resolveItemsForDispatch: vi.fn(),
      },
    };

    mockSprintDeps = {
      sprintTaskDispatchService: {
        startTask: vi.fn(),
      },
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
});
