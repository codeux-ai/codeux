import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import type { DashboardSettings, DashboardSettingsScope } from "../../contracts/app-types.js";
import { ActivityCacheService } from "../../server/activity-cache-service.js";
import { TaskRerunService } from "../../services/task-rerun-service.js";
import { ExecutionControlService } from "../../services/execution-control-service.js";
import { PlanningAgentService } from "../../services/planning-agent-service.js";
import { QuicksprintService } from "../../services/quicksprint-service.js";
import { ProjectSetupService } from "../../services/project-setup-service.js";
import { ProjectDocsAutoEmbedService } from "../../services/project-docs-auto-embed-service.js";
import { WorkspaceManager } from "../../infrastructure/providers/cli/workspace-manager.js";
import { formatSprintBranch } from "../../domain/sprint/branch-name-generator.js";

import { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";
import { ManagementToolHandler } from "../../mcp/management-tool-handler.js";
import { WorkerClarificationRepository } from "../../repositories/worker-clarification-repository.js";
import { WorkerClarificationService } from "../../services/worker-clarification-service.js";
import { StructuredProviderResponseService } from "../../services/structured-provider-response-service.js";
import { StructuredAgentRequestService } from "../../services/structured-agent-request-service.js";
import { AgentBaseUpdateService } from "../../services/agent-base-update-service.js";
import { ChatManagementActionService } from "../../services/chat-management-action-service.js";
import { ProviderExecutionService } from "../../services/provider-execution-service.js";
import { SchedulerService } from "../../services/scheduler-service.js";
import { ExecutionInvocationControlService } from "../../services/execution-invocation-control-service.js";
import { createLateBoundDependency } from "../../shared/late-bound-dependency.js";
import { ChatProviderIngressService } from "../../services/chat-provider-ingress-service.js";
import { ChatProviderOutboundService } from "../../services/chat-provider-outbound-service.js";
import { ChatProviderSessionRuntimeService } from "../../services/chat-provider-session-runtime-service.js";
import { SpeechTranscriptionService } from "../../services/speech-transcription-service.js";
import { SpeechSynthesisService } from "../../services/speech-synthesis-service.js";
import { SpeechModelManager } from "../../services/speech-model-manager.js";
import { SprintRollbackService } from "../../services/sprint-rollback-service.js";
import { NodeFlowRuntimeService } from "../../services/node-flow-runtime-service.js";
import { NodeFlowService } from "../../services/node-flow-service.js";
import { NodeFlowRecoveryService } from "../../services/node-flows/node-flow-recovery-service.js";
import { resolveEffectiveDashboardSettings } from "../../services/settings-resolution-service.js";
import { ApprovalService } from "../../services/node-flows/approval-service.js";
import { MockSideEffectProvider, OutboxService } from "../../services/node-flows/outbox-service.js";
import { EgressPolicyService } from "../../services/node-flows/egress-policy-service.js";
import { AutomationApprovalRepository } from "../../repositories/automation-approval-repository.js";
import { AutomationOutboxRepository } from "../../repositories/automation-outbox-repository.js";
import { AutomationWebhookTriggerRepository } from "../../repositories/automation-webhook-trigger-repository.js";
import { CustomNodeRepository } from "../../repositories/custom-node-repository.js";
import { CustomNodeRuntimeService } from "../../services/custom-nodes/custom-node-runtime-service.js";
import { CustomNodeProjectService } from "../../services/custom-nodes/custom-node-project-service.js";
import { CustomNodeBuildService } from "../../services/custom-nodes/custom-node-build-service.js";
import { customNodeDefinitionFromArtifact } from "../../contracts/custom-node-types.js";
import { registerCustomNodeDefinition } from "../../domain/node-flows/node-definition-registry.js";

export interface DashboardDependencies {
  credentialBroker: CoreDependencies["credentialBroker"];
  headlessAuthService: CoreDependencies["headlessAuthService"];
  automationAuditService: CoreDependencies["automationAuditService"];
  headlessReadinessService: CoreDependencies["headlessReadinessService"];
  automationSloService: CoreDependencies["automationSloService"];
  chatThreadRuntimeService: ChatThreadRuntimeService;
  chatProviderRepository: CoreDependencies["chatProviderRepository"];
  chatProviderSecretService: CoreDependencies["chatProviderSecretService"];
  chatProviderVerificationService: CoreDependencies["chatProviderVerificationService"];
  chatConnectorRegistry: CoreDependencies["chatConnectorRegistry"];
  chatProviderIngressService: ChatProviderIngressService;
  chatProviderOutboundService: ChatProviderOutboundService;
  chatProviderSessionRuntimeService: ChatProviderSessionRuntimeService;
  speechTranscriptionService: SpeechTranscriptionService;
  speechSynthesisService: SpeechSynthesisService;
  speechModelManager: SpeechModelManager;
  nodeFlowService: CoreDependencies["nodeFlowService"];
  approvalService: ApprovalService;
  automationWebhookTriggerRepository: CoreDependencies["automationWebhookTriggerRepository"];
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  executionControlService: ExecutionControlService;
  executionInvocationControlService: ExecutionInvocationControlService;
  planningAgentService: PlanningAgentService;
  agentBaseUpdateService: AgentBaseUpdateService;
  quicksprintService: QuicksprintService;
  projectSetupService: ProjectSetupService;
  sprintIssueService: CoreDependencies["sprintIssueService"];
  schedulerService: SchedulerService;
  sprintRollbackService: SprintRollbackService;
  searchJiraIssues: CoreDependencies["sprintIssueService"]["searchJiraIssues"];
  searchJiraProjectStatuses: CoreDependencies["sprintIssueService"]["searchJiraProjectStatuses"];
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
    chatProviderRepository,
    chatProviderSecretService,
    chatProviderVerificationService,
    chatConnectorRegistry,
    projectWorkerAssignmentRepository,
    projectAttentionService,
    agentPresetSyncService,
    executionRepository,
    settingsRepository,
    julesApi,
    activeDispatchRegistry,
    providerRunner,
  } = coreDeps;
  const { sprintTaskDispatchService, sprintOrchestrator, taskService, memoryRemediationService } = sprintDeps;
  const taskRerunServiceRef = createLateBoundDependency<TaskRerunService>("dashboard task rerun service");
  const planningAgentServiceRef = createLateBoundDependency<PlanningAgentService>("dashboard planning agent service");
  const quicksprintServiceRef = createLateBoundDependency<QuicksprintService>("dashboard quicksprint service");
  const projectSetupServiceRef = createLateBoundDependency<ProjectSetupService>("dashboard project setup service");
  const schedulerServiceRef = createLateBoundDependency<SchedulerService>("dashboard scheduler service");
  const resolveDashboardSettings = (scope?: DashboardSettingsScope): DashboardSettings => {
    const projectId = scope?.projectId?.trim();
    const sprintId = scope?.sprintId?.trim();

    return projectId
      ? resolveEffectiveDashboardSettings(settingsRepository, projectId, sprintId).settings
      : settingsRepository.getDefaultDashboardSettings();
  };

  const executionControlService = new ExecutionControlService({
    projectManagementRepository,
    executionRepository,
    projectAttentionService,
    taskRerunService: taskRerunServiceRef,
    sprintOrchestrator,
    julesApi,
    activeDispatchRegistry,
    sprintRunLifecycleService: coreDeps.sprintRunLifecycleService,
    qaReviewRepository: coreDeps.qaReviewRepository,
    logger: logger.child({ component: "execution-control-service" }),
  });
  const executionInvocationControlService = new ExecutionInvocationControlService({
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
    logger: logger.child({ component: "execution-invocation-control-service" }),
  });
  const sprintRollbackService = new SprintRollbackService({
    projectManagementRepository,
    settingsRepository,
    orchestrateSprint: (projectId, sprintId) => executionControlService.orchestrateSprint(projectId, sprintId),
    getGitAuth: () => ({
      githubToken: context.getEffectiveGithubToken(),
      gitlabToken: context.getEffectiveGitlabToken(),
    }),
    logger: logger.child({ component: "sprint-rollback-service" }),
  });

  const chatProviderOutboundService = new ChatProviderOutboundService({
    chatProviderRepository,
    chatProviderSecretService,
    connectorRegistry: chatConnectorRegistry,
    logger: logger.child({ component: "chat-provider-outbound-service" }),
  });
  const chatProviderSessionRuntimeService = new ChatProviderSessionRuntimeService({
    chatProviderRepository,
    chatProviderSecretService,
    connectorRegistry: chatConnectorRegistry,
    logger: logger.child({ component: "chat-provider-session-runtime-service" }),
  });

  const managementToolHandler = new ManagementToolHandler({
    sprintPreviewService: coreDeps.sprintPreviewService,
    customDashboardRepository: coreDeps.customDashboardRepository,
    customDashboardCredentialBindingService: coreDeps.customDashboardCredentialBindingService,
    customDashboardValidationService: coreDeps.customDashboardValidationService,
    executionRepository: coreDeps.executionRepository,
    getDashboardSettings: () => resolveDashboardSettings(),
    projectManagementRepository: coreDeps.projectManagementRepository,
    executionControlService,
    taskRerunService: taskRerunServiceRef,
    settingsRepository: coreDeps.settingsRepository,
    chatProviderRepository: coreDeps.chatProviderRepository,
    chatProviderSecretService: coreDeps.chatProviderSecretService,
    chatProviderVerificationService: coreDeps.chatProviderVerificationService,
    chatProviderOutboundService,
    chatConnectorRegistry: coreDeps.chatConnectorRegistry,
    headlessAuthService: coreDeps.headlessAuthService,
    agentPresetRepository: coreDeps.agentPresetRepository,
    agentPresetSyncService: coreDeps.agentPresetSyncService,
    memoryService: coreDeps.memoryService,
    memoryPromotionService: coreDeps.memoryPromotionService,
    embeddingModelManager: coreDeps.embeddingModelManager,
    skillService: coreDeps.skillService,
    nodeFlowService: coreDeps.nodeFlowService,
    knowledgeService: coreDeps.knowledgeService,
    planningAgentService: planningAgentServiceRef,
    projectSetupService: projectSetupServiceRef,
    sprintIssueService: coreDeps.sprintIssueService,
    quicksprintService: quicksprintServiceRef,
    schedulerService: schedulerServiceRef,
    logger: logger.child({ component: "mcp-management-tool-handler" }),
    workerClarificationService: new WorkerClarificationService(
      new WorkerClarificationRepository(coreDeps.projectAttentionRepository),
      projectManagementRepository,
      executionRepository,
    ),
  });

  const providerExecutionService = new ProviderExecutionService({
    executionRepository,
    sessionTracking: coreDeps.sessionTracking,
    providerRunner,
    providerConcurrencyService: coreDeps.providerConcurrencyService,
    logger: logger.child({ component: "provider-execution-service" }),
    getMcpConnectionInfo: () => context.getMcpConnectionInfo?.() ?? null,
    skillService: coreDeps.skillService,
    agentPresetRepository: coreDeps.agentPresetRepository,
    getDashboardSettings: resolveDashboardSettings,
  });

  const structuredProviderResponseService = new StructuredProviderResponseService({
    providerExecutionService,
    executionRepository,
    logger: logger.child({ component: "structured-provider-response-service" }),
  });
  const structuredAgentRequestService = new StructuredAgentRequestService({
    executionRepository,
    structuredProviderResponseService,
    logger: logger.child({ component: "structured-agent-request-service" }),
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
    getDashboardSettings: resolveDashboardSettings,
    getGithubToken: () => context.getEffectiveGithubToken(),
    agentPresetSyncService,
    projectManagementRepository,
    providerRunner,
    providerExecutionService,
    chatManagementActionService,
    chatProviderOutboundService,
    knowledgeService: coreDeps.knowledgeService,
    getMcpConnectionInfo: context.getMcpConnectionInfo,
    getMcpApprovalTracker: context.getMcpApprovalTracker,
    runDueSchedulerEntriesAfterReply: async () => {
      if (!schedulerServiceRef.isLinked()) {
        return;
      }
      await schedulerServiceRef.get().runDueEntries();
    },
    logger: logger.child({ component: "chat-thread-runtime-service" }),
  });

  const chatProviderIngressService = new ChatProviderIngressService({
    chatProviderRepository,
    chatProviderSecretService,
    connectorRegistry: chatConnectorRegistry,
    chatThreadRuntimeService,
    logger: logger.child({ component: "chat-provider-ingress-service" }),
  });
  const speechTranscriptionService = new SpeechTranscriptionService({
    settingsRepository,
    logger: logger.child({ component: "speech-transcription-service" }),
  });
  const speechSynthesisService = new SpeechSynthesisService({
    settingsRepository,
    logger: logger.child({ component: "speech-synthesis-service" }),
  });
  const speechModelManager = new SpeechModelManager(
    logger.child({ component: "speech-model-manager" }),
  );
  const approvalRepository = coreDeps.automationApprovalRepository
    ?? new AutomationApprovalRepository(coreDeps.appDbStorage);
  const outboxRepository = coreDeps.automationOutboxRepository
    ?? new AutomationOutboxRepository(coreDeps.appDbStorage);
  const webhookTriggerRepository = coreDeps.automationWebhookTriggerRepository
    ?? new AutomationWebhookTriggerRepository(coreDeps.appDbStorage);
  const approvalService = new ApprovalService(approvalRepository, coreDeps.automationAuditService);
  const egressPolicyService = new EgressPolicyService();
  const customNodeRepository = new CustomNodeRepository(coreDeps.appDbStorage);
  const customNodeProjectService = new CustomNodeProjectService();
  const customNodeBuildService = new CustomNodeBuildService({ repository: customNodeRepository, projectService: customNodeProjectService });
  for (const { artifact } of customNodeRepository.listPublications()) {
    registerCustomNodeDefinition(customNodeDefinitionFromArtifact(artifact));
  }
  const customNodeRuntimeService = new CustomNodeRuntimeService({
    repository: customNodeRepository,
    credentialBroker: coreDeps.credentialBroker,
    egressPolicyService,
  });
  const nodeFlowRuntimeService = new NodeFlowRuntimeService({
    nodeFlowRepository: coreDeps.nodeFlowRepository,
    executionRepository,
    projectManagementRepository,
    settingsRepository,
    providerExecutionService,
    credentialBroker: coreDeps.credentialBroker,
    egressPolicyService,
    customNodeRuntimeService,
    approvalService,
    outboxService: new OutboxService(outboxRepository, new MockSideEffectProvider(), coreDeps.automationAuditService),
    auditService: coreDeps.automationAuditService,
    getDashboardSettings: (projectId) => resolveDashboardSettings({ projectId }),
  });
  if (coreDeps.nodeFlowRepository) {
    const recoveryService = new NodeFlowRecoveryService(coreDeps.nodeFlowRepository, approvalService, nodeFlowRuntimeService);
    recoveryService.recover();
    void recoveryService.resumeDecidedApprovals().catch((error: unknown) => {
      logger.error("Failed to resume a decided node-flow approval during startup recovery", { error: error instanceof Error ? error.message : String(error) });
    });
  }
  const nodeFlowService = new NodeFlowService(coreDeps.nodeFlowRepository, nodeFlowRuntimeService, coreDeps.credentialBroker, {
    repository: customNodeRepository,
    projectService: customNodeProjectService,
    buildService: customNodeBuildService,
    resolveProjectRoot: (projectId) => {
      const project = coreDeps.projectManagementRepository.getProject(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      return project.baseDir;
    },
  });

  const activityCacheService = new ActivityCacheService(
    {
      getSubtasks: () => projectRuntimeRepository.getSelectedProjectLiveStatus().subtasks,
      resolveSessionNameFromTask: (task) => context.resolveSessionNameFromTask(task),
      fetchRecentActivities: (sessionName, pageSize, signal) => context.fetchRecentActivities(sessionName, pageSize, signal),
      resolveGitStatusRepoPath: () => context.resolveGitStatusRepoPath(),
      fetchGitStatusForRepo: (repoPath, cacheTtlMs) => context.fetchGitStatusForRepo(repoPath, cacheTtlMs),
      invalidateGitStatusCache: (repoPath) => context.invalidateGitStatusCache?.(repoPath),
      isSessionTerminal: (sessionName) => executionRepository.isSessionTerminal(sessionName),
      logger: logger.child({ component: "activity-cache-service" }),
    },
    10_000, // LIVE_ACTIVITY_CACHE_MS
    10_000, // GIT_STATUS_CACHE_MS
    20,     // DASHBOARD_ACTIVITY_PAGE_SIZE
    2       // ACTIVITY_FETCH_CONCURRENCY
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
      const latestWorkspaceBinding = executionRepository.getLatestTaskWorkspaceResumeTarget?.(taskId);
      if (latestWorkspaceBinding?.sessionId || latestWorkspaceBinding?.workerBranch) {
        resolvedTask.session_id = latestWorkspaceBinding.sessionId || undefined;
        resolvedTask.session_name = latestWorkspaceBinding.sessionName || undefined;
        resolvedTask.worker_branch = latestWorkspaceBinding.workerBranch || resolvedTask.worker_branch;
        resolvedTask.pr_url = latestWorkspaceBinding.prUrl || resolvedTask.pr_url;
      }
      if (!resolvedTask.session_id && !resolvedTask.worker_branch) {
        const latestWorkspaceRun = executionRepository.getLatestTaskRunWithWorkspace?.(taskId);
        if (latestWorkspaceRun?.sessionId || latestWorkspaceRun?.workerBranch) {
          resolvedTask.session_id = latestWorkspaceRun.sessionId || undefined;
          resolvedTask.session_name = latestWorkspaceRun.sessionName || undefined;
          resolvedTask.worker_branch = latestWorkspaceRun.workerBranch || undefined;
          resolvedTask.pr_url = latestWorkspaceRun.prUrl || undefined;
        }
      }

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

      const created = coreDeps.sprintRunLifecycleService.createRun({
        projectId,
        sprintId,
        triggerType: "dashboard",
        triggeredBy: "task_rerun",
        executorMode: "mixed",
        status: "running",
      });
      coreDeps.sprintRunLifecycleService.markRunning(created.id, {
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      });
      return { sprintRunId: created.id, created: true };
    },
    startTask: ({ task, projectId, sprintId, sprintRunId, sourceId, featureBranch, repoPath, sprintNumber, providerConfigId, resumeWorkspaceSessionId, resumeWorkerBranch, forceFreshWorkspace, requireProviderSessionResume, clarificationContinuationId }) =>
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
        requireProviderSessionResume,
        clarificationContinuationId,
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
    resetTaskQaState: ({ taskId }) => {
      // A manual rerun is a fresh attempt — clear the prior QA verdict budget and
      // guardrail ledger so the new run is reviewed instead of being blocked or
      // escalated on the previous attempt's exhausted/changes-requested history.
      coreDeps.qaReviewRepository.resetTaskReviewRuns(taskId);
      coreDeps.guardrailService.reset(taskId);
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

  taskRerunServiceRef.set(taskRerunService);

  const planningAgentService = new PlanningAgentService({
    projectManagementRepository,
    connectionChatRepository,
    executionRepository,
    settingsRepository,
    agentPresetSyncService,
    executionControlService,
    providerExecutionService,
    structuredAgentRequestService,
    memoryService: coreDeps.memoryService,
    logger: logger.child({ component: "planning-agent-service" }),
  });

  planningAgentServiceRef.set(planningAgentService);
  sprintOrchestrator.setUnplannedSprintPlanner((projectId, sprintId) => (
    planningAgentService.startPlanSprint(projectId, sprintId, {
      autoStart: true,
      replan: false,
    })
  ));

  const agentBaseUpdateService = new AgentBaseUpdateService({
    projectManagementRepository,
    settingsRepository,
    agentPresetSyncService,
    structuredAgentRequestService,
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
    {
      projectRoot: typeof context.getProjectRoot === "function" ? context.getProjectRoot() : process.cwd(),
      logger: logger.child({ component: "quicksprint-service" }),
    },
  );
  quicksprintServiceRef.set(quicksprintService);
  chatThreadRuntimeService.setQuicksprintLauncher(quicksprintService);

  const projectSetupService = new ProjectSetupService({
    projectManagementRepository,
    settingsRepository,
    executionRepository,
    agentPresetSyncService,
    quicksprintService,
    providerRunner,
    providerConcurrencyService: coreDeps.providerConcurrencyService,
    projectDocsAutoEmbedService: new ProjectDocsAutoEmbedService(coreDeps.knowledgeService),
    projectRoot: typeof context.getProjectRoot === "function" ? context.getProjectRoot() : process.cwd(),
    getGithubToken: () => context.getEffectiveGithubToken(),
    logger: logger.child({ component: "project-setup-service" }),
  });
  projectSetupServiceRef.set(projectSetupService);

  const schedulerService = new SchedulerService({
    schedulerRepository: coreDeps.schedulerRepository,
    projectManagementRepository,
    executionRepository,
    quicksprintService,
    chatThreadRuntimeService,
    executionControlService,
    taskRerunService,
    memoryRemediationService,
    nodeFlowRuntimeService,
    nodeFlowRepository: coreDeps.nodeFlowRepository,
    logger: logger.child({ component: "scheduler-service" }),
  });
  schedulerServiceRef.set(schedulerService);

  return {
    credentialBroker: coreDeps.credentialBroker,
    headlessAuthService: coreDeps.headlessAuthService,
    automationAuditService: coreDeps.automationAuditService,
    headlessReadinessService: coreDeps.headlessReadinessService,
    automationSloService: coreDeps.automationSloService,
    chatProviderRepository,
    chatProviderSecretService,
    chatProviderVerificationService,
    chatConnectorRegistry,
    chatThreadRuntimeService,
    chatProviderIngressService,
    chatProviderOutboundService,
    chatProviderSessionRuntimeService,
    speechTranscriptionService,
    speechSynthesisService,
    speechModelManager,
    nodeFlowService,
    approvalService,
    automationWebhookTriggerRepository: webhookTriggerRepository,
    activityCacheService,
    taskRerunService,
    executionControlService,
    executionInvocationControlService,
    planningAgentService,
    agentBaseUpdateService,
    quicksprintService,
    projectSetupService,
    sprintIssueService: coreDeps.sprintIssueService,
    schedulerService,
    sprintRollbackService,
    searchJiraIssues: coreDeps.sprintIssueService.searchJiraIssues.bind(coreDeps.sprintIssueService),
    searchJiraProjectStatuses: coreDeps.sprintIssueService.searchJiraProjectStatuses?.bind(coreDeps.sprintIssueService)
      ?? (() => {
        throw new Error("Jira project status search is not available.");
      }),
    replaceSprintLinkedIssues: projectManagementRepository.replaceSprintLinkedIssues.bind(projectManagementRepository),
    listSprintLinkedIssues: projectManagementRepository.listSprintLinkedIssues.bind(projectManagementRepository),
    closeSprintLinkedIssues: coreDeps.sprintIssueService.closeLinkedIssues.bind(coreDeps.sprintIssueService),
  };
}
