import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { ActivityCacheService } from "../../server/activity-cache-service.js";
import { TaskRerunService } from "../../services/task-rerun-service.js";
import { ExecutionControlService } from "../../services/execution-control-service.js";
import { PlanningAgentService } from "../../services/planning-agent-service.js";

export interface DashboardDependencies {
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  executionControlService: ExecutionControlService;
  planningAgentService: PlanningAgentService;
}

export function createDashboardDependencies(
  context: ServerContext,
  coreDeps: CoreDependencies,
  sprintDeps: SprintDependencies
): DashboardDependencies {
  const {
    logger,
    projectRuntimeRepository,
    projectManagementRepository,
    connectionChatRepository,
    projectAttentionService,
    agentPresetSyncService,
    executionRepository,
    settingsRepository,
    julesApi,
    activeDispatchRegistry,
  } = coreDeps;
  const { sprintTaskDispatchService, sprintOrchestrator } = sprintDeps;

  const activityCacheService = new ActivityCacheService(
    {
      getSubtasks: () => projectRuntimeRepository.getSelectedProjectStatus().subtasks,
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
    resolveTaskContext: (taskId) => {
      const taskRecord = projectManagementRepository.getTask(taskId);
      if (!taskRecord) {
        return null;
      }
      const sprint = projectManagementRepository.getSprint(taskRecord.sprintId);
      const project = projectManagementRepository.getProject(taskRecord.projectId);
      if (!sprint || !project) {
        return null;
      }
      const runtimeStatus = projectRuntimeRepository.getProjectStatus(taskRecord.projectId);
      const runtimeTask = (runtimeStatus.subtasks || []).find((task) => task.record_id === taskId || task.id === taskRecord.taskKey);
      const featureBranch = runtimeStatus.feature_branch || sprint.featureBranch || null;
      const repoPath = runtimeStatus.repo_path || project.baseDir || null;
      const sprintNumber = typeof runtimeStatus.sprint_number === "number"
        ? runtimeStatus.sprint_number
        : sprint.number;

      if (!runtimeTask || !featureBranch || !repoPath || sprintNumber === null || sprintNumber === undefined) {
        return null;
      }

      return {
        task: runtimeTask,
        projectId: taskRecord.projectId,
        sprintId: taskRecord.sprintId,
        sprintNumber,
        sourceId: runtimeStatus.source_id,
        repoPath,
        featureBranch,
      };
    },
    updateTaskPlanningStatus: (taskId, status) => {
      projectManagementRepository.updateTask(taskId, { status });
      activityCacheService.invalidateLiveActivitiesCache();
    },
    resolveSprintRunId: async ({ projectId, sprintId }) => {
      const existing = executionRepository.findActiveSprintRun(projectId, sprintId);
      if (existing) {
        return existing.id;
      }

      const created = executionRepository.createSprintRun({
        projectId,
        sprintId,
        triggerType: "dashboard",
        triggeredBy: "task_rerun",
        executorMode: "mixed",
        status: "running",
      });
      executionRepository.updateSprintRun(created.id, {
        status: "running",
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      });
      return created.id;
    },
    startTask: ({ task, projectId, sprintId, sprintRunId, sourceId, featureBranch, repoPath, sprintNumber }) =>
      sprintTaskDispatchService.startTask({
        task,
        projectId,
        sprintId,
        sprintRunId,
        sourceId,
        featureBranch,
        repoPath,
        sprintNumber,
      }),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    persistMergedFlag: async (args) => {
      projectManagementRepository.updateTask(args.taskId, {
        isMerged: args.merged,
        mergeIndicator: args.merged ? "MERGED" : null,
      });
    },
    logger: logger.child({ component: "task-rerun-service" }),
  });

  const executionControlService = new ExecutionControlService({
    projectManagementRepository,
    executionRepository,
    projectAttentionService,
    taskRerunService,
    sprintOrchestrator,
    julesApi,
    activeDispatchRegistry,
    logger: logger.child({ component: "execution-control-service" }),
  });

  const planningAgentService = new PlanningAgentService({
    projectManagementRepository,
    connectionChatRepository,
    executionRepository,
    settingsRepository,
    agentPresetSyncService,
    executionControlService,
    logger: logger.child({ component: "planning-agent-service" }),
  });

  return {
    activityCacheService,
    taskRerunService,
    executionControlService,
    planningAgentService,
  };
}
