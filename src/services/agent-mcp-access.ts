import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import type { CustomMcpServer, McpToolToggle } from "../contracts/app-types.js";
import { TOOL_DEFINITIONS } from "../contracts/mcp-tool-definitions.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import { sanitizeCustomMcpServers } from "../mcp/mcp-tool-availability.js";
import { DEFAULT_PLAYWRIGHT_MCP_SERVER_ID } from "../repositories/settings-defaults.js";
import type { AgentCodeUxToolAccess } from "../mcp/mcp-tool-availability.js";

const VALID_TOOL_NAMES = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.name));

export const defaultAgentMcpAccess = (): AgentMcpAccessConfig => ({
  codeUxEnabled: true,
  codeUxToolToggles: [],
  linkedServerIds: [],
});

export const defaultCodingAgentLinkedServerIds = (): string[] => [
  DEFAULT_PLAYWRIGHT_MCP_SERVER_ID,
];

export const defaultCodingAgentMcpAccess = (): AgentMcpAccessConfig => ({
  ...defaultAgentMcpAccess(),
  linkedServerIds: defaultCodingAgentLinkedServerIds(),
});

const sanitizeToolToggles = (value: unknown): McpToolToggle[] => {
  if (!Array.isArray(value)) return [];
  const byName = new Map<string, boolean>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<McpToolToggle>;
    if (typeof candidate.name !== "string" || typeof candidate.enabled !== "boolean") continue;
    const name = candidate.name.trim();
    if (!VALID_TOOL_NAMES.has(name)) continue;
    byName.set(name, candidate.enabled);
  }
  return Array.from(byName.entries()).map(([name, enabled]) => ({ name, enabled, isInternal: true }));
};

export const sanitizeAgentMcpAccess = (value: unknown): AgentMcpAccessConfig => {
  if (!value || typeof value !== "object") return defaultAgentMcpAccess();
  const candidate = value as Partial<AgentMcpAccessConfig>;
  const linkedServerIds = Array.isArray(candidate.linkedServerIds)
    ? Array.from(
        new Set(
          candidate.linkedServerIds
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id) => id.trim()),
        ),
      )
    : [];
  return {
    codeUxEnabled: candidate.codeUxEnabled !== false,
    codeUxToolToggles: sanitizeToolToggles(candidate.codeUxToolToggles),
    linkedServerIds,
  };
};

export interface ResolvedAgentMcpRuntime {
  customMcpServers: CustomMcpServer[];
  mcpConnection: McpConnectionInfo | null;
}

const retrievalOnlySkillToolAccess = (): AgentCodeUxToolAccess => ({
  codeUxEnabled: true,
  codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    enabled: tool.name === "search_skills",
    isInternal: true,
  })),
});

const withSkillRetrievalEnabled = (access: AgentMcpAccessConfig): AgentMcpAccessConfig => {
  if (!access.codeUxEnabled) {
    return {
      ...access,
      codeUxEnabled: true,
      codeUxToolToggles: retrievalOnlySkillToolAccess().codeUxToolToggles,
    };
  }
  const byName = new Map(access.codeUxToolToggles.map((toggle) => [toggle.name, toggle]));
  byName.set("search_skills", { name: "search_skills", enabled: true, isInternal: true });
  return {
    ...access,
    codeUxToolToggles: Array.from(byName.values()),
  };
};

/**
 * Apply per-agent MCP access to a base set of custom servers + code_ux connection.
 * When `access` is missing, the run inherits provider-wide MCP servers unchanged.
 * When agent-scoped and code_ux is enabled, the agent id is attached to the connection so
 * the gateway can enforce per-agent code_ux tool toggles.
 */
export const resolveAgentMcpRuntime = (args: {
  access: AgentMcpAccessConfig | null | undefined;
  agentId: string | null | undefined;
  customMcpServers: CustomMcpServer[];
  mcpConnection: McpConnectionInfo | null;
  persistentSkillRetrievalEnabled?: boolean;
}): ResolvedAgentMcpRuntime => {
  if (args.access == null) {
    const mcpConnection = args.mcpConnection && args.agentId
      ? { ...args.mcpConnection, agentId: args.agentId }
      : args.mcpConnection;
    return {
      customMcpServers: args.customMcpServers,
      mcpConnection,
    };
  }

  const access = args.persistentSkillRetrievalEnabled
    ? withSkillRetrievalEnabled(args.access)
    : args.access;
  const linked = new Set(access.linkedServerIds);
  const customMcpServers = sanitizeCustomMcpServers(args.customMcpServers).filter((server) => linked.has(server.id));
  const baseConnection = access.codeUxEnabled ? args.mcpConnection : null;
  const mcpConnection = baseConnection && args.agentId
    ? { ...baseConnection, agentId: args.agentId }
    : baseConnection;

  return { customMcpServers, mcpConnection };
};

export const toAgentCodeUxToolAccess = (
  access: Pick<AgentMcpAccessConfig, "codeUxEnabled" | "codeUxToolToggles">,
  persistentSkillRetrievalEnabled = false,
): AgentCodeUxToolAccess => ({
  ...(persistentSkillRetrievalEnabled
    ? (access.codeUxEnabled
      ? {
        codeUxEnabled: true,
        codeUxToolToggles: withSkillRetrievalEnabled({
          codeUxEnabled: access.codeUxEnabled,
          codeUxToolToggles: access.codeUxToolToggles,
          linkedServerIds: [],
        }).codeUxToolToggles,
      }
      : retrievalOnlySkillToolAccess())
    : {
      codeUxEnabled: access.codeUxEnabled,
      codeUxToolToggles: access.codeUxToolToggles,
    }),
});

/** Merge per-agent code_ux tool toggles over the system-level toggles. */
export const mergeCodeUxToolToggles = (
  base: McpToolToggle[],
  agentToggles: McpToolToggle[] | AgentCodeUxToolAccess | null | undefined,
): McpToolToggle[] => {
  if (agentToggles && !Array.isArray(agentToggles) && !agentToggles.codeUxEnabled) {
    return base.map((toggle) => ({ ...toggle, enabled: false }));
  }
  const toggles = Array.isArray(agentToggles)
    ? agentToggles
    : agentToggles?.codeUxToolToggles;
  if (!toggles || toggles.length === 0) return base;
  const overrides = new Map(toggles.map((toggle) => [toggle.name, toggle.enabled]));
  return base.map((toggle) =>
    overrides.has(toggle.name) ? { ...toggle, enabled: overrides.get(toggle.name)! } : toggle,
  );
};
