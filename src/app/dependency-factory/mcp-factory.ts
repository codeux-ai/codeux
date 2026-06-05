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
    knowledgeService: coreDeps.knowledgeService,
    planningAgentService: dashboardDeps.planningAgentService,
    projectSetupService: dashboardDeps.projectSetupService,
    sprintIssueService: coreDeps.sprintIssueService,
  });

  return {
    managementToolHandler,
  };
}
