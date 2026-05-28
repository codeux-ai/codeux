import type { AgentMcpAccessConfig, CustomMcpServer } from "../types.js";

export interface AgentMcpTag {
  id: string;
  label: string;
  kind: "code_ux" | "custom";
}

export const CODE_UX_TAG_ID = "code_ux";

/** A fresh, fully-default per-agent MCP access config (code_ux on, no custom links). */
export const defaultAgentMcpAccess = (): AgentMcpAccessConfig => ({
  codeUxEnabled: true,
  codeUxToolToggles: [],
  linkedServerIds: [],
});

/**
 * Minimize a config for storage/comparison: keep only code_ux tool overrides that
 * actually disable a tool (absent = inherit/enabled) and dedupe linked ids. Lets dirty
 * tracking ignore no-op toggling.
 */
export const normalizeAgentMcpAccess = (access: AgentMcpAccessConfig): AgentMcpAccessConfig => ({
  codeUxEnabled: access.codeUxEnabled !== false,
  codeUxToolToggles: access.codeUxToolToggles.filter((toggle) => toggle.enabled === false),
  linkedServerIds: Array.from(new Set(access.linkedServerIds)),
});

/**
 * Resolve the MCP servers linked to an agent into display tags.
 * code_ux is shown first (on by default), followed by each linked custom server
 * that still exists in the available list.
 */
export const resolveAgentMcpTags = (
  access: AgentMcpAccessConfig | undefined,
  availableServers: CustomMcpServer[],
): AgentMcpTag[] => {
  const tags: AgentMcpTag[] = [];
  if (access?.codeUxEnabled !== false) {
    tags.push({ id: CODE_UX_TAG_ID, label: "Code UX", kind: "code_ux" });
  }
  for (const id of access?.linkedServerIds ?? []) {
    const server = availableServers.find((entry) => entry.id === id);
    if (server) {
      tags.push({ id, label: server.label || server.name, kind: "custom" });
    }
  }
  return tags;
};
