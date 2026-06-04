import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { ActivityCacheService } from "../../server/activity-cache-service.js";
import { TaskRerunService } from "../../services/task-rerun-service.js";
import { ExecutionControlService } from "../../services/execution-control-service.js";
import { PlanningAgentService } from "../../services/planning-agent-service.js";
import { QuicksprintService } from "../../services/quicksprint-service.js";
import { ProjectSetupService } from "../../services/project-setup-service.js";
import { WorkspaceManager } from "../../infrastructure/providers/cli/workspace-manager.js";
import { formatSprintBranch } from "../../domain/sprint/branch-name-generator.js";

import { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";
import { ManagementToolHandler } from "../../mcp/management-tool-handler.js";
import { StructuredProviderResponseService } from "../../services/structured-provider-response-service.js";
import { ChatManagementActionService } from "../../services/chat-management-action-service.js";
import { ProviderExecutionService } from "../../services/provider-execution-service.js";
import { SchedulerService } from "../../services/scheduler-service.js";

export interface DashboardDependencies {
  chatThreadRuntimeService: ChatThreadRuntimeService;
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  executionControlService: ExecutionControlService;
  planningAgentService: PlanningAgentService;
  quicksprintService: QuicksprintService;
  projectSetupService: ProjectSetupService;
  sprintIssueService: CoreDependencies["sprintIssueService"];
  schedulerService: SchedulerService;
  searchJiraIssues: CoreDependencies["sprintIssueService"]["searchJiraIssues"];
  replaceSprintLinkedIssues: CoreDependencies["projectManagementRepository"]["replaceSprintLinkedIssues"];
  listSprintLinkedIssues: CoreDependencies["projectManagementRepository"]["listSprintLinkedIssues"];
  closeSprintLinkedIssues: CoreDependencies["sprintIssueService"]["closeLinkedIssues"];
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
  const { sprintTaskDispatchService, sprintOrchestrator, taskService } = sprintDeps;

  const executionControlService = new ExecutionControlService({
    projectManagementRepository,
    executionRepository,
    projectAttentionService,
    taskRerunService: {} as any, // Will link below
    sprintOrchestrator,
    julesApi,
    activeDispatchRegistry,
    logger: logger.child({ component: "execution-control-service" }),
  });

  const managementToolHandler = new ManagementToolHandler({
    sprintPreviewService: coreDeps.sprintPreviewService,
    executionRepository: coreDeps.executionRepository,
    getDashboardSettings: () => settingsRepository.getDefaultDashboardSettings(),
    projectManagementRepository: coreDeps.projectManagementRepository,
    executionControlService,
    taskRerunService: {} as any, // Will link below
    settingsRepository: coreDeps.settingsRepository,
    agentPresetSyncService: coreDeps.agentPresetSyncService,
    memoryService: coreDeps.memoryService,
    memoryPromotionService: coreDeps.memoryPromotionService,
    embeddingModelManager: coreDeps.embeddingModelManager,
    planningAgentService: {} as any, // Will link below
    projectSetupService: undefined,
    sprintIssueService: coreDeps.sprintIssueService,
  });

  const providerExecutionService = new ProviderExecutionService({
    executionRepository,
    providerRunner,
    providerConcurrencyService: coreDeps.providerConcurrencyService,
    logger: logger.child({ component: "provider-execution-service" }),
  });

  const structuredProviderResponseService = new StructuredProviderResponseService({
    providerExecutionService,
    executionRepository,
    logger: logger.child({ component: "structured-provider-response-service" }),
  });

  const chatManagementActionService = new ChatManagementActionService({
    structuredProviderResponseService,
    providerExecutionService,
    managementToolHandler,
    executionRepository,
  });

  const chatThreadRuntimeService = new ChatThreadRuntimeService({
    connectionChatRepository,
    projectWorkerAssignmentRepository,
    executionRepository,
    taskService,
    getDashboardSettings: () => settingsRepository.getDefaultDashboardSettings(),
    getGithubToken: () => context.getEffectiveGithubToken(),
    agentPresetSyncService,
    projectManagementRepository,
    providerRunner,
    chatManagementActionService,
    getMcpConnectionInfo: context.getMcpConnectionInfo,
    getMcpApprovalTracker: context.getMcpApprovalTracker,
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
      isSessionTerminal: (sessionName) => executionRepository.isSessionTerminal(sessionName),
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
      const runtimeStatus = projectRuntimeRepository.getProjectStatus(taskRecord.projectId, sprint.id);
      const runtimeTask = (runtimeStatus.subtasks || []).find((task) => task.record_id === taskId || task.id === taskRecord.taskKey);
      const effectiveSettings = settingsRepository.resolveSprintDashboardSettings(taskRecord.projectId, sprint.id).settings;
      const derivedFeatureBranch = typeof sprint.number === "number"
        ? formatSprintBranch(effectiveSettings.git.sprintBranchScheme, {
            sprint_key_prefix: effectiveSettings.git.sprintKeyPrefix,
            sprint_number: sprint.number as number,
            sprint_name: sprint.name || "",
            sprint_id: sprint.slug || "",
            planning_agent: effectiveSettings.agents.routing.planning.agentPresetId || "default",
            agent_routing: effectiveSettings.agents.routing.taskCoding.mode,
            worker_agent: effectiveSettings.agents.routing.taskCoding.agentPresetId || "default",
            worker_provider: effectiveSettings.workers.virtualWorkerProvider,
            worker_model: effectiveSettings.workers.model,
          })
        : null;
      const featureBranch = sprint.featureBranch || derivedFeatureBranch || runtimeStatus.feature_branch || null;
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
        agentPresetId: taskRecord.agentPresetId,
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
    listSprintTaskDependencies: (projectId, sprintId) => (
      projectManagementRepository.listTasks(projectId, sprintId).map((task) => ({
        taskId: task.id,
        dependsOnTaskIds: task.dependsOnTaskIds,
      }))
    ),
    updateTaskPlanningStatus: (taskId, status) => {
      projectManagementRepository.updateTask(taskId, { status });
      activityCacheService.invalidateLiveActivitiesCache();
    },
    resolveSprintRunId: async ({ projectId, sprintId }) => {
      const existing = executionRepository.findActiveSprintRun(projectId, sprintId);
      if (existing) {
        return { sprintRunId: existing.id, created: false };
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
      return { sprintRunId: created.id, created: true };
    },
    startTask: ({ task, projectId, sprintId, sprintRunId, sourceId, featureBranch, repoPath, sprintNumber, providerConfigId, resumeWorkspaceSessionId, resumeWorkerBranch, forceFreshWorkspace }) =>
      sprintTaskDispatchService.startTask({
        task,
        projectId,
        sprintId,
        sprintRunId,
        sourceId,
        featureBranch,
        repoPath,
        sprintNumber,
        providerConfigId,
        resumeWorkspaceSessionId,
        resumeWorkerBranch,
        forceFreshWorkspace,
      }),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    persistMergedFlag: async (args) => {
      projectManagementRepository.updateTask(args.taskId, {
        isMerged: args.merged,
        mergeIndicator: args.merged ? "MERGED" : null,
      });
    },
    createResetTaskRun: async ({ taskId, projectId, sprintId, sprintRunId, reason }) => {
      const latestRun = executionRepository.getLatestTaskRun(taskId, sprintRunId)
        || executionRepository.getLatestTaskRun(taskId);
      const resetRun = executionRepository.createTaskRun({
        projectId,
        sprintId,
        taskId,
        sprintRunId,
        provider: latestRun?.provider ?? null,
        mode: latestRun?.mode ?? null,
        state: "PENDING",
      });
      executionRepository.appendTaskRunEvent(resetRun.id, "task_reset", "user", {
        taskId,
        reason,
      }, {
        sourceEventKey: `task-reset:${taskId}:${sprintRunId}:${reason}`,
      });
    },
    resumeSprintRun: async (sprintRunId) => {
      void sprintOrchestrator.recoverSprintRun(sprintRunId).catch((error) => {
        logger.warn("Failed to resume sprint orchestration after task rerun", {
          sprintRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    clearTaskWorktree: async ({ taskId, repoPath }) => {
      const latestRun = executionRepository.getLatestTaskRun(taskId);
      const sessionId = latestRun?.sessionId;
      if (!sessionId) return;
      const settings = latestRun.projectId
        ? settingsRepository.resolveProjectDashboardSettings(latestRun.projectId).settings
        : settingsRepository.getDefaultDashboardSettings();
      const executionMode = settings.cliWorkflow?.executionMode || "DOCKER";
      const wsManager = new WorkspaceManager();
      const worktreePath = wsManager.buildWorktreePath(repoPath, sessionId, executionMode);
      await wsManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
    },
    resolveTaskAttention: async ({ taskId, projectId }) => {
      projectAttentionService.resolveItemsForTask(projectId, taskId, [
        "worker_dispatch_blocked",
        "merge_required",
        "merge_conflict",
        "action_required",
        "manual_attention",
        "dashboard_reply_required",
        "human_escalation_required",
        "ci_fix_required",
      ], "task_rerun_reset");
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
          lastHeartbeatAt: now,
          errorMessage: "Cancelled: task rerun requested.",
        });
        const taskRun = executionRepository.getTaskRunByDispatchId(dispatch.id);
        if (taskRun) {
          executionRepository.updateTaskRun(taskRun.id, {
            state: "BLOCKED",
            finishedAt: now,
            durationMs: taskRun.startedAt
              ? Math.max(0, new Date(now).getTime() - new Date(taskRun.startedAt).getTime())
              : null,
          });
          executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_cancelled", "user", {
            dispatchId: dispatch.id,
            reason: "task_rerun_requested",
          }, {
            sourceEventKey: `task-rerun-cancel:${dispatch.id}`,
          });
        }
      }
    },
    logger: logger.child({ component: "task-rerun-service" }),
  });

  // Link the taskRerunService to the executionControlService and managementToolHandler
  (executionControlService as any).deps.taskRerunService = taskRerunService;
  (managementToolHandler as any).deps.taskRerunService = taskRerunService;

  const planningAgentService = new PlanningAgentService({
    projectManagementRepository,
    connectionChatRepository,
    executionRepository,
    settingsRepository,
    agentPresetSyncService,
    executionControlService,
    providerExecutionService,
    memoryService: coreDeps.memoryService,
    logger: logger.child({ component: "planning-agent-service" }),
  });

  (managementToolHandler as any).deps.planningAgentService = planningAgentService;

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

  const projectSetupService = new ProjectSetupService({
    projectManagementRepository,
    settingsRepository,
    executionRepository,
    agentPresetSyncService,
    quicksprintService,
    providerRunner,
    providerConcurrencyService: coreDeps.providerConcurrencyService,
    getGithubToken: () => context.getEffectiveGithubToken(),
    logger: logger.child({ component: "project-setup-service" }),
  });
  (managementToolHandler as any).deps.projectSetupService = projectSetupService;

  const schedulerService = new SchedulerService({
    schedulerRepository: coreDeps.schedulerRepository,
    projectManagementRepository,
    quicksprintService,
    chatThreadRuntimeService,
    executionControlService,
    logger: logger.child({ component: "scheduler-service" }),
  });

  return {
    chatThreadRuntimeService,
    activityCacheService,
    taskRerunService,
    executionControlService,
    planningAgentService,
    quicksprintService,
    projectSetupService,
    sprintIssueService: coreDeps.sprintIssueService,
    schedulerService,
    searchJiraIssues: coreDeps.sprintIssueService.searchJiraIssues.bind(coreDeps.sprintIssueService),
    replaceSprintLinkedIssues: projectManagementRepository.replaceSprintLinkedIssues.bind(projectManagementRepository),
    listSprintLinkedIssues: projectManagementRepository.listSprintLinkedIssues.bind(projectManagementRepository),
    closeSprintLinkedIssues: coreDeps.sprintIssueService.closeLinkedIssues.bind(coreDeps.sprintIssueService),
  };
}
