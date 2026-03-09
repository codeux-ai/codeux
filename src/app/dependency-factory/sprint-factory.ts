import { AppConfig } from "../../config/app-config.js";
import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { CliWorkflowService } from "../../services/cli-workflow-service.js";
import { SprintExecutionBridgeService } from "../../services/sprint-execution-bridge-service.js";
import { TaskService } from "../../services/task-service.js";
import { SprintOrchestrator } from "../../sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";

export interface SprintDependencies {
  cliWorkflowService: CliWorkflowService;
  taskService: TaskService;
  sprintExecutionBridgeService: SprintExecutionBridgeService;
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
    projectManagementRepository,
    projectRuntimeRepository,
    subtaskRepository,
  } = coreDeps;

  const cliWorkflowService = new CliWorkflowService({
    sessionTracking,
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

  const sprintExecutionBridgeService = new SprintExecutionBridgeService(
    projectManagementRepository,
    projectRuntimeRepository,
    logger.child({ component: "sprint-execution-bridge-service" })
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
    subtaskRepository,
    startTask: (task, sourceId, baseBranch, repoPath, sprintNumber) =>
      taskService.startSprintTask(task, sourceId, baseBranch, repoPath, sprintNumber),
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
    sprintExecutionBridgeService,
    logger: logger.child({ component: "sprint-orchestrator" }),
  });

  return {
    cliWorkflowService,
    taskService,
    sprintExecutionBridgeService,
    sprintOrchestrator,
  };
}
