import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../contracts/internal-management-types.js";
import type { SprintPreviewService } from "../services/sprint-preview-service.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../services/execution-control-service.js";
import type { TaskRerunService } from "../services/task-rerun-service.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { AgentPresetSyncService } from "../services/agent-preset-sync-service.js";
import type { MemoryService } from "../services/memory-service.js";
import type { MemoryPromotionService } from "../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../services/embedding-model-manager.js";

import { handlePreviewActions } from "./management/preview-actions.js";
import { handleTelemetryActions } from "./management/telemetry-actions.js";
import { handleProjectAction } from "./management/project-actions.js";
import { handleSprintAction } from "./management/sprint-actions.js";
import { TaskActions } from "./management/task-actions.js";
import { SettingsActions } from "./management/settings-actions.js";
import { AgentActions } from "./management/agent-actions.js";
import { MemoryActions } from "./management/memory-actions.js";

export interface ManagementToolHandlerDeps {
  sprintPreviewService: SprintPreviewService;
  executionRepository: ExecutionRepository;
  getDashboardSettings: () => DashboardSettings;
  projectManagementRepository: ProjectManagementRepository;
  executionControlService: ExecutionControlService;
  taskRerunService: TaskRerunService;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  embeddingModelManager: EmbeddingModelManager;
}

export class ManagementToolHandler {
  private readonly taskActions: TaskActions;
  private readonly settingsActions: SettingsActions;
  private readonly agentActions: AgentActions;
  private readonly memoryActions: MemoryActions;

  constructor(private readonly deps: ManagementToolHandlerDeps) {
    this.taskActions = new TaskActions(
      deps.projectManagementRepository,
      deps.executionControlService,
      deps.executionRepository,
      deps.taskRerunService
    );
    this.settingsActions = new SettingsActions(deps.settingsRepository);
    this.agentActions = new AgentActions(deps.agentPresetSyncService);
    this.memoryActions = new MemoryActions(deps.memoryService, deps.memoryPromotionService, deps.embeddingModelManager);
  }

  async handleManageCodeUx(args: ManageCodeUxArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      let envelope: ManagementResponseEnvelope;

      if (args.domain === "projects") {
        envelope = await handleProjectAction(
          args.action,
          args.payload,
          this.deps.projectManagementRepository,
          args.domain,
          args.approval
        );
      } else if (args.domain === "sprints") {
        envelope = await handleSprintAction(
          args.action,
          args.payload,
          this.deps.projectManagementRepository,
          this.deps.executionControlService,
          this.deps.executionRepository,
          args.domain,
          args.approval
        );
      } else if (args.domain === "tasks") {
        envelope = await this.taskActions.handleTaskAction(args);
      } else if (args.domain === "settings") {
        envelope = await this.settingsActions.handleSettingsAction(args);
      } else if (args.domain === "agents") {
        envelope = await this.agentActions.handleAgentAction(args);
      } else if (args.domain === "memory") {
        envelope = await this.memoryActions.handleMemoryAction(args);
      } else if (args.domain === "preview") {
        const currentHost = null; // serverHost is not available on DashboardSettings, we'll fall back to localhost in preview-origin
        envelope = await handlePreviewActions(args, this.deps.sprintPreviewService, currentHost);
      } else if (args.domain === "telemetry") {
        envelope = await handleTelemetryActions(args, this.deps.executionRepository);
      } else {
        const isDestructive = args.action.startsWith("delete_") || args.action.startsWith("reset_") || args.action.startsWith("replace_");

        if (isDestructive && args.approval?.confirmed !== true) {
          envelope = {
            approvalRequired: true,
            approvalMessage: `The action '${args.action}' is destructive and requires explicit approval. Please review the changes and call this tool again with approval.confirmed set to true.`,
          };
        } else {
          envelope = {
            result: {
              status: "success",
              domain: args.domain,
              action: args.action,
              message: `Domain ${args.domain} is not implemented yet.`,
            },
          };
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      const envelope: ManagementResponseEnvelope = {
        result: {
          status: "error",
          domain: args.domain,
          action: args.action,
          message: error instanceof Error ? error.message : String(error),
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    }
  }
}
