import type { CustomMcpServer } from "../../../contracts/app-types.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { sanitizeCustomMcpServers } from "../../../mcp/mcp-tool-availability.js";
import type { CliProviderId } from "./provider-command-specs.js";

export const escapeTomlString = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const hasEntries = (value?: Record<string, string>): value is Record<string, string> =>
  !!value && Object.keys(value).length > 0;

const hasArgs = (value?: string[]): value is string[] => Array.isArray(value) && value.length > 0;

/** Claude Code mcpServers entry: http uses { type, url, headers }, stdio uses { command, args, env }. */
export const buildClaudeMcpServerEntry = (server: CustomMcpServer): Record<string, unknown> =>
  server.transport === "stdio"
    ? {
        type: "stdio",
        command: server.command,
        ...(hasArgs(server.args) ? { args: server.args } : {}),
        ...(hasEntries(server.env) ? { env: server.env } : {}),
      }
    : {
        type: "http",
        url: server.url,
        ...(hasEntries(server.headers) ? { headers: server.headers } : {}),
      };

/** Gemini/Qwen mcpServers entry: http uses { httpUrl, headers }, stdio uses { command, args, env }. */
export const buildGeminiMcpServerEntry = (server: CustomMcpServer): Record<string, unknown> =>
  server.transport === "stdio"
    ? {
        command: server.command,
        ...(hasArgs(server.args) ? { args: server.args } : {}),
        ...(hasEntries(server.env) ? { env: server.env } : {}),
      }
    : {
        httpUrl: server.url,
        ...(hasEntries(server.headers) ? { headers: server.headers } : {}),
      };

const inlineTomlTable = (entries: Record<string, string>): string =>
  Object.entries(entries)
    .map(([key, value]) => `"${escapeTomlString(key)}" = "${escapeTomlString(value)}"`)
    .join(", ");

/** Codex config.toml lines for a custom MCP server under [mcp_servers.<tableName>]. */
export const buildCodexMcpServerTomlLines = (tableName: string, server: CustomMcpServer): string[] => {
  const lines = [`[mcp_servers.${tableName}]`];
  if (server.transport === "stdio") {
    lines.push(`command = "${escapeTomlString(server.command || "")}"`);
    if (hasArgs(server.args)) {
      lines.push(`args = [${server.args.map((arg) => `"${escapeTomlString(arg)}"`).join(", ")}]`);
    }
    if (hasEntries(server.env)) {
      lines.push(`env = { ${inlineTomlTable(server.env)} }`);
    }
  } else {
    lines.push(`url = "${escapeTomlString(server.url || "")}"`);
    if (hasEntries(server.headers)) {
      lines.push(`http_headers = { ${inlineTomlTable(server.headers)} }`);
    }
  }
  return lines;
};

const CODEX_MCP_TABLE_PATTERN = /^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/;

const splitCodexMcpTableBlocks = (content: string): Array<{ name: string; lines: string[] }> => {
  const blocks: Array<{ name: string; lines: string[] }> = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of content.split(/\r?\n/)) {
    const match = CODEX_MCP_TABLE_PATTERN.exec(line.trim());
    if (match) {
      if (current) {
        blocks.push(current);
      }
      current = { name: match[1], lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }
  return blocks
    .map((block) => ({ ...block, lines: block.lines.filter((line, index, lines) => index < lines.length - 1 || line.trim().length > 0) }))
    .filter((block) => block.lines.length > 0);
};

export const mergeCodexMcpConfigToml = (existingContent: string | null | undefined, generatedContent: string): string => {
  const existing = existingContent?.trimEnd() ?? "";
  const generatedBlocks = splitCodexMcpTableBlocks(generatedContent);
  const generatedByName = new Map(generatedBlocks.map((block) => [block.name, block]));

  if (!existing) {
    const generated = generatedBlocks
      .map((block) => block.lines.join("\n").trimEnd())
      .filter(Boolean);
    return generated.length > 0 ? `${generated.join("\n")}\n` : "";
  }

  const emittedNames = new Set<string>();
  const outputLines: string[] = [];
  const existingLines = existing.split(/\r?\n/);

  for (let index = 0; index < existingLines.length;) {
    const line = existingLines[index] ?? "";
    const match = CODEX_MCP_TABLE_PATTERN.exec(line.trim());
    const generatedBlock = match ? generatedByName.get(match[1]) : undefined;
    if (match && generatedBlock) {
      outputLines.push(...generatedBlock.lines);
      emittedNames.add(match[1]);
      index += 1;
      while (index < existingLines.length && !/^\[.+\]\s*$/.test((existingLines[index] ?? "").trim())) {
        index += 1;
      }
      continue;
    }

    outputLines.push(line);
    index += 1;
  }

  const missingBlocks = generatedBlocks
    .filter((block) => !emittedNames.has(block.name))
    .map((block) => block.lines.join("\n").trimEnd())
    .filter(Boolean);

  const mergedExisting = outputLines.join("\n").trimEnd();
  if (missingBlocks.length === 0) {
    return `${mergedExisting}\n`;
  }
  return `${mergedExisting}\n\n${missingBlocks.join("\n")}\n`;
};


export interface ProviderMcpConfigBuildOptions {
  qwenSettingsContent?: string;
  rewriteUrl?: (url: string, enabled: boolean) => string;
  rewriteEnabled?: boolean;
  existingContent?: string | null;
}

export interface ProviderMcpConfigArtifact {
  filename: string;
  content: string;
  dockerMountDestination: string;
}

export const CLAUDE_CODE_MCP_CONFIG_MOUNT = "/opt/provider-config/claude-mcp.json";
export const GEMINI_MCP_SETTINGS_MOUNT = "/opt/provider-config/gemini-settings.json";
export const CODEX_MCP_CONFIG_MOUNT = "/opt/provider-config/codex-config.toml";
export const QWEN_CODE_SETTINGS_MOUNT = "/opt/provider-config/qwen-settings.json";
export const ANTIGRAVITY_MCP_CONFIG_MOUNT = "/opt/provider-config/antigravity-mcp.json";
export const MCP_STREAMABLE_HTTP_ACCEPT = "application/json, text/event-stream";

export function buildProviderMcpConfigArtifact(
  provider: CliProviderId,
  conn: McpConnectionInfo | null,
  customServers: CustomMcpServer[],
  options: ProviderMcpConfigBuildOptions = {}
): ProviderMcpConfigArtifact | null {
  const rewrite = (url: string) =>
    options.rewriteUrl ? options.rewriteUrl(url, options.rewriteEnabled ?? false) : url;

  const processedConn = conn ? { ...conn, url: rewrite(conn.url) } : null;
  const processedServers = sanitizeCustomMcpServers(customServers).map(server =>
    server.transport === "http" && server.url
      ? { ...server, url: rewrite(server.url) }
      : server
  );

  const headers: Record<string, string> = {};
  if (processedConn?.authToken) headers["Authorization"] = `Bearer ${processedConn.authToken}`;
  if (processedConn?.agentId) headers["X-Code-Ux-Agent"] = processedConn.agentId;
  if (processedConn?.executionInvocationId) {
    headers["X-Code-Ux-Invocation"] = processedConn.executionInvocationId;
  }
  if (processedConn?.threadId) headers["X-Code-Ux-Thread"] = processedConn.threadId;

  if (provider === "claude-code") {
    const mcpServers: Record<string, unknown> = {};
    if (processedConn) {
      mcpServers.code_ux = {
        type: "http",
        url: processedConn.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
    for (const server of processedServers) {
      mcpServers[server.name] = buildClaudeMcpServerEntry(server);
    }

    if (Object.keys(mcpServers).length === 0) return null;

    let existing: Record<string, unknown> = {};
    if (options.existingContent) {
      try { existing = JSON.parse(options.existingContent); } catch {}
    }

    existing.mcpServers = { ...(existing.mcpServers as Record<string, unknown> || {}), ...mcpServers };
    return {
      filename: "settings.local.json",
      content: JSON.stringify(existing, null, 2),
      dockerMountDestination: CLAUDE_CODE_MCP_CONFIG_MOUNT,
    };
  }

  if (provider === "gemini") {
    const mcpServers: Record<string, unknown> = {};
    let existing: Record<string, unknown> = {};
    if (options.existingContent) {
      try { existing = JSON.parse(options.existingContent); } catch {}
    }
    Object.assign(mcpServers, existing.mcpServers || {});

    if (processedConn) {
      mcpServers.code_ux = {
        httpUrl: processedConn.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
    for (const server of processedServers) {
      mcpServers[server.name] = buildGeminiMcpServerEntry(server);
    }

    if (Object.keys(mcpServers).length === 0) return null;

    existing.mcpServers = mcpServers;
    return {
      filename: "settings.json",
      content: JSON.stringify(existing, null, 2),
      dockerMountDestination: GEMINI_MCP_SETTINGS_MOUNT,
    };
  }

  if (provider === "qwen-code") {
    let settings: Record<string, unknown> = {};
    if (options.existingContent) {
      try { settings = JSON.parse(options.existingContent); } catch {}
    }
    if (options.qwenSettingsContent) {
      try {
        const generated = JSON.parse(options.qwenSettingsContent) as Record<string, unknown>;
        const existingMemory = settings.memory as Record<string, unknown> | undefined;
        const generatedMemory = generated.memory as Record<string, unknown> | undefined;
        settings = { ...settings, ...generated };
        if (existingMemory || generatedMemory) {
          settings.memory = {
            ...(existingMemory || {}),
            ...(generatedMemory || {}),
          };
        }
      } catch {}
      delete settings.enableOpenAILogging;
    }

    if (processedConn || processedServers.length > 0) {
      const existingMcpServers = (settings.mcpServers as Record<string, unknown>) || {};
      const mcpServers: Record<string, unknown> = { ...existingMcpServers };
      if (processedConn) {
        mcpServers.code_ux = existingMcpServers.code_ux || {
          httpUrl: processedConn.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        };
      }
      for (const server of processedServers) {
        mcpServers[server.name] = buildGeminiMcpServerEntry(server);
      }
      settings.mcpServers = mcpServers;
    }

    if (Object.keys(settings).length === 0) return null;

    return {
      filename: "settings.json",
      content: JSON.stringify(settings, null, 2),
      dockerMountDestination: QWEN_CODE_SETTINGS_MOUNT,
    };
  }

  if (provider === "antigravity") {
    const mcpServers: Record<string, unknown> = {};
    if (processedConn) {
      mcpServers.code_ux = {
        serverUrl: processedConn.url,
        headers: {
          ...headers,
          Accept: MCP_STREAMABLE_HTTP_ACCEPT,
        },
      };
    }
    for (const server of processedServers) {
      if (server.transport === "stdio") {
        mcpServers[server.name] = {
          command: server.command,
          ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
          ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
        };
      } else {
        mcpServers[server.name] = {
          serverUrl: server.url,
          ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
        };
      }
    }

    if (Object.keys(mcpServers).length === 0) return null;

    return {
      filename: "mcp_config.json",
      content: JSON.stringify({ mcpServers }, null, 2),
      dockerMountDestination: ANTIGRAVITY_MCP_CONFIG_MOUNT,
    };
  }

  if (provider === "codex") {
    if (!processedConn && processedServers.length === 0) return null;

    const lines: string[] = [];
    if (processedConn) {
      lines.push("[mcp_servers.code-ux]", `url = "${escapeTomlString(processedConn.url)}"`);
      const codexHeaderParts: string[] = [];
      if (processedConn.authToken) {
        codexHeaderParts.push(`"Authorization" = "Bearer ${escapeTomlString(processedConn.authToken)}"`);
      }
      if (processedConn.agentId) {
        codexHeaderParts.push(`"X-Code-Ux-Agent" = "${escapeTomlString(processedConn.agentId)}"`);
      }
      if (processedConn.executionInvocationId) {
        codexHeaderParts.push(`"X-Code-Ux-Invocation" = "${escapeTomlString(processedConn.executionInvocationId)}"`);
      }
      if (processedConn.threadId) {
        codexHeaderParts.push(`"X-Code-Ux-Thread" = "${escapeTomlString(processedConn.threadId)}"`);
      }
      if (codexHeaderParts.length > 0) {
        lines.push(`http_headers = { ${codexHeaderParts.join(", ")} }`);
      }
    }
    for (const server of processedServers) {
      lines.push(...buildCodexMcpServerTomlLines(server.name, server));
    }

    const generatedContent = lines.join("\n") + "\n";
    return {
      filename: "config.toml",
      content: options.existingContent === undefined
        ? generatedContent
        : mergeCodexMcpConfigToml(options.existingContent, generatedContent),
      dockerMountDestination: CODEX_MCP_CONFIG_MOUNT,
    };
  }

  return null;
}
