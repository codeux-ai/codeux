import type { DashboardSettings, McpToolToggle } from "../types.js";
import { TOOL_DEFINITIONS, type ToolName } from "../tools.js";

export const DEFAULT_MCP_TOOL_TOGGLES: McpToolToggle[] = TOOL_DEFINITIONS.map((tool) => ({
  name: tool.name,
  enabled: true,
  isInternal: true,
}));

export const sanitizeMcpToolToggles = (value: unknown): McpToolToggle[] => {
  const enabledByName = new Map<string, boolean>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<McpToolToggle>;
      if (typeof candidate.name !== "string" || typeof candidate.enabled !== "boolean") continue;
      const normalizedName = candidate.name.trim();
      if (normalizedName.length === 0) continue;
      enabledByName.set(normalizedName, candidate.enabled);
    }
  }

  return DEFAULT_MCP_TOOL_TOGGLES.map((tool) => ({
    ...tool,
    enabled: enabledByName.get(tool.name) ?? tool.enabled,
  }));
};

const getEnabledToolNameSet = (settings: DashboardSettings): Set<string> => {
  return new Set(
    settings.mcpTools
      .filter((tool) => tool.enabled)
      .map((tool) => tool.name)
  );
};

export const getEnabledToolDefinitions = (settings: DashboardSettings): Array<(typeof TOOL_DEFINITIONS)[number]> => {
  const enabled = getEnabledToolNameSet(settings);
  return TOOL_DEFINITIONS.filter((tool) => enabled.has(tool.name)) as Array<(typeof TOOL_DEFINITIONS)[number]>;
};

export const isToolEnabled = (settings: DashboardSettings, toolName: string): toolName is ToolName => {
  return getEnabledToolNameSet(settings).has(toolName);
};
