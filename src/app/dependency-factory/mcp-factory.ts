import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { CoreToolHandler } from "../../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../../mcp/agent-tool-handler.js";
import { formatSprintBranch } from "../../git/sprint-branch-scheme.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { WorkerTaskDispatchService } from "../../services/worker-task-dispatch-service.js";
import { WorkerSprintPreflightService } from "../../services/worker-sprint-preflight-service.js";
import { WorkerDispatchExecutionService } from "../../services/worker-dispatch-execution-service.js";
import { WorkerInboxReplyService } from "../../services/worker-inbox-reply-service.js";

export interface McpDependencies {
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
}

export function createMcpDependencies(
  context: ServerContext,
  coreDeps: CoreDependencies,
  sprintDeps: SprintDependencies
): McpDependencies {
  const {
    logger,
    julesApi,
    activitySummary,
    connectionChatRepository,
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
  } = coreDeps;
  const { sprintOrchestrator, taskService } = sprintDeps;
  const workerTaskDispatchService = new WorkerTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    connectionChatRepository,
    () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    logger.child({ component: "worker-task-dispatch-service" }),
  );
  const workerSprintPreflightService = new WorkerSprintPreflightService(
    executionRepository,
    projectManagementRepository,
    connectionChatRepository,
    sprintOrchestrator,
    () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    logger.child({ component: "worker-sprint-preflight-service" }),
  );

  const coreToolHandler = new CoreToolHandler({
    julesApi,
    activitySummary,
    normalizeName: (type, id) => context.normalizeName(type, id),
    resolveSessionName: (session) => context.resolveSessionName(session),
    fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
    isActionRequiredState: (state) => context.isActionRequiredState(state),
    getConsecutiveFailures: () => context.runtimeContext.consecutiveFailures,
    setConsecutiveFailures: (value) => { context.runtimeContext.consecutiveFailures = value; },
    getMaxFailures: () => context.runtimeContext.settings.maxFailures || 5,
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    getMissingJulesApiKeyInstruction: () => context.getMissingJulesApiKeyInstruction(),
    isTrackedCliSession: (sessionId) => {
      const normalized = sessionId.startsWith("sessions/") ? sessionId : `sessions/${sessionId}`;
      return context.isTrackedCliSession(normalized);
    },
    getTrackedSession: (sessionId) => sessionTracking.getSession(sessionId),
    listTrackedSessions: (limit) => sessionTracking.listSessions(limit),
    listTrackedActivities: (args) => sessionTracking.listActivities(args),
    listAllTrackedActivities: (sessionId) => sessionTracking.listAllActivities(sessionId),
    getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    connectionChatRepository,
    workerTaskDispatchService,
    workerSprintPreflightService,
    logger: logger.child({ component: "core-tool-handler" }),
  });

  const agentToolHandler = new AgentToolHandler({
    sprintOrchestrator,
    taskService,
    workerDispatchExecutionService: new WorkerDispatchExecutionService(
      executionRepository,
      projectManagementRepository,
      taskService,
      activeDispatchRegistry,
      julesApi,
      logger.child({ component: "worker-dispatch-execution-service" }),
    ),
    workerInboxReplyService: new WorkerInboxReplyService({
      projectManagementRepository,
      taskService,
      getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
      getGuideContent: (guideName, repoPath) => context.getGuideContentIfEnabled(guideName, repoPath),
      getGithubToken: () => context.getEffectiveGithubToken(),
      logger: logger.child({ component: "worker-inbox-reply-service" }),
    }),
    getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    formatSprintBranch,
    getConsecutiveFailures: () => context.runtimeContext.consecutiveFailures,
    setConsecutiveFailures: (value) => { context.runtimeContext.consecutiveFailures = value; },
    getMaxFailures: () => context.runtimeContext.settings.maxFailures || 5,
    waitForSessionCompletion: (args) => coreToolHandler.handleWaitForSessionCompletion(args),
  });

  return {
    coreToolHandler,
    agentToolHandler,
  };
}
