import type { ManageSprintOsArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { AgentPresetSyncService } from "../../services/agent-preset-sync-service.js";
import { z } from "zod";

const listAgentsSchema = z.object({
  projectId: z.string(),
});

const getAgentSchema = z.object({
  projectId: z.string(),
  presetId: z.string(),
});

const syncAgentsSchema = z.object({
  projectId: z.string(),
});

const createAgentSchema = z.object({
  projectId: z.string(),
  name: z.string().optional().default("New Agent"),
  instructionMarkdown: z.string().optional().default(""),
  labels: z.array(z.string()).optional().default([]),
  avatarConfig: z.record(z.string(), z.unknown()).optional(),
  memoryTemplateOverrideEnabled: z.boolean().optional(),
  memoryTemplateMarkdown: z.string().optional(),
});

const updateAgentSchema = z.object({
  projectId: z.string(),
  presetId: z.string(),
  name: z.string().optional(),
  instructionMarkdown: z.string().optional(),
  labels: z.array(z.string()).optional(),
  avatarConfig: z.record(z.string(), z.unknown()).optional(),
  memoryTemplateOverrideEnabled: z.boolean().optional(),
  memoryTemplateMarkdown: z.string().optional(),
});

const deleteAgentSchema = z.object({
  projectId: z.string(),
  presetId: z.string(),
});

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
    const parsed = listAgentsSchema.parse(payload);
    const agents = await this.agentPresetSyncService.listAgentPresets(parsed.projectId);
    return { result: { agents } };
  }

  private async getAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = getAgentSchema.parse(payload);

    // We get the specific preset ID directly through the sync service to make sure it exists and gets decorated properly if possible.
    // However, the service doesn't have a direct `getAgentPresetById` that we can access publicly except via specific flows.
    // Let's resolve via listing or a specific getter.
    // Since this is management, we might just list and filter if there's no direct getter, but wait, `AgentPresetRepository` has `getAgentPreset`.
    // Actually, `AgentPresetSyncService` has methods like `resolveTargetedQualityAssuranceAgent` but that's specific.
    // Let's use `listAgentPresets` to find it, which is fully decorated.
    const agents = await this.agentPresetSyncService.listAgentPresets(parsed.projectId);
    const agent = agents.find((a: any) => a.id === parsed.presetId);

    if (!agent) {
      throw new Error(`Agent not found: ${parsed.presetId}`);
    }

    return { result: { agent } };
  }

  private async syncAgents(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = syncAgentsSchema.parse(payload);

    // The service supports full project sync via `syncProjectAgents`
    // Explicit preset sync can be handled by just syncing the whole project
    await this.agentPresetSyncService.syncProjectAgents(parsed.projectId);

    return { result: { success: true } };
  }

  private async createAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = createAgentSchema.parse(payload);

    const agent = await this.agentPresetSyncService.createAgentPreset(parsed.projectId, {
      name: parsed.name,
      instructionMarkdown: parsed.instructionMarkdown,
      labels: parsed.labels,
      avatarConfig: parsed.avatarConfig,
      memoryTemplateOverrideEnabled: parsed.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: parsed.memoryTemplateMarkdown,
    });

    return { result: { agent } };
  }

  private async updateAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = updateAgentSchema.parse(payload);

    const updateInput: Record<string, unknown> = {};
    if (parsed.name !== undefined) updateInput.name = parsed.name;
    if (parsed.instructionMarkdown !== undefined) updateInput.instructionMarkdown = parsed.instructionMarkdown;
    if (parsed.labels !== undefined) updateInput.labels = parsed.labels;
    if (parsed.avatarConfig !== undefined) updateInput.avatarConfig = parsed.avatarConfig;
    if (parsed.memoryTemplateOverrideEnabled !== undefined) updateInput.memoryTemplateOverrideEnabled = parsed.memoryTemplateOverrideEnabled;
    if (parsed.memoryTemplateMarkdown !== undefined) updateInput.memoryTemplateMarkdown = parsed.memoryTemplateMarkdown;

    const agent = await this.agentPresetSyncService.updateAgentPreset(parsed.presetId, updateInput);
    return { result: { agent } };
  }

  private async deleteAgent(args: ManageSprintOsArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = deleteAgentSchema.parse(payload);

    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to delete agent ${parsed.presetId}?` };
    }

    await this.agentPresetSyncService.deleteAgentPreset(parsed.presetId);
    return { result: { success: true } };
  }
}
