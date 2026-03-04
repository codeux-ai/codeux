import * as fs from "fs";
import * as path from "path";
import type { ExternalSettingsHints } from "../contracts/app-types.js";
import { buildCandidatePaths } from "../shared/config/search-paths.js";
import { readString } from "../shared/config/value-readers.js";

/**
 * Normalization map for setting keys across different sources (Env, JSON).
 */
const PROVIDER_KEY_MAP = {
  julesApiKey: ["julesApiKey", "JULES_API_KEY", "julesKey", "JULES_KEY"],
  geminiApiKey: ["geminiApiKey", "GEMINI_API_KEY"],
  codexApiKey: ["codexApiKey", "OPENAI_API_KEY"],
  claudeCodeApiKey: ["claudeCodeApiKey", "ANTHROPIC_API_KEY", "claudeApiKey", "CLAUDE_API_KEY"],
  githubToken: ["githubToken", "GITHUB_TOKEN", "GH_TOKEN"],
} as const;

type ProviderKey = keyof typeof PROVIDER_KEY_MAP;

const readSettingsJson = (projectRoot: string): Record<string, unknown> => {
  const settingsRelativePath = path.join(".jules-subagents", "settings.json");
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

  return {
    env: envHints as ExternalSettingsHints["env"],
    settingsJson: jsonHints as ExternalSettingsHints["settingsJson"],
    resolved: resolvedHints as ExternalSettingsHints["resolved"],
  };
};
