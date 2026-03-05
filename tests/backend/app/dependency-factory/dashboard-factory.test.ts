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
      subtaskRepository: {
        setMerged: vi.fn(),
      },
    };

    mockSprintDeps = {
      taskService: {
        startSprintTask: vi.fn(),
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

    // Test getStatus
    const status = taskRerunArgs.getStatus();
    expect(status).toEqual({ subtasks: ["mock-subtask"] });

    // Test updateStatus
    taskRerunArgs.updateStatus({ updated: true });
    expect(mockContext.runtimeContext.lastStatus).toEqual({ updated: true });

    // Test startTask
    taskRerunArgs.startTask({ task: "t1", sourceId: "s1", featureBranch: "f1", repoPath: "r1", sprintNumber: 1 });
    expect(mockSprintDeps.taskService.startSprintTask).toHaveBeenCalledWith("t1", "s1", "f1", "r1", 1);

    // Test resolveSessionName
    taskRerunArgs.resolveSessionName("s1");
    expect(mockContext.resolveSessionName).toHaveBeenCalledWith("s1");

    // Test extractSessionId
    taskRerunArgs.extractSessionId("s2");
    expect(mockContext.extractSessionId).toHaveBeenCalledWith("s2");

    // Test persistMergedFlag
    taskRerunArgs.persistMergedFlag({ repoPath: "/repo", sprintNumber: 1, taskId: "task1", merged: true });
    expect(mockCoreDeps.subtaskRepository.setMerged).toHaveBeenCalledWith(
      expect.stringContaining("sprint1-subtasks"),
      "task1",
      true
    );
  });

  it("getSubtasks handles missing lastStatus", () => {
    mockContext.runtimeContext.lastStatus = undefined;
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const activityCacheArgs = vi.mocked(ActivityCacheService).mock.calls[0][0];
    expect(activityCacheArgs.getSubtasks()).toEqual([]);
  });

  it("getStatus handles missing lastStatus", () => {
    mockContext.runtimeContext.lastStatus = undefined;
    createDashboardDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies
    );

    const taskRerunArgs = vi.mocked(TaskRerunService).mock.calls[0][0];
    expect(taskRerunArgs.getStatus()).toEqual({});
  });
});
