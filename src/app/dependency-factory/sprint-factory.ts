import { AppConfig } from "../../config/app-config.js";
import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { CliWorkflowService } from "../../services/cli-workflow-service.js";
import { TaskService } from "../../services/task-service.js";
import { SprintOrchestrator } from "../../sprint/sprint-orchestrator.js";

export interface SprintDependencies {
  cliWorkflowService: CliWorkflowService;
  taskService: TaskService;
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
    subtaskRepository,
  } = coreDeps;

  const cliWorkflowService = new CliWorkflowService({
    sessionTracking,
    getDashboardSettings: () => context.getDashboardSettings(),
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
    getDashboardSettings: () => context.getDashboardSettings(),
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    cliWorkflowService,
    logger: logger.child({ component: "task-service" }),
  });

  const sprintOrchestrator = new SprintOrchestrator({
    settings: context.getSettings(),
    dashboardPort: options.appConfig.dashboardPort,
    getDashboardPort: () => context.getDashboardPort(),
    completedSprints: new Set(),
    getConsecutiveFailures: () => context.getConsecutiveFailures(),
    setConsecutiveFailures: (value) => context.setConsecutiveFailures(value),
    isActionRequiredState: (state) => context.isActionRequiredState(state),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
    listSessions: () => context.listSessionsForSync(),
    subtaskRepository,
    startTask: (task, sourceId, baseBranch, repoPath, sprintNumber) =>
      taskService.startSprintTask(task, sourceId, baseBranch, repoPath, sprintNumber),
    getGuideContent: (guideName, repoPath) => context.getGuideContentIfEnabled(guideName, repoPath),
    updateLastStatus: (status) => context.updateLastStatus(status),
    getDashboardSettings: () => context.getDashboardSettings(),
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
    sprintOrchestrator,
  };
}
