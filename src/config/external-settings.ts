import os from "os";
import * as path from "path";
import * as fs from "fs";
import type { ExternalSettingsHints } from "../contracts/app-types.js";
import { buildCandidatePaths } from "../shared/config/search-paths.js";
import { readString } from "../shared/config/value-readers.js";
import { getRelativeSprintOsPath } from "../shared/config/sprint-os-paths.js";

/**
 * Local authentication file artifacts relative to homedir.
 */
const PROVIDER_LOCAL_AUTH_MAP = {
  jules: [],
  gemini: [
    ".gemini/settings.json",
    ".gemini/oauth_creds.json",
    ".gemini/google_accounts.json",
    ".gemini/installation_id",
    ".gemini/state.json",
    ".gemini/trustedFolders.json",
  ],
  codex: [".codex/auth.json", ".codex/config.toml"],
  claudeCode: [".claude/.credentials.json", ".claude.json"],
  qwenCode: [".qwen/settings.json", ".qwen/.env"],
} as const;

/**
 * Normalization map for setting keys across different sources (Env, JSON).
 */
const PROVIDER_KEY_MAP = {
  julesApiKey: ["julesApiKey", "JULES_API_KEY", "julesKey", "JULES_KEY"],
  geminiApiKey: ["geminiApiKey", "GEMINI_API_KEY"],
  codexApiKey: ["codexApiKey", "OPENAI_API_KEY"],
  claudeCodeApiKey: ["claudeCodeApiKey", "ANTHROPIC_API_KEY", "claudeApiKey", "CLAUDE_API_KEY"],
  qwenCodeApiKey: ["qwenCodeApiKey", "DASHSCOPE_API_KEY", "BAILIAN_CODING_PLAN_API_KEY", "QWEN_API_KEY"],
  githubToken: ["githubToken", "GITHUB_TOKEN", "GH_TOKEN"],
} as const;

type ProviderKey = keyof typeof PROVIDER_KEY_MAP;

const readSettingsJson = (projectRoot: string): Record<string, unknown> => {
  const settingsRelativePath = getRelativeSprintOsPath("settings.json");
  const searchPaths = buildCandidatePaths(settingsRelativePath, projectRoot);

  for (const settingsPath of searchPaths) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid settings files
    }
  }
  return {};
};

/**
 * Resolves a key from multiple potential aliases in a source.
 */
const resolveFromSource = (source: Record<string, unknown>, keys: readonly string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      const resolved = readString(value, "").trim();
      if (resolved) {
        return resolved;
      }
    }
  }
  return "";
};

export const loadExternalSettingsHints = (projectRoot: string): ExternalSettingsHints => {
  const parsedSettings = readSettingsJson(projectRoot);
  const envSource = process.env as Record<string, unknown>;

  const envHints: Record<string, string> = {};
  const jsonHints: Record<string, string> = {};
  const resolvedHints: Record<string, string> = {};

  for (const [provider, aliases] of Object.entries(PROVIDER_KEY_MAP)) {
    const envValue = resolveFromSource(envSource, aliases);
    const jsonValue = resolveFromSource(parsedSettings, aliases);

    envHints[provider] = envValue;
    jsonHints[provider] = jsonValue;
    resolvedHints[provider] = envValue || jsonValue;
  }

  const homedir = os.homedir();
  const providerAvailability: ExternalSettingsHints["providerAvailability"] = {
    jules: { hasApiKey: false, hasLocalAuth: false },
    gemini: { hasApiKey: false, hasLocalAuth: false },
    codex: { hasApiKey: false, hasLocalAuth: false },
    claudeCode: { hasApiKey: false, hasLocalAuth: false },
    qwenCode: { hasApiKey: false, hasLocalAuth: false },
  };

  const keyToProvider: Record<string, keyof ExternalSettingsHints["providerAvailability"]> = {
    julesApiKey: "jules",
    geminiApiKey: "gemini",
    codexApiKey: "codex",
    claudeCodeApiKey: "claudeCode",
    qwenCodeApiKey: "qwenCode",
  };

  for (const [key, provider] of Object.entries(keyToProvider)) {
    providerAvailability[provider].hasApiKey = !!resolvedHints[key];

    const localAuthFiles = PROVIDER_LOCAL_AUTH_MAP[provider];
    providerAvailability[provider].hasLocalAuth = localAuthFiles.some((file) =>
      fs.existsSync(path.join(homedir, file))
    );
  }

  return {
    env: envHints as ExternalSettingsHints["env"],
    settingsJson: jsonHints as ExternalSettingsHints["settingsJson"],
    resolved: resolvedHints as ExternalSettingsHints["resolved"],
    providerAvailability,
  };
};
