import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { CoreToolHandler } from "../../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../../mcp/agent-tool-handler.js";
import { ManagementToolHandler } from "../../mcp/management-tool-handler.js";
import { type DashboardSettings, type DashboardSettingsScope } from "../../contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { WorkerTaskDispatchService } from "../../services/worker-task-dispatch-service.js";
import { WorkerDispatchExecutionService } from "../../services/worker-dispatch-execution-service.js";
import { WorkerListenEventService } from "../../domain/workers/worker-listen-event-service.js";
import { resolveEffectiveDashboardSettings } from "../../services/settings-resolution-service.js";

import type { DashboardDependencies } from "./dashboard-factory.js";

export interface McpDependencies {
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
  managementToolHandler: ManagementToolHandler;
}

export function createMcpDependencies(
  context: ServerContext,
  coreDeps: CoreDependencies,
  sprintDeps: SprintDependencies,
  dashboardDeps: DashboardDependencies
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
  const resolveWorkerExecutionMode = (projectId: string, sprintId?: string | null) => (
    resolveEffectiveDashboardSettings(coreDeps.settingsRepository, projectId, sprintId).settings.workers.executionMode
  );

  const getDashboardSettings = (scope?: DashboardSettingsScope): DashboardSettings => {
    let effective: { settings: DashboardSettings; sources: Record<string, string> };
    if (scope?.projectId) {
      effective = resolveEffectiveDashboardSettings(coreDeps.settingsRepository, scope.projectId, scope.sprintId);
    } else {
      effective = {
        settings: context.runtimeContext.dashboardSettings || coreDeps.settingsRepository.getDefaultDashboardSettings(),
        sources: {},
      };
    }

    const settings = { ...effective.settings };
    const sources = effective.sources || {};

    // If git.defaultBranch is from system, allow project metadata to override it.
    if (scope?.projectId && sources["git.defaultBranch"] === "system") {
      const project = coreDeps.projectManagementRepository.getProject(scope.projectId);
      if (project?.defaultBranch) {
        settings.git = { ...settings.git, defaultBranch: project.defaultBranch };
      }
    }

    return settings;
  };

  const workerTaskDispatchService = new WorkerTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    connectionChatRepository,
    workerEndpointRepository,
    projectWorkerAssignmentService,
    projectAttentionService,
    getDashboardSettings,
    resolveWorkerExecutionMode,
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
      getDashboardSettings,
      resolveWorkerExecutionMode,
    ),
    resolveWorkerExecutionMode,
    logger: logger.child({ component: "core-tool-handler" }),
  });

  const agentToolHandler = new AgentToolHandler({
    workerDispatchExecutionService: new WorkerDispatchExecutionService(
      executionRepository,
      projectManagementRepository,
      taskService,
      activeDispatchRegistry,
      julesApi,
      getDashboardSettings,
      logger.child({ component: "worker-dispatch-execution-service" }),
    ),
    workerInboxReplyService: sprintDeps.workerInboxReplyService,
  });

  const managementToolHandler = new ManagementToolHandler({
    getSprintPreviewService: context.getSprintPreviewService,
    executionRepository: coreDeps.executionRepository,
    getDashboardSettings: () => getDashboardSettings(),
    projectManagementRepository: coreDeps.projectManagementRepository,
    executionControlService: dashboardDeps.executionControlService,
    getTaskRerunService: () => dashboardDeps.taskRerunService,
    settingsRepository: coreDeps.settingsRepository,
    agentPresetSyncService: coreDeps.agentPresetSyncService,
    memoryService: coreDeps.memoryService,
    memoryPromotionService: coreDeps.memoryPromotionService,
    embeddingModelManager: coreDeps.embeddingModelManager,
  });

  return {
    coreToolHandler,
    agentToolHandler,
    managementToolHandler,
  };
}
