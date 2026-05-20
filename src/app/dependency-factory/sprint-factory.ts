import { AppConfig } from "../../config/app-config.js";
import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { CliWorkflowService } from "../../services/cli-workflow-service.js";
import { TaskService } from "../../services/task-service.js";
import { SprintExecutionStateService } from "../../services/sprint-execution-state-service.js";
import { SprintTaskDispatchService } from "../../services/sprint-task-dispatch-service.js";
import { WorkerTaskDispatchService } from "../../services/worker-task-dispatch-service.js";
import { VirtualWorkerService } from "../../services/virtual-worker-service.js";
import { SprintOrchestrator } from "../../sprint/sprint-orchestrator.js";
import { HeartbeatService } from "../../services/heartbeat-service.js";

import { WorkerInboxReplyService } from "../../services/worker-inbox-reply-service.js";
import { QualityAssuranceService } from "../../services/quality-assurance-service.js";
import { resolveEffectiveDashboardSettings } from "../../services/settings-resolution-service.js";
import type { DashboardSettings, DashboardSettingsScope, DashboardStatusSnapshot } from "../../contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { WorkspaceManager } from "../../infrastructure/providers/cli/workspace-manager.js";

export interface SprintDependencies {
  cliWorkflowService: CliWorkflowService;
  taskService: TaskService;
  sprintExecutionStateService: SprintExecutionStateService;
  sprintTaskDispatchService: SprintTaskDispatchService;
  virtualWorkerService: VirtualWorkerService;
  workerInboxReplyService: WorkerInboxReplyService;
  qualityAssuranceService: QualityAssuranceService;
  sprintOrchestrator: SprintOrchestrator;
}

export function createSprintDependencies(
  options: { projectRoot: string; appConfig: AppConfig },
  context: ServerContext,
  coreDeps: CoreDependencies
): SprintDependencies {
  const {
    logger,
    julesApi,
    sessionTracking,
    julesSourceResolver,
    agentPresetSyncService,
    instructionService,
    projectRuntimeRepository,
    projectManagementRepository,
    executionRepository,
    projectAttentionService,
    activeDispatchRegistry,
  } = coreDeps;

  const resolveDashboardSettings = (scope?: DashboardSettingsScope): DashboardSettings => {
    const projectId = scope?.projectId?.trim();
    const sprintId = scope?.sprintId?.trim();

    let effective: { settings: DashboardSettings; sources: Record<string, string> };
    if (projectId) {
      effective = resolveEffectiveDashboardSettings(coreDeps.settingsRepository, projectId, sprintId);
    } else {
      effective = {
        settings: context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
        sources: {},
      };
    }

    const settings = { ...effective.settings };
    const sources = effective.sources || {};

    if (projectId && sources["git.defaultBranch"] === "system") {
      const project = projectManagementRepository.getProject(projectId);
      if (project?.defaultBranch) {
        settings.git = { ...settings.git, defaultBranch: project.defaultBranch };
      }
    }

    return settings;
  };

  const cliWorkflowService = new CliWorkflowService({
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
    memoryService: coreDeps.memoryService,
    getDashboardSettings: resolveDashboardSettings,
    agentPresetSyncService,
    getGithubToken: () => context.getEffectiveGithubToken(),

    logger: logger.child({ component: "cli-workflow-service" }),
  });

  const taskService = new TaskService({
    julesApi,
    agentPresetSyncService,
    resolveJulesSourceId: (args) =>
      julesSourceResolver.resolveSourceId({
        repoPath: args.repoPath,
        requestedSourceId: args.sourceId,
      }),
    getDashboardSettings: resolveDashboardSettings,
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    cliWorkflowService,
    logger: logger.child({ component: "task-service" }),
  });

  const sprintExecutionStateService = new SprintExecutionStateService(
    projectManagementRepository,
    executionRepository,
  );

  const workerInboxReplyService = new WorkerInboxReplyService({
    projectManagementRepository,
    connectionChatRepository: coreDeps.connectionChatRepository,
    taskService,
    agentPresetSyncService,
    executionRepository,
    getDashboardSettings: resolveDashboardSettings,
    getGithubToken: () => context.getEffectiveGithubToken(),
    providerRunner: coreDeps.providerRunner,
    logger: logger.child({ component: "worker-inbox-reply-service" }),
  });

  const qualityAssuranceService = new QualityAssuranceService({
    projectManagementRepository,
    executionRepository,
    sessionTracking,
    qaReviewRepository: coreDeps.qaReviewRepository,
    taskService,
    agentPresetSyncService,
    providerRunner: coreDeps.providerRunner,
    getDashboardSettings: resolveDashboardSettings,
    getGithubToken: () => context.getEffectiveGithubToken(),
    sendSessionMessage: (sessionId, prompt) => julesApi.sendSessionMessage(sessionId, prompt),
    logger: logger.child({ component: "quality-assurance-service" }),
    memoryService: coreDeps.memoryService,
  });

  const virtualWorkerService = new VirtualWorkerService({
    settingsRepository: coreDeps.settingsRepository,
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    workerEndpointRepository: coreDeps.workerEndpointRepository,
    projectWorkerAssignmentRepository: coreDeps.projectWorkerAssignmentRepository,
    projectWorkerAssignmentService: coreDeps.projectWorkerAssignmentService,
    projectAttentionService,
    workerTaskDispatchService: new WorkerTaskDispatchService(
      executionRepository,
      projectManagementRepository,
      coreDeps.connectionChatRepository,
      coreDeps.workerEndpointRepository,
      coreDeps.projectWorkerAssignmentService,
      projectAttentionService,
      resolveDashboardSettings,
      (projectId, sprintId) => (
        resolveEffectiveDashboardSettings(coreDeps.settingsRepository, projectId, sprintId).settings.workers.executionMode
      ),
      logger.child({ component: "virtual-worker-task-dispatch-service" }),
      coreDeps.memoryService,
      async (projectId: string) => {
        try {
          const agent = await agentPresetSyncService.getWorkerAgent(projectId);
          return agent.id;
        } catch {
          return undefined;
        }
      },
    ),
    cliWorkflowService,
    sprintExecutionStateService,
    workerInboxReplyService,
    instructionService,
    approveSessionPlan: (sessionId) => julesApi.approveSessionPlan(sessionId),
    sendSessionMessage: (sessionId, prompt) => julesApi.sendSessionMessage(sessionId, prompt),
    memoryService: coreDeps.memoryService,
    agentPresetSyncService,
    logger: logger.child({ component: "virtual-worker-service" }),
  });

  const sprintTaskDispatchService = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService,
    logger.child({ component: "sprint-task-dispatch-service" }),
  );

  projectAttentionService.setWorkerAttentionOpenedCallback((projectId) => {
    virtualWorkerService.scheduleProject(projectId, "worker_attention_opened");
  });

  const heartbeatService = new HeartbeatService({
    executionRepository,
    logger: logger.child({ component: "heartbeat-service" }),
  });

  const sprintOrchestrator = new SprintOrchestrator({
    settings: context.runtimeContext.settings,
    dashboardPort: options.appConfig.dashboardPort,
    getDashboardPort: () => context.getDashboardPort(),
    completedSprints: new Set(),
    getConsecutiveFailures: () => context.runtimeContext.consecutiveFailures,
    setConsecutiveFailures: (value) => { context.runtimeContext.consecutiveFailures = value; },
    isActionRequiredState: (state) => context.isActionRequiredState(state),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    fetchRecentActivities: async (sessionName, pageSize) => {
      const activities = await context.fetchRecentActivities(sessionName, pageSize);
      return activities.map(a => coreDeps.activitySummary.toActivitySummary(a));
    },
    listAllActivities: async (sessionId: string) => {
      const activities = await coreDeps.julesApi.listAllActivities(sessionId);
      return activities.map(a => coreDeps.activitySummary.toActivitySummary(a));
    },
    getSession: (sessionId: string) => coreDeps.julesApi.getSession(sessionId),
    listSessions: () => context.listSessionsForSync(),
    projectManagementRepository,
    executionRepository,
    projectAttentionService,
    sprintExecutionStateService,
    startTask: (task, executionArgs) =>
      sprintTaskDispatchService.startTask({
        task,
        ...executionArgs,
      }),
    updateLastStatus: (status: DashboardStatusSnapshot) => {
      projectRuntimeRepository.syncDashboardStatus(status);
      context.runtimeContext.lastStatus = status;
    },
    getDashboardSettings: resolveDashboardSettings,
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    approveSessionPlan: (sessionId) => julesApi.approveSessionPlan(sessionId),
    sendSessionMessage: (sessionId, prompt) => julesApi.sendSessionMessage(sessionId, prompt),
    generateWorkerClarificationReply: (args) => workerInboxReplyService.generateClarificationReply(args),
    getCiStatusForScope: (args) => context.getCiStatusForScope(args),
    autoMergeFeaturePr: (args) => context.autoMergeFeaturePr(args),
    resolveOrCreateMainBranchPr: (args) => context.resolveOrCreateMainBranchPr(args),
    renderInstruction: (templateId, variables, repoPath) =>
      instructionService.render(templateId, variables, repoPath),
    logger: logger.child({ component: "sprint-orchestrator" }),
    memoryService: coreDeps.memoryService,
    memoryPromotionService: coreDeps.memoryPromotionService,
    qualityAssuranceService,
    sprintIssueService: coreDeps.sprintIssueService,
    taskService,
    heartbeatService,
    workspaceManager: new WorkspaceManager(),
    resolvePlanningAgentPresetId: async (projectId: string) => {
      try {
        const agent = await agentPresetSyncService.resolveTargetedPlanningAgent(projectId);
        return agent.id;
      } catch {
        return undefined;
      }
    },
  });

  return {
    cliWorkflowService,
    taskService,
    sprintExecutionStateService,
    sprintTaskDispatchService,
    virtualWorkerService,
    workerInboxReplyService,
    qualityAssuranceService,
    sprintOrchestrator,
  };
}
