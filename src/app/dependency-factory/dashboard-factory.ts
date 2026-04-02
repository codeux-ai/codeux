import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { ActivityCacheService } from "../../server/activity-cache-service.js";
import { TaskRerunService } from "../../services/task-rerun-service.js";
import { ExecutionControlService } from "../../services/execution-control-service.js";
import { PlanningAgentService } from "../../services/planning-agent-service.js";
import { QuicksprintService } from "../../services/quicksprint-service.js";
import { WorkspaceManager } from "../../infrastructure/providers/cli/workspace-manager.js";

import { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";

export interface DashboardDependencies {
  chatThreadRuntimeService: ChatThreadRuntimeService;
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  executionControlService: ExecutionControlService;
  planningAgentService: PlanningAgentService;
  quicksprintService: QuicksprintService;
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
    projectWorkerAssignmentRepository,
    projectAttentionService,
    agentPresetSyncService,
    executionRepository,
    settingsRepository,
    julesApi,
    activeDispatchRegistry,
    providerRunner,
  } = coreDeps;
  const { sprintTaskDispatchService, sprintOrchestrator, taskService, providerTextInvocationService } = sprintDeps;

  const chatThreadRuntimeService = new ChatThreadRuntimeService({
    connectionChatRepository,
    projectWorkerAssignmentRepository,
    taskService,
    getDashboardSettings: () => settingsRepository.getDefaultDashboardSettings(),
    getGithubToken: () => context.getEffectiveGithubToken(),
    agentPresetSyncService,
    projectManagementRepository,
    providerTextInvocationService,
    logger: logger.child({ component: "chat-thread-runtime-service" }),
  });

  const activityCacheService = new ActivityCacheService(
    {
      getSubtasks: () => projectRuntimeRepository.getSelectedProjectLiveStatus().subtasks,
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
      // Prefer sprint record data — runtime status may be stale from a different sprint
      const featureBranch = sprint.featureBranch || runtimeStatus.feature_branch || null;
      const repoPath = project.baseDir || runtimeStatus.repo_path || null;
      const sprintNumber = sprint.number ?? runtimeStatus.sprint_number ?? null;

      if (!featureBranch || !repoPath || sprintNumber === null || sprintNumber === undefined) {
        return null;
      }

      // Build synthetic subtask from project management data when runtime task is not available
      const resolvedTask: import("../../contracts/app-types.js").Subtask = runtimeTask ?? {
        id: taskRecord.taskKey,
        record_id: taskRecord.id,
        project_id: taskRecord.projectId,
        sprint_id: taskRecord.sprintId,
        title: taskRecord.title,
        prompt: taskRecord.promptMarkdown || taskRecord.description,
        depends_on: taskRecord.dependsOnTaskIds,
        status: "PENDING",
        is_independent: taskRecord.isIndependent,
        is_merged: taskRecord.isMerged,
      };

      return {
        task: resolvedTask,
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
    clearTaskWorktree: async ({ taskId, repoPath }) => {
      const latestRun = executionRepository.getLatestTaskRun(taskId);
      const sessionId = latestRun?.sessionId;
      if (!sessionId) return;
      const wsManager = new WorkspaceManager();
      const worktreePath = wsManager.buildWorktreePath(repoPath, sessionId, "HOST");
      await wsManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
    },
    updateTaskExecutorOverride: (taskId, provider) => {
      const executorType = provider === "jules" ? "jules" : "docker_cli";
      projectManagementRepository.updateTask(taskId, { executorType });
    },
    cancelActiveDispatch: async (taskId, projectId) => {
      const dispatches = executionRepository.listTaskDispatches({ projectId, taskId });
      const active = dispatches.filter((d) =>
        d.status === "queued" || d.status === "claimed" || d.status === "running" || d.status === "cancel_requested"
      );
      for (const dispatch of active) {
        if (dispatch.status === "running") {
          await activeDispatchRegistry.requestStop(dispatch.id, "Task rerun requested from dashboard.").catch(() => undefined);
        }
        const now = new Date().toISOString();
        executionRepository.updateTaskDispatch(dispatch.id, {
          status: "cancelled",
          finishedAt: now,
          errorMessage: "Cancelled: task rerun requested.",
        });
      }
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
    memoryService: coreDeps.memoryService,
    logger: logger.child({ component: "planning-agent-service" }),
  });

  const quicksprintService = new QuicksprintService(
    (projectId) => {
      const project = projectManagementRepository.getProject(projectId);
      if (!project || !project.baseDir) {
        throw new Error(`Project ${projectId} not found or has no base directory`);
      }
      return project.baseDir;
    },
    (projectId, input) => projectManagementRepository.createSprint(projectId, input),
    (projectId, sprintId, options, signal) => planningAgentService.planSprint(projectId, sprintId, options, signal),
    (agentPresetId) => coreDeps.agentPresetRepository.getAgentPreset(agentPresetId),
  );

  return {
    chatThreadRuntimeService,
    activityCacheService,
    taskRerunService,
    executionControlService,
    planningAgentService,
    quicksprintService,
  };
}
