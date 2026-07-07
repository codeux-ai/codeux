import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { AgentPresetSyncService } from "../../services/agent-preset-sync-service.js";
import type { AgentAvatarConfig, AgentMcpAccessConfig, AgentMemoryConfig } from "../../contracts/agent-preset-types.js";
import { parseRequiredString, parseOptionalString, parseOptionalStringArray, parseOptionalBoolean, parseOptionalObject, parseOptionalNullableString } from "./payload-parsers.js";


interface UpdateAgentInput {
  name?: string;
  description?: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: AgentAvatarConfig;
  providerConfigId?: string | null;
  model?: string | null;
  memoryConfig?: AgentMemoryConfig;
  mcpAccess?: AgentMcpAccessConfig;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
}

export class AgentActions {
  constructor(private readonly agentPresetSyncService: AgentPresetSyncService) {}

  async handleAgentAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
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
    const projectId = parseRequiredString(payload, "projectId");
    const agents = await this.agentPresetSyncService.listAgentPresets(projectId);
    return { result: { agents } };
  }

  private async getAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const presetId = parseRequiredString(payload, "presetId");

    // We get the specific preset ID directly through the sync service to make sure it exists and gets decorated properly if possible.
    // However, the service doesn't have a direct `getAgentPresetById` that we can access publicly except via specific flows.
    // Let's resolve via listing or a specific getter.
    // Since this is management, we might just list and filter if there's no direct getter, but wait, `AgentPresetRepository` has `getAgentPreset`.
    // Actually, `AgentPresetSyncService` has methods like `resolveTargetedQualityAssuranceAgent` but that's specific.
    // Let's use `listAgentPresets` to find it, which is fully decorated.
    const projectId = parseRequiredString(payload, "projectId");

    const agents = await this.agentPresetSyncService.listAgentPresets(projectId);
    const agent = agents.find((a: any) => a.id === presetId);

    if (!agent) {
      throw new Error(`Agent not found: ${presetId}`);
    }

    return { result: { agent } };
  }

  private async syncAgents(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");

    // The service supports full project sync via `syncProjectAgents`
    // Explicit preset sync can be handled by just syncing the whole project
    await this.agentPresetSyncService.syncProjectAgents(projectId);

    return { result: { success: true } };
  }

  private async createAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");

    const name = parseOptionalString(payload, "name") ?? "New Agent";
    const instructionMarkdown = parseOptionalString(payload, "instructionMarkdown") ?? "";
    const avatarConfig = parseOptionalObject<AgentAvatarConfig>(payload, "avatarConfig");

    const agent = await this.agentPresetSyncService.createAgentPreset(projectId, {
      name,
      description: parseOptionalString(payload, "description"),
      instructionMarkdown,
      labels: parseOptionalStringArray(payload, "labels") ?? [],
      avatarConfig,
      providerConfigId: parseOptionalNullableString(payload, "providerConfigId"),
      model: parseOptionalNullableString(payload, "model"),
      memoryConfig: parseOptionalObject<AgentMemoryConfig>(payload, "memoryConfig"),
      mcpAccess: parseOptionalObject<AgentMcpAccessConfig>(payload, "mcpAccess"),
      memoryTemplateOverrideEnabled: parseOptionalBoolean(payload, "memoryTemplateOverrideEnabled"),
      memoryTemplateMarkdown: parseOptionalString(payload, "memoryTemplateMarkdown"),
    });

    return { result: { agent } };
  }

  private async updateAgent(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const presetId = parseRequiredString(payload, "presetId");

    const updateInput: UpdateAgentInput = {};
    const name = parseOptionalString(payload, "name");
    if (name !== undefined) updateInput.name = name;
    const description = parseOptionalString(payload, "description");
    if (description !== undefined) updateInput.description = description;
    const instructionMarkdown = parseOptionalString(payload, "instructionMarkdown");
    if (instructionMarkdown !== undefined) updateInput.instructionMarkdown = instructionMarkdown;
    const labels = parseOptionalStringArray(payload, "labels");
    if (labels !== undefined) updateInput.labels = labels;
    const avatarConfig = parseOptionalObject<AgentAvatarConfig>(payload, "avatarConfig");
    if (avatarConfig !== undefined) updateInput.avatarConfig = avatarConfig;
    const providerConfigId = parseOptionalNullableString(payload, "providerConfigId");
    if (providerConfigId !== undefined) updateInput.providerConfigId = providerConfigId;
    const model = parseOptionalNullableString(payload, "model");
    if (model !== undefined) updateInput.model = model;
    const memoryConfig = parseOptionalObject<AgentMemoryConfig>(payload, "memoryConfig");
    if (memoryConfig !== undefined) updateInput.memoryConfig = memoryConfig;
    const mcpAccess = parseOptionalObject<AgentMcpAccessConfig>(payload, "mcpAccess");
    if (mcpAccess !== undefined) updateInput.mcpAccess = mcpAccess;
    const memoryTemplateOverrideEnabled = parseOptionalBoolean(payload, "memoryTemplateOverrideEnabled");
    if (memoryTemplateOverrideEnabled !== undefined) updateInput.memoryTemplateOverrideEnabled = memoryTemplateOverrideEnabled;
    const memoryTemplateMarkdown = parseOptionalString(payload, "memoryTemplateMarkdown");
    if (memoryTemplateMarkdown !== undefined) updateInput.memoryTemplateMarkdown = memoryTemplateMarkdown;

    const agent = await this.agentPresetSyncService.updateAgentPreset(presetId, updateInput);
    return { result: { agent } };
  }

  private async deleteAgent(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const presetId = parseRequiredString(payload, "presetId");

    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to delete agent ${presetId}?` };
    }

    await this.agentPresetSyncService.deleteAgentPreset(presetId);
    return { result: { success: true } };
  }
}
