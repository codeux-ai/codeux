import type { AgentMcpAccessConfig, CustomMcpServer } from "../types.js";
import { TOOL_DEFINITIONS } from "../../../../src/contracts/mcp-tool-definitions.js";

export interface AgentMcpTag {
  id: string;
  label: string;
  kind: "code_ux" | "custom";
}

export const CODE_UX_TAG_ID = "code_ux";

/** A fresh, fully-default per-agent MCP access config (code_ux off, no custom links). */
export const defaultAgentMcpAccess = (): AgentMcpAccessConfig => ({
  codeUxEnabled: false,
  codeUxToolToggles: [],
  linkedServerIds: [],
});

export const schedulerOnlyAgentMcpAccess = (linkedServerIds: readonly string[] = []): AgentMcpAccessConfig => ({
  codeUxEnabled: true,
  codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    enabled: tool.name === "scheduler",
    isInternal: true,
  })),
  linkedServerIds: Array.from(new Set(linkedServerIds)),
});

export const isSchedulerOnlyAgentMcpAccess = (
  access: Pick<AgentMcpAccessConfig, "codeUxEnabled" | "codeUxToolToggles">,
): boolean => {
  if (!access.codeUxEnabled) return false;
  const enabledByName = new Map(access.codeUxToolToggles.map((toggle) => [toggle.name, toggle.enabled]));
  return TOOL_DEFINITIONS.every((tool) => enabledByName.get(tool.name) === (tool.name === "scheduler"));
};

/**
 * Normalize a config for storage/comparison. Agent-scoped Code UX access must keep
 * explicit true and false tool toggles because absent toggles inherit system-level
 * defaults; scheduler-only access relies on scheduler being explicitly enabled while
 * every other built-in tool is explicitly disabled.
 */
export const normalizeAgentMcpAccess = (access: AgentMcpAccessConfig): AgentMcpAccessConfig => ({
  codeUxEnabled: access.codeUxEnabled === true,
  codeUxToolToggles: access.codeUxEnabled === true
    ? TOOL_DEFINITIONS
      .filter((tool) => access.codeUxToolToggles.some((toggle) => toggle.name === tool.name))
      .map((tool) => {
        const toggle = access.codeUxToolToggles.find((candidate) => candidate.name === tool.name);
        return { name: tool.name, enabled: toggle?.enabled === true, isInternal: true };
      })
    : [],
  linkedServerIds: Array.from(new Set(access.linkedServerIds)),
});

/**
 * Resolve the MCP servers linked to an agent into display tags.
 * code_ux is shown first when explicitly enabled, followed by each linked custom server
 * that still exists in the available list.
 */
export const resolveAgentMcpTags = (
  access: AgentMcpAccessConfig | undefined,
  availableServers: CustomMcpServer[],
): AgentMcpTag[] => {
  const tags: AgentMcpTag[] = [];
  if (access?.codeUxEnabled === true) {
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
