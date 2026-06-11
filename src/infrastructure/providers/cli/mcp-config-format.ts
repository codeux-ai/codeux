import type { CustomMcpServer } from "../../../contracts/app-types.js";

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
