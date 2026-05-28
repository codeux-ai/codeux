import type { CustomMcpServer, CustomMcpTransport, DashboardSettings, McpToolToggle, ProviderId } from "../contracts/app-types.js";
import { TOOL_DEFINITIONS, type McpRuntimeRole, type ToolName } from "../contracts/mcp-tool-definitions.js";

const CUSTOM_MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VALID_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "jules", "gemini", "codex", "claude-code", "qwen-code", "opencode",
]);

const sanitizeStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (name.length === 0 || typeof raw !== "string") continue;
    out[name] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const sanitizeArgs = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === "string");
  return out.length > 0 ? out : undefined;
};

const sanitizeProviders = (value: unknown): ProviderId[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is ProviderId => typeof entry === "string" && VALID_PROVIDER_IDS.has(entry as ProviderId));
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
};

export const isUsableCustomMcpServer = (server: CustomMcpServer): boolean => (
  server.transport === "stdio"
    ? typeof server.command === "string" && server.command.trim().length > 0
    : typeof server.url === "string" && server.url.trim().length > 0
);

export const sanitizeCustomMcpServers = (value: unknown): CustomMcpServer[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CustomMcpServer>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<CustomMcpServer>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (id.length === 0 || name.length === 0) continue;
    if (!CUSTOM_MCP_NAME_PATTERN.test(name)) continue;

    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    const command = typeof candidate.command === "string" ? candidate.command.trim() : "";
    const transport: CustomMcpTransport = candidate.transport === "stdio" || (candidate.transport !== "http" && command.length > 0 && url.length === 0)
      ? "stdio"
      : "http";

    if (transport === "http" && url.length === 0) continue;
    if (transport === "stdio" && command.length === 0) continue;

    byId.set(id, {
      id,
      name,
      label: typeof candidate.label === "string" && candidate.label.trim().length > 0 ? candidate.label.trim() : undefined,
      description: typeof candidate.description === "string" && candidate.description.trim().length > 0 ? candidate.description.trim() : undefined,
      enabled: candidate.enabled !== false,
      transport,
      ...(transport === "http"
        ? { url, headers: sanitizeStringMap(candidate.headers) }
        : { command, args: sanitizeArgs(candidate.args), env: sanitizeStringMap(candidate.env) }),
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

const getEnabledToolNameSet = (
  settings: DashboardSettings,
  agentToolToggles?: McpToolToggle[] | null,
): Set<string> => {
  const enabledByName = new Map<string, boolean>();
  for (const tool of settings.mcpTools) {
    enabledByName.set(tool.name, tool.enabled);
  }
  if (agentToolToggles) {
    for (const tool of agentToolToggles) {
      enabledByName.set(tool.name, tool.enabled);
    }
  }
  return new Set(
    [...enabledByName.entries()]
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
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
  agentToolToggles?: McpToolToggle[] | null,
): Array<(typeof TOOL_DEFINITIONS)[number]> => {
  const enabled = getEnabledToolNameSet(settings, agentToolToggles);
  return TOOL_DEFINITIONS.filter((tool) => enabled.has(tool.name) && isToolVisibleForRuntimeRole(tool, runtimeRole)) as Array<(typeof TOOL_DEFINITIONS)[number]>;
};

export const isToolEnabled = (
  settings: DashboardSettings,
  toolName: string,
  runtimeRole: McpRuntimeRole = "project_manager",
  agentToolToggles?: McpToolToggle[] | null,
): toolName is ToolName => {
  if (!getEnabledToolNameSet(settings, agentToolToggles).has(toolName)) {
    return false;
  }

  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === toolName);
  return !!tool && isToolVisibleForRuntimeRole(tool, runtimeRole);
};
