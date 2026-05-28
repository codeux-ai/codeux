import type { CustomMcpServer, DashboardSettings, McpToolToggle, ProviderId } from "../contracts/app-types.js";
import { TOOL_DEFINITIONS, type McpRuntimeRole, type ToolName } from "../contracts/mcp-tool-definitions.js";

const CUSTOM_MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VALID_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "jules", "gemini", "codex", "claude-code", "qwen-code", "opencode",
]);

const sanitizeHeaders = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (name.length === 0 || typeof raw !== "string") continue;
    out[name] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const sanitizeProviders = (value: unknown): ProviderId[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is ProviderId => typeof entry === "string" && VALID_PROVIDER_IDS.has(entry as ProviderId));
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
};

export const sanitizeCustomMcpServers = (value: unknown): CustomMcpServer[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CustomMcpServer>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<CustomMcpServer>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (id.length === 0 || name.length === 0 || url.length === 0) continue;
    if (!CUSTOM_MCP_NAME_PATTERN.test(name)) continue;

    byId.set(id, {
      id,
      name,
      label: typeof candidate.label === "string" && candidate.label.trim().length > 0 ? candidate.label.trim() : undefined,
      description: typeof candidate.description === "string" && candidate.description.trim().length > 0 ? candidate.description.trim() : undefined,
      enabled: candidate.enabled !== false,
      url,
      headers: sanitizeHeaders(candidate.headers),
      providers: sanitizeProviders(candidate.providers),
    });
  }

  return Array.from(byId.values());
};

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

const isToolVisibleForRuntimeRole = (
  tool: (typeof TOOL_DEFINITIONS)[number],
  runtimeRole: McpRuntimeRole,
): boolean => {
  return !tool.runtimeRoles || (tool.runtimeRoles as readonly McpRuntimeRole[]).includes(runtimeRole);
};

export const getEnabledToolDefinitions = (
  settings: DashboardSettings,
  runtimeRole: McpRuntimeRole = "project_manager",
): Array<(typeof TOOL_DEFINITIONS)[number]> => {
  const enabled = getEnabledToolNameSet(settings);
  return TOOL_DEFINITIONS.filter((tool) => enabled.has(tool.name) && isToolVisibleForRuntimeRole(tool, runtimeRole)) as Array<(typeof TOOL_DEFINITIONS)[number]>;
};

export const isToolEnabled = (
  settings: DashboardSettings,
  toolName: string,
  runtimeRole: McpRuntimeRole = "project_manager",
): toolName is ToolName => {
  if (!getEnabledToolNameSet(settings).has(toolName)) {
    return false;
  }

  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === toolName);
  return !!tool && isToolVisibleForRuntimeRole(tool, runtimeRole);
};
