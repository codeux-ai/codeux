import type { CustomMcpServer, CustomMcpTransport, DashboardSettings, McpToolToggle, ProviderId } from "../contracts/app-types.js";
import { TOOL_DEFINITIONS, type McpRuntimeRole, type ToolName } from "../contracts/mcp-tool-definitions.js";

export interface AgentCodeUxToolAccess {
  codeUxEnabled: boolean;
  codeUxToolToggles: McpToolToggle[];
}

export type AgentToolAvailability = McpToolToggle[] | AgentCodeUxToolAccess | null | undefined;

const CUSTOM_MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VALID_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity", "mockup-cli",
]);

const HEADER_NAME_PATTERN = /^[a-zA-Z0-9-]+$/;
const ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const SHELL_METACHAR_PATTERN = /[&|;<>$\(\)\`'"\x00-\x1F\x7F]/;
const DECIMAL_IPV4_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const NUMERIC_HOST_PATTERN = /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*$/i;
const BLOCKED_CUSTOM_MCP_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const BLOCKED_METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
]);

const sanitizeHeadersMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (name.length === 0 || name.length > 64 || typeof raw !== "string" || raw.length > 4096) continue;
    if (!HEADER_NAME_PATTERN.test(name)) continue;
    if (BLOCKED_CUSTOM_MCP_HEADER_NAMES.has(name.toLowerCase())) continue;
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

const extractRawHostname = (urlStr: string): string | null => {
  const schemeIndex = urlStr.indexOf("://");
  if (schemeIndex < 0) return null;
  const authorityStart = schemeIndex + 3;
  const remainder = urlStr.slice(authorityStart);
  const authorityEnd = remainder.search(/[/?#]/);
  const authority = remainder.slice(0, authorityEnd === -1 ? undefined : authorityEnd);
  if (authority.includes("@")) return null;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end <= 1) return null;
    return authority.slice(1, end);
  }
  const portIndex = authority.lastIndexOf(":");
  return portIndex >= 0 ? authority.slice(0, portIndex) : authority;
};

const parseDecimalIpv4 = (host: string): number[] | null => {
  if (!DECIMAL_IPV4_PATTERN.test(host)) return null;
  const octets = host.split(".").map((part) => Number(part));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
};

const isAmbiguousNumericHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return NUMERIC_HOST_PATTERN.test(normalized) && parseDecimalIpv4(normalized) === null;
};

const isBlockedIpv4Target = (octets: number[]): boolean => {
  const [first, second, , fourth] = octets;
  if (first === 127) return false;
  return (
    first === 0
    || (first === 169 && second === 254)
    || (first >= 224 && first <= 239)
    || first === 255
    || fourth === 255
  );
};

const parseMappedIpv6Ipv4Octets = (host: string): number[] | null => {
  const normalized = host.toLowerCase();
  const mappedPrefix = normalized.startsWith("::ffff:")
    ? "::ffff:"
    : normalized.startsWith("0:0:0:0:0:ffff:")
      ? "0:0:0:0:0:ffff:"
      : null;
  if (!mappedPrefix) return null;

  const embedded = normalized.slice(mappedPrefix.length);
  const dotted = parseDecimalIpv4(embedded);
  if (dotted) return dotted;

  const hextets = embedded.split(":");
  if (hextets.length !== 2 || !hextets.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;
  const [high, low] = hextets.map((part) => Number.parseInt(part, 16));
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
};

const getIpv6FirstHextet = (host: string): number | null => {
  const first = host.split(":").find((part) => part.length > 0);
  if (!first || !/^[0-9a-f]{1,4}$/i.test(first)) return null;
  return Number.parseInt(first, 16);
};

const isBlockedIpv6Target = (host: string): boolean => {
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return false;
  const first = getIpv6FirstHextet(host);
  if (first === null) return true;
  return (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
};

const getIpVersion = (host: string): 0 | 4 | 6 => {
  if (parseDecimalIpv4(host)) return 4;
  if (!host.includes(":")) return 0;
  return /^[0-9a-f:.]+$/i.test(host) ? 6 : 0;
};

const isSafeHttpHostname = (hostname: string, rawHostname: string): boolean => {
  const raw = rawHostname.toLowerCase().replace(/\.$/, "");
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (raw === "localhost" || host === "localhost") return true;
  if (BLOCKED_METADATA_HOSTS.has(raw) || BLOCKED_METADATA_HOSTS.has(host)) return false;
  if (isAmbiguousNumericHost(raw)) return false;

  const rawIpv4 = parseDecimalIpv4(raw);
  if (rawIpv4) return !isBlockedIpv4Target(rawIpv4);

  const ipVersion = getIpVersion(host);
  if (ipVersion === 4) {
    const octets = parseDecimalIpv4(host);
    return !!octets && !isBlockedIpv4Target(octets);
  }
  if (ipVersion === 6) {
    const mappedIpv4 = parseMappedIpv6Ipv4Octets(host);
    if (mappedIpv4) return !isBlockedIpv4Target(mappedIpv4);
    return !isBlockedIpv6Target(host);
  }
  return true;
};

const isValidHttpUrl = (urlStr: string): boolean => {
  if (CONTROL_CHAR_PATTERN.test(urlStr)) return false;
  try {
    const rawHostname = extractRawHostname(urlStr);
    if (!rawHostname || CONTROL_CHAR_PATTERN.test(rawHostname)) return false;
    const u = new URL(urlStr);
    return (
      (u.protocol === "http:" || u.protocol === "https:")
      && !u.username
      && !u.password
      && isSafeHttpHostname(u.hostname, rawHostname)
    );
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
    ? typeof server.command === "string"
      && server.command.trim().length > 0
      && server.command.trim().length <= 256
      && !SHELL_METACHAR_PATTERN.test(server.command.trim())
    : typeof server.url === "string" && isValidHttpUrl(server.url.trim())
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

  for (const inputServer of sanitizedInput) {
    const matchingDefault = sanitizedDefaults.find((candidate) => candidate.id === inputServer.id || candidate.name === inputServer.name);
    const server = matchingDefault
      && inputServer.transport === "stdio"
      && inputServer.command === "playwright-mcp"
      && (inputServer.args?.length ?? 0) === 0
      ? { ...inputServer, command: matchingDefault.command, args: [...(matchingDefault.args || [])] }
      : inputServer;
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
