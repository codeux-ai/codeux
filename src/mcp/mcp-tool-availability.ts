import type { CustomMcpServer, CustomMcpTransport, DashboardSettings, McpToolToggle, ProviderId } from "../contracts/app-types.js";
import { TOOL_DEFINITIONS, type McpRuntimeRole, type ToolName } from "../contracts/mcp-tool-definitions.js";

export interface AgentCodeUxToolAccess {
  codeUxEnabled: boolean;
  codeUxToolToggles: McpToolToggle[];
}

export type AgentToolAvailability = McpToolToggle[] | AgentCodeUxToolAccess | null | undefined;

const CUSTOM_MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VALID_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity",
]);

const HEADER_NAME_PATTERN = /^[a-zA-Z0-9-]+$/;
const ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const SHELL_METACHAR_PATTERN = /[&|;<>$\(\)\`'"\x00-\x1F\x7F]/;

const sanitizeHeadersMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (name.length === 0 || name.length > 64 || typeof raw !== "string" || raw.length > 4096) continue;
    if (!HEADER_NAME_PATTERN.test(name)) continue;
    if (CONTROL_CHAR_PATTERN.test(raw)) continue;
    out[name] = raw;
    count++;
    if (count >= 32) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const sanitizeEnvMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (name.length === 0 || name.length > 64 || typeof raw !== "string" || raw.length > 4096) continue;
    if (!ENV_NAME_PATTERN.test(name)) continue;
    if (CONTROL_CHAR_PATTERN.test(raw)) continue;
    out[name] = raw;
    count++;
    if (count >= 64) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const sanitizeArgs = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => {
    return typeof entry === "string" && entry.length <= 4096 && !CONTROL_CHAR_PATTERN.test(entry);
  }).slice(0, 64);
  return out.length > 0 ? out : undefined;
};

const isValidHttpUrl = (urlStr: string): boolean => {
  if (CONTROL_CHAR_PATTERN.test(urlStr)) return false;
  try {
    const u = new URL(urlStr);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
  } catch {
    return false;
  }
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

    if (transport === "http") {
      if (url.length === 0 || !isValidHttpUrl(url)) continue;
    } else if (transport === "stdio") {
      if (command.length === 0 || command.length > 256 || SHELL_METACHAR_PATTERN.test(command)) continue;
    }

    byId.set(id, {
      id,
      name,
      label: typeof candidate.label === "string" && candidate.label.trim().length > 0 ? candidate.label.trim() : undefined,
      description: typeof candidate.description === "string" && candidate.description.trim().length > 0 ? candidate.description.trim() : undefined,
      enabled: candidate.enabled !== false,
      transport,
      ...(transport === "http"
        ? { url, headers: sanitizeHeadersMap(candidate.headers) }
        : { command, args: sanitizeArgs(candidate.args), env: sanitizeEnvMap(candidate.env) }),
      providers: sanitizeProviders(candidate.providers),
    });
  }

  return Array.from(byId.values());
};

export const sanitizeCustomMcpServersWithDefaults = (
  value: unknown,
  defaults: readonly CustomMcpServer[],
): CustomMcpServer[] => {
  const sanitizedDefaults = sanitizeCustomMcpServers(defaults);
  const sanitizedInput = sanitizeCustomMcpServers(value);
  if (sanitizedInput.length === 0) {
    return sanitizedDefaults.map((server) => ({ ...server }));
  }

  const byId = new Map<string, CustomMcpServer>();
  for (const server of sanitizedDefaults) {
    byId.set(server.id, server);
  }

  for (const server of sanitizedInput) {
    const defaultWithSameName = sanitizedDefaults.find((candidate) => candidate.name === server.name);
    if (defaultWithSameName && defaultWithSameName.id !== server.id) {
      byId.delete(defaultWithSameName.id);
    }
    byId.set(server.id, server);
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
  agentToolAccess?: AgentToolAvailability,
): Set<string> => {
  const enabledByName = new Map<string, boolean>();
  for (const tool of settings.mcpTools) {
    enabledByName.set(tool.name, tool.enabled);
  }
  if (agentToolAccess && !Array.isArray(agentToolAccess) && !agentToolAccess.codeUxEnabled) {
    return new Set();
  }
  const agentToolToggles = Array.isArray(agentToolAccess)
    ? agentToolAccess
    : agentToolAccess?.codeUxToolToggles;
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
  agentToolAccess?: AgentToolAvailability,
): Array<(typeof TOOL_DEFINITIONS)[number]> => {
  const enabled = getEnabledToolNameSet(settings, agentToolAccess);
  return TOOL_DEFINITIONS.filter((tool) => enabled.has(tool.name) && isToolVisibleForRuntimeRole(tool, runtimeRole)) as Array<(typeof TOOL_DEFINITIONS)[number]>;
};

export const isToolEnabled = (
  settings: DashboardSettings,
  toolName: string,
  runtimeRole: McpRuntimeRole = "project_manager",
  agentToolAccess?: AgentToolAvailability,
): toolName is ToolName => {
  if (!getEnabledToolNameSet(settings, agentToolAccess).has(toolName)) {
    return false;
  }

  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === toolName);
  return !!tool && isToolVisibleForRuntimeRole(tool, runtimeRole);
};
