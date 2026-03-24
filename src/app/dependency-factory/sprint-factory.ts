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
import { WorkerInboxReplyService } from "../../services/worker-inbox-reply-service.js";
import type { DashboardSettings, DashboardSettingsScope } from "../../contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";

export interface SprintDependencies {
  cliWorkflowService: CliWorkflowService;
  taskService: TaskService;
  sprintExecutionStateService: SprintExecutionStateService;
  sprintTaskDispatchService: SprintTaskDispatchService;
  virtualWorkerService: VirtualWorkerService;
  workerInboxReplyService: WorkerInboxReplyService;
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
      effective = sprintId
        ? coreDeps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId)
        : coreDeps.settingsRepository.resolveProjectDashboardSettings(projectId);
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
        sprintId
          ? coreDeps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode
          : coreDeps.settingsRepository.resolveProjectDashboardSettings(projectId).settings.workers.executionMode
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
    logger: logger.child({ component: "virtual-worker-service" }),
  });

  const sprintTaskDispatchService = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService,
    (projectId) => virtualWorkerService.scheduleProject(projectId, "worker_dispatch_queued"),
    logger.child({ component: "sprint-task-dispatch-service" }),
  );

  const workerInboxReplyService = new WorkerInboxReplyService({
    projectManagementRepository,
    taskService,
    agentPresetSyncService,
    getDashboardSettings: resolveDashboardSettings,
    getGithubToken: () => context.getEffectiveGithubToken(),
    logger: logger.child({ component: "worker-inbox-reply-service" }),
  });

  projectAttentionService.setWorkerAttentionOpenedCallback((projectId) => {
    virtualWorkerService.scheduleProject(projectId, "worker_attention_opened");
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
    fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
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
    updateLastStatus: (status) => {
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
    sprintOrchestrator,
  };
}
