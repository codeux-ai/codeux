import { AppConfig } from "../../config/app-config.js";
import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { CliWorkflowService } from "../../services/cli-workflow-service.js";
import { TaskService } from "../../services/task-service.js";
import { SprintExecutionStateService } from "../../services/sprint-execution-state-service.js";
import { SprintTaskDispatchService } from "../../services/sprint-task-dispatch-service.js";
import { SprintOrchestrator } from "../../sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";

export interface SprintDependencies {
  cliWorkflowService: CliWorkflowService;
  taskService: TaskService;
  sprintExecutionStateService: SprintExecutionStateService;
  sprintTaskDispatchService: SprintTaskDispatchService;
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
    instructionService,
    projectRuntimeRepository,
    projectManagementRepository,
    executionRepository,
    projectAttentionService,
    activeDispatchRegistry,
  } = coreDeps;

  const cliWorkflowService = new CliWorkflowService({
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
    getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    getGuideContent: (guideName: string, repoPath?: string) => context.getGuideContentIfEnabled(guideName, repoPath),
    getGithubToken: () => context.getEffectiveGithubToken(),
    logger: logger.child({ component: "cli-workflow-service" }),
  });

  const taskService = new TaskService({
    julesApi,
    guideRepository: {
      getGuideContent: (guideName: string, repoPath?: string) => context.getGuideContentIfEnabled(guideName, repoPath),
    },
    resolveJulesSourceId: (args) =>
      julesSourceResolver.resolveSourceId({
        repoPath: args.repoPath,
        requestedSourceId: args.sourceId,
      }),
    getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    cliWorkflowService,
    logger: logger.child({ component: "task-service" }),
  });

  const sprintExecutionStateService = new SprintExecutionStateService(
    projectManagementRepository,
    executionRepository,
  );

  const sprintTaskDispatchService = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService,
    logger.child({ component: "sprint-task-dispatch-service" }),
  );

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
    getGuideContent: (guideName, repoPath) => context.getGuideContentIfEnabled(guideName, repoPath),
    updateLastStatus: (status) => {
      projectRuntimeRepository.syncDashboardStatus(status);
      context.runtimeContext.lastStatus = status;
    },
    getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
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
    sprintOrchestrator,
  };
}
