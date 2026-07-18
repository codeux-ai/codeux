import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import type { ProviderId } from "../contracts/app-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import {
  buildProviderMcpConfigArtifact,
  MCP_STREAMABLE_HTTP_ACCEPT,
} from "../infrastructure/providers/cli/mcp-config-format.js";

export type LocalMcpCliProvider = Extract<ProviderId, "claude-code" | "gemini" | "codex" | "qwen-code" | "opencode" | "antigravity">;

export interface LocalMcpCliProviderInfo {
  id: LocalMcpCliProvider;
  label: string;
  configPath: string;
}

export interface LocalMcpSetupInfo {
  enabled: boolean;
  url: string | null;
  authToken: string | null;
  providers: LocalMcpCliProviderInfo[];
}

export interface LocalMcpInstallResult {
  provider: LocalMcpCliProvider;
  configPath: string;
  installed: boolean;
}

const getHomeDir = (): string => process.env.CODE_UX_TEST_HOME?.trim() || os.homedir();

const getProviders = (): LocalMcpCliProviderInfo[] => {
  const homeDir = getHomeDir();
  return [
    { id: "claude-code", label: "Claude Code", configPath: path.join(homeDir, ".claude.json") },
    { id: "gemini", label: "Gemini", configPath: path.join(homeDir, ".gemini", "settings.json") },
    { id: "codex", label: "Codex", configPath: path.join(homeDir, ".codex", "config.toml") },
    { id: "qwen-code", label: "Qwen Code", configPath: path.join(homeDir, ".qwen", "settings.json") },
    { id: "opencode", label: "OpenCode", configPath: path.join(homeDir, ".config", "opencode", "opencode.json") },
    { id: "antigravity", label: "Antigravity", configPath: path.join(homeDir, ".gemini", "antigravity-cli", "mcp_config.json") },
  ];
};

const readTextFile = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const readJsonObject = async (filePath: string): Promise<Record<string, unknown>> => {
  const content = await readTextFile(filePath);
  if (!content?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const writeTextFile = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
};

const buildOpenCodeConfig = async (configPath: string, conn: McpConnectionInfo): Promise<string> => {
  const existing = await readJsonObject(configPath);
  const mcp = existing.mcp && typeof existing.mcp === "object" && !Array.isArray(existing.mcp)
    ? existing.mcp as Record<string, unknown>
    : {};
  const headers: Record<string, string> = {};
  if (conn.authToken) {
    headers.Authorization = `Bearer ${conn.authToken}`;
  }
  mcp.code_ux = {
    type: "remote",
    url: conn.url,
    enabled: true,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
  return `${JSON.stringify({ ...existing, mcp }, null, 2)}\n`;
};

const buildAntigravityConfig = async (configPath: string, conn: McpConnectionInfo): Promise<string> => {
  const existing = await readJsonObject(configPath);
  const mcpServers = existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
    ? existing.mcpServers as Record<string, unknown>
    : {};
  const headers: Record<string, string> = {};
  if (conn.authToken) {
    headers.Authorization = `Bearer ${conn.authToken}`;
  }
  mcpServers.code_ux = {
    serverUrl: conn.url,
    headers: {
      ...headers,
      Accept: MCP_STREAMABLE_HTTP_ACCEPT,
    },
  };
  return `${JSON.stringify({ ...existing, mcpServers }, null, 2)}\n`;
};

export class LocalMcpCliConfigService {
  listProviders(): LocalMcpCliProviderInfo[] {
    return getProviders().map((provider) => ({ ...provider }));
  }

  getSetupInfo(conn: McpConnectionInfo | null): LocalMcpSetupInfo {
    return {
      enabled: !!conn,
      url: conn?.url ?? null,
      authToken: conn?.authToken ?? null,
      providers: this.listProviders(),
    };
  }

  async installProvider(providerId: LocalMcpCliProvider, conn: McpConnectionInfo | null): Promise<LocalMcpInstallResult> {
    if (!conn) {
      throw new Error("MCP HTTP transport is not enabled.");
    }

    const provider = getProviders().find((entry) => entry.id === providerId);
    if (!provider) {
      throw new Error(`Unsupported local MCP CLI provider: ${providerId}`);
    }

    let content: string | null = null;
    if (providerId === "opencode") {
      content = await buildOpenCodeConfig(provider.configPath, conn);
    } else if (providerId === "antigravity") {
      content = await buildAntigravityConfig(provider.configPath, conn);
    } else {
      const existingContent = await readTextFile(provider.configPath);
      const artifact = buildProviderMcpConfigArtifact(providerId, conn, [], {
        existingContent,
      });
      content = artifact?.content ? `${artifact.content.trimEnd()}\n` : null;
    }

    if (!content) {
      throw new Error(`Failed to build ${provider.label} MCP configuration.`);
    }

    await writeTextFile(provider.configPath, content);
    return {
      provider: provider.id,
      configPath: provider.configPath,
      installed: true,
    };
  }
}
