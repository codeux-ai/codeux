import { fetchJson } from "../../lib/api/fetch-json.js";
import type { ProviderId } from "../types.js";

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

export const fetchLocalMcpSetup = async (): Promise<LocalMcpSetupInfo> =>
  fetchJson<LocalMcpSetupInfo>("/api/settings/local-mcp", { cache: "no-store" });

export const regenerateLocalMcpToken = async (): Promise<LocalMcpSetupInfo> =>
  fetchJson<LocalMcpSetupInfo>("/api/settings/local-mcp/regenerate-token", { method: "POST" });

export const installLocalMcpProvider = async (provider: LocalMcpCliProvider): Promise<LocalMcpInstallResult> =>
  fetchJson<LocalMcpInstallResult>("/api/settings/local-mcp/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
