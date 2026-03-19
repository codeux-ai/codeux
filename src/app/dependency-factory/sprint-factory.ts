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
import type { DashboardSettings, DashboardSettingsScope } from "../../contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";

export interface SprintDependencies {
  cliWorkflowService: CliWorkflowService;
  taskService: TaskService;
  sprintExecutionStateService: SprintExecutionStateService;
  sprintTaskDispatchService: SprintTaskDispatchService;
  virtualWorkerService: VirtualWorkerService;
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

    if (projectId) {
      return sprintId
        ? coreDeps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings
        : coreDeps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
    }

    return context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
  };

  const cliWorkflowService = new CliWorkflowService({
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
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
    getCiStatusForScope: (args) => context.getCiStatusForScope(args),
    autoMergeFeaturePr: (args) => context.autoMergeFeaturePr(args),
    renderInstruction: (templateId, variables, repoPath) =>
      instructionService.render(templateId, variables, repoPath),
    logger: logger.child({ component: "sprint-orchestrator" }),
  });

  return {
    cliWorkflowService,
    taskService,
    sprintExecutionStateService,
    sprintTaskDispatchService,
    virtualWorkerService,
    sprintOrchestrator,
  };
}
