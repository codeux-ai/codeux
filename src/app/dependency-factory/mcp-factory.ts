import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { ManagementToolHandler } from "../../mcp/management-tool-handler.js";
import { type DashboardSettings, type DashboardSettingsScope } from "../../contracts/app-types.js";
import { resolveEffectiveDashboardSettings } from "../../services/settings-resolution-service.js";

import type { DashboardDependencies } from "./dashboard-factory.js";
import { WorkerClarificationRepository } from "../../repositories/worker-clarification-repository.js";
import { WorkerClarificationService } from "../../services/worker-clarification-service.js";
import { WorkerClarificationContinuationService } from "../../services/worker-clarification-continuation-service.js";
import { isProjectManagerClarificationAgent } from "../../services/agent-mcp-access.js";

export interface McpDependencies {
  managementToolHandler: ManagementToolHandler;
}

export function createMcpDependencies(
  context: ServerContext,
  coreDeps: CoreDependencies,
  sprintDeps: SprintDependencies,
  dashboardDeps: DashboardDependencies
): McpDependencies {
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

    return effective.settings;
  };

  const workerClarificationService = new WorkerClarificationService(
    new WorkerClarificationRepository(coreDeps.projectAttentionRepository),
    coreDeps.projectManagementRepository,
    coreDeps.executionRepository,
  );
  const workerClarificationContinuationService = new WorkerClarificationContinuationService({
    clarificationService: workerClarificationService,
    taskRerunService: dashboardDeps.taskRerunService,
    executionRepository: coreDeps.executionRepository,
    projectManagementRepository: coreDeps.projectManagementRepository,
    sendJulesSessionMessage: async (sessionId, answerMarkdown) => {
      await coreDeps.julesApi.sendSessionMessage(sessionId, answerMarkdown);
    },
    isAuthorizedProjectManager: (projectId, agentId) => {
      if (agentId === "project-manager-mcp-client") return true;
      const agent = coreDeps.agentPresetRepository.getAgentPreset(agentId);
      if (!agent || agent.projectId !== projectId) return false;
      const settings = getDashboardSettings({ projectId });
      return isProjectManagerClarificationAgent({ agentId: agent.id, agentName: agent.name, settings });
    },
    resolveProviderConfigId: (projectId, taskAgentPresetId) => {
      const settings = getDashboardSettings({ projectId });
      const configuredAgentId = settings.agents.routing.taskCoding.mode === "MANUAL"
        ? settings.agents.routing.taskCoding.agentPresetId
        : null;
      const agentId = taskAgentPresetId || configuredAgentId;
      if (!agentId) return undefined;
      const agent = coreDeps.agentPresetRepository.getAgentPreset(agentId);
      return agent?.projectId === projectId ? agent.providerConfigId ?? undefined : undefined;
    },
  });

  const managementToolHandler = new ManagementToolHandler({
    sprintPreviewService: coreDeps.sprintPreviewService,
    customDashboardRepository: coreDeps.customDashboardRepository,
    customDashboardValidationService: coreDeps.customDashboardValidationService,
    executionRepository: coreDeps.executionRepository,
    getDashboardSettings: () => getDashboardSettings(),
    projectManagementRepository: coreDeps.projectManagementRepository,
    executionControlService: dashboardDeps.executionControlService,
    taskRerunService: dashboardDeps.taskRerunService,
    settingsRepository: coreDeps.settingsRepository,
    chatProviderRepository: coreDeps.chatProviderRepository,
    agentPresetSyncService: coreDeps.agentPresetSyncService,
    memoryService: coreDeps.memoryService,
    memoryPromotionService: coreDeps.memoryPromotionService,
    embeddingModelManager: coreDeps.embeddingModelManager,
    skillService: coreDeps.skillService,
    nodeFlowService: dashboardDeps.nodeFlowService,
    knowledgeService: coreDeps.knowledgeService,
    planningAgentService: dashboardDeps.planningAgentService,
    projectSetupService: dashboardDeps.projectSetupService,
    sprintIssueService: coreDeps.sprintIssueService,
    quicksprintService: dashboardDeps.quicksprintService,
    schedulerService: dashboardDeps.schedulerService,
    logger: coreDeps.logger.child({ component: "mcp-management-tool-handler" }),
    workerTaskDispatchService: sprintDeps.workerTaskDispatchService,
    workerClarificationService,
    workerClarificationContinuationService,
  });

  return {
    managementToolHandler,
  };
}
