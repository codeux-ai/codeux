import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { CoreToolHandler } from "../../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../../mcp/agent-tool-handler.js";
import { formatSprintBranch } from "../../git/sprint-branch-scheme.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";

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
    sessionTracking,
  } = coreDeps;
  const { sprintOrchestrator, taskService } = sprintDeps;

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
    logger: logger.child({ component: "core-tool-handler" }),
  });

  const agentToolHandler = new AgentToolHandler({
    sprintOrchestrator,
    taskService,
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
