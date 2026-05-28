import type { McpToolToggle, ProviderConfigId } from "./app-types.js";

export type AgentSourceScope = "project" | "home" | "default";

/**
 * Per-agent MCP access configuration. Controls which MCP servers a given agent
 * exposes when it runs in a container.
 */
export interface AgentMcpAccessConfig {
  /** Whether the built-in code_ux orchestration MCP is injected for this agent. */
  codeUxEnabled: boolean;
  /**
   * Per-tool overrides for code_ux tools. Each entry forces that tool on/off for this
   * agent; tools absent here inherit the system-level toggle.
   */
  codeUxToolToggles: McpToolToggle[];
  /** IDs of custom MCP servers (settings.customMcpServers) linked to this agent. Empty = none. */
  linkedServerIds: string[];
}
export type AgentSyncStatus = "manual" | "synced" | "out_of_sync" | "missing_source";

export interface AgentAvatarConfig {
  body?: string;
  hair?: string;
  face?: string;
  shirt?: string;
  bottom?: string;
  /** Robot avatar fields */
  chassis?: string;
  eyes?: string;
  antenna?: string;
  wings?: string;
  /** Side-of-head "headphones" piece — flat caps, studio cups, etc. */
  headphones?: string;
  accent?: string;
  baseColor?: string;
  /** Optional override color applied to the visor eye style. */
  visorColor?: string;
}

export interface AgentPresetRecord {
  id: string;
  projectId: string;
  name: string;
  description: string;
  instructionMarkdown: string;
  labels: string[];
  sourcePath: string | null;
  sourceScope: AgentSourceScope | null;
  sourceUpdatedAt: string | null;
  sourceImportedAt: string | null;
  sourceExists: boolean;
  syncStatus: AgentSyncStatus;
  avatarConfig?: AgentAvatarConfig;
  providerConfigId?: ProviderConfigId | null;
  model?: string | null;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  /** Per-agent MCP access config. Undefined for agents that have never been configured. */
  mcpAccess?: AgentMcpAccessConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPresetInput {
  id?: string;
  name: string;
  description?: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: AgentAvatarConfig;
  providerConfigId?: ProviderConfigId | null;
  model?: string | null;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  mcpAccess?: AgentMcpAccessConfig;
}

export interface UpdateAgentPresetInput {
  name?: string;
  description?: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: AgentAvatarConfig;
  providerConfigId?: ProviderConfigId | null;
  model?: string | null;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  mcpAccess?: AgentMcpAccessConfig;
}
