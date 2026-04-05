import type { ManageSprintOsArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { AgentPresetSyncService } from "../../services/agent-preset-sync-service.js";

export class AgentActions {
  constructor(private readonly agentPresetSyncService: AgentPresetSyncService) {}

  async handleAgentAction(args: ManageSprintOsArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "list":
        return this.listAgents(payload);
      case "get":
        return this.getAgent(payload);
      case "sync":
        return this.syncAgents(payload);
      case "create":
        return this.createAgent(payload);
      case "update":
        return this.updateAgent(payload);
      case "delete":
        return this.deleteAgent(args, payload);
      default:
        throw new Error(`Unknown agent action: ${args.action}`);
    }
  }

  private async listAgents(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");
    const agents = await this.agentPresetSyncService.listAgentPresets(projectId);
    return { result: { agents } };
  }

  private async getAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const presetId = typeof payload.presetId === "string" ? payload.presetId : undefined;
    if (!presetId) throw new Error("presetId is required");

    // We get the specific preset ID directly through the sync service to make sure it exists and gets decorated properly if possible.
    // However, the service doesn't have a direct `getAgentPresetById` that we can access publicly except via specific flows.
    // Let's resolve via listing or a specific getter.
    // Since this is management, we might just list and filter if there's no direct getter, but wait, `AgentPresetRepository` has `getAgentPreset`.
    // Actually, `AgentPresetSyncService` has methods like `resolveTargetedQualityAssuranceAgent` but that's specific.
    // Let's use `listAgentPresets` to find it, which is fully decorated.
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    const agents = await this.agentPresetSyncService.listAgentPresets(projectId);
    const agent = agents.find((a: any) => a.id === presetId);

    if (!agent) {
      throw new Error(`Agent not found: ${presetId}`);
    }

    return { result: { agent } };
  }

  private async syncAgents(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    // The service supports full project sync via `syncProjectAgents`
    // Explicit preset sync can be handled by just syncing the whole project
    await this.agentPresetSyncService.syncProjectAgents(projectId);

    return { result: { success: true } };
  }

  private async createAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    const name = typeof payload.name === "string" ? payload.name : "New Agent";
    const instructionMarkdown = typeof payload.instructionMarkdown === "string" ? payload.instructionMarkdown : "";
    const avatarConfig = payload.avatarConfig as any;

    const agent = await this.agentPresetSyncService.createAgentPreset(projectId, {
      name,
      instructionMarkdown,
      labels: Array.isArray(payload.labels) ? payload.labels.filter((l: any) => typeof l === "string") : [],
      avatarConfig,
      memoryTemplateOverrideEnabled: typeof payload.memoryTemplateOverrideEnabled === "boolean" ? payload.memoryTemplateOverrideEnabled : undefined,
      memoryTemplateMarkdown: typeof payload.memoryTemplateMarkdown === "string" ? payload.memoryTemplateMarkdown : undefined,
    });

    return { result: { agent } };
  }

  private async updateAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const presetId = typeof payload.presetId === "string" ? payload.presetId : undefined;
    if (!projectId || !presetId) throw new Error("projectId and presetId are required");

    const updateInput: Record<string, any> = {};
    if (typeof payload.name === "string") updateInput.name = payload.name;
    if (typeof payload.instructionMarkdown === "string") updateInput.instructionMarkdown = payload.instructionMarkdown;
    if (Array.isArray(payload.labels)) updateInput.labels = payload.labels.filter((l: any) => typeof l === "string");
    if (payload.avatarConfig !== undefined) updateInput.avatarConfig = payload.avatarConfig;
    if (typeof payload.memoryTemplateOverrideEnabled === "boolean") updateInput.memoryTemplateOverrideEnabled = payload.memoryTemplateOverrideEnabled;
    if (typeof payload.memoryTemplateMarkdown === "string") updateInput.memoryTemplateMarkdown = payload.memoryTemplateMarkdown;

    const agent = await this.agentPresetSyncService.updateAgentPreset(presetId, updateInput);
    return { result: { agent } };
  }

  private async deleteAgent(args: ManageSprintOsArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const presetId = typeof payload.presetId === "string" ? payload.presetId : undefined;
    if (!projectId || !presetId) throw new Error("projectId and presetId are required");

    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to delete agent ${presetId}?` };
    }

    await this.agentPresetSyncService.deleteAgentPreset(presetId);
    return { result: { success: true } };
  }
}
