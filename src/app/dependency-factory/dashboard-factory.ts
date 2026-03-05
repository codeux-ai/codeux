import * as path from "path";
import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { ActivityCacheService } from "../../server/activity-cache-service.js";
import { TaskRerunService } from "../../services/task-rerun-service.js";

export interface DashboardDependencies {
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
}

export function createDashboardDependencies(
  context: ServerContext,
  coreDeps: CoreDependencies,
  sprintDeps: SprintDependencies
): DashboardDependencies {
  const { logger, subtaskRepository } = coreDeps;
  const { taskService } = sprintDeps;

  const activityCacheService = new ActivityCacheService(
    {
      getSubtasks: () => {
        const lastStatus = context.runtimeContext.lastStatus;
        return Array.isArray(lastStatus?.subtasks) ? lastStatus.subtasks : [];
      },
      resolveSessionNameFromTask: (task) => context.resolveSessionNameFromTask(task),
      fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
      resolveGitStatusRepoPath: () => context.resolveGitStatusRepoPath(),
      fetchGitStatusForRepo: (repoPath, cacheTtlMs) => context.fetchGitStatusForRepo(repoPath, cacheTtlMs),
      invalidateGitStatusCache: (repoPath) => context.invalidateGitStatusCache?.(repoPath),
      logger: logger.child({ component: "activity-cache-service" }),
    },
    10_000, // LIVE_ACTIVITY_CACHE_MS
    10_000, // GIT_STATUS_CACHE_MS
    20      // DASHBOARD_ACTIVITY_PAGE_SIZE
  );

  const taskRerunService = new TaskRerunService({
    getStatus: () => context.runtimeContext.lastStatus || {},
    updateStatus: (status) => {
      context.runtimeContext.lastStatus = status;
      activityCacheService.invalidateLiveActivitiesCache();
    },
    startTask: ({ task, sourceId, featureBranch, repoPath, sprintNumber }) =>
      taskService.startSprintTask(task, sourceId, featureBranch, repoPath, sprintNumber),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    persistMergedFlag: (args) => subtaskRepository.setMerged(
      path.join(args.repoPath, ".jules-subagents", "sprints", `sprint${args.sprintNumber}-subtasks`),
      args.taskId,
      args.merged
    ),
    logger: logger.child({ component: "task-rerun-service" }),
  });

  return {
    activityCacheService,
    taskRerunService,
  };
}
