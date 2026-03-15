import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { CoreToolHandler } from "../../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../../mcp/agent-tool-handler.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { WorkerTaskDispatchService } from "../../services/worker-task-dispatch-service.js";
import { WorkerDispatchExecutionService } from "../../services/worker-dispatch-execution-service.js";
import { WorkerInboxReplyService } from "../../services/worker-inbox-reply-service.js";
import { WorkerListenEventService } from "../../domain/workers/worker-listen-event-service.js";

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
    workerEndpointRepository,
    projectWorkerAssignmentService,
    projectAttentionService,
    workerAttentionOutcomeService,
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
    agentPresetSyncService,
  } = coreDeps;
  const { taskService } = sprintDeps;
  const workerTaskDispatchService = new WorkerTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    connectionChatRepository,
    workerEndpointRepository,
    projectWorkerAssignmentService,
    projectAttentionService,
    () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    logger.child({ component: "worker-task-dispatch-service" }),
  );

  const coreToolHandler = new CoreToolHandler({
    julesApi,
    activitySummary,
    normalizeName: (type, id) => context.normalizeName(type, id),
    resolveSessionName: (session) => context.resolveSessionName(session),
    fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    getMissingJulesApiKeyInstruction: () => context.getMissingJulesApiKeyInstruction(),
    isTrackedCliSession: (sessionId) => {
      const normalized = sessionId.startsWith("sessions/") ? sessionId : `sessions/${sessionId}`;
      return context.isTrackedCliSession(normalized);
    },
    getTrackedSession: (sessionId) => sessionTracking.getSession(sessionId),
    getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    connectionChatRepository,
    workerEndpointRepository,
    projectWorkerAssignmentService,
    projectAttentionService,
    workerAttentionOutcomeService,
    workerTaskDispatchService,
    workerListenEventService: new WorkerListenEventService(
      connectionChatRepository,
      workerEndpointRepository,
      projectManagementRepository,
      coreDeps.projectWorkerAssignmentRepository,
      coreDeps.projectAttentionRepository,
      executionRepository,
    ),
    logger: logger.child({ component: "core-tool-handler" }),
  });

  const agentToolHandler = new AgentToolHandler({
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
      agentPresetSyncService,
      getDashboardSettings: () => context.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => context.getEffectiveGithubToken(),
      logger: logger.child({ component: "worker-inbox-reply-service" }),
    }),
  });

  return {
    coreToolHandler,
    agentToolHandler,
  };
}
