import { ServerContext } from "../dependency-factory.js";
import { CoreDependencies } from "./core-factory.js";
import { SprintDependencies } from "./sprint-factory.js";
import { ManagementToolHandler } from "../../mcp/management-tool-handler.js";
import { type DashboardSettings, type DashboardSettingsScope } from "../../contracts/app-types.js";
import { resolveEffectiveDashboardSettings } from "../../services/settings-resolution-service.js";

import type { DashboardDependencies } from "./dashboard-factory.js";

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

  const managementToolHandler = new ManagementToolHandler({
    sprintPreviewService: coreDeps.sprintPreviewService,
    executionRepository: coreDeps.executionRepository,
    getDashboardSettings: () => getDashboardSettings(),
    projectManagementRepository: coreDeps.projectManagementRepository,
    executionControlService: dashboardDeps.executionControlService,
    taskRerunService: dashboardDeps.taskRerunService,
    settingsRepository: coreDeps.settingsRepository,
    agentPresetSyncService: coreDeps.agentPresetSyncService,
    memoryService: coreDeps.memoryService,
    memoryPromotionService: coreDeps.memoryPromotionService,
    embeddingModelManager: coreDeps.embeddingModelManager,
    skillService: coreDeps.skillService,
    knowledgeService: coreDeps.knowledgeService,
    planningAgentService: dashboardDeps.planningAgentService,
    projectSetupService: dashboardDeps.projectSetupService,
    sprintIssueService: coreDeps.sprintIssueService,
    quicksprintService: dashboardDeps.quicksprintService,
    schedulerService: dashboardDeps.schedulerService,
  });

  return {
    managementToolHandler,
  };
}
