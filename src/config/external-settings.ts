import os from "os";
import * as path from "path";
import * as fs from "fs";
import type { ExternalSettingsHints } from "../contracts/app-types.js";
import { buildCandidatePaths } from "../shared/config/search-paths.js";
import { readString } from "../shared/config/value-readers.js";
import { getRelativeCodeUxPath } from "../shared/config/code-ux-paths.js";

/**
 * Local authentication file artifacts relative to homedir.
 *
 * Each entry is a tuple of path segments; they are joined with `path.join`
 * at lookup time so the resulting paths use the host OS separator.
 */
const PROVIDER_LOCAL_AUTH_MAP: Record<string, ReadonlyArray<ReadonlyArray<string>>> = {
  jules: [],
  gemini: [
    [".gemini", "settings.json"],
    [".gemini", "oauth_creds.json"],
    [".gemini", "google_accounts.json"],
    [".gemini", "installation_id"],
    [".gemini", "state.json"],
    [".gemini", "trustedFolders.json"],
  ],
  codex: [[".codex", "auth.json"], [".codex", "config.toml"]],
  claudeCode: [[".claude", ".credentials.json"], [".claude.json"]],
  qwenCode: [[".qwen", "settings.json"], [".qwen", ".env"]],
  openCode: [[".local", "share", "opencode", "auth.json"], [".config", "opencode", "opencode.json"]],
  antigravity: [[".antigravity", "settings.json"]],
};

/**
 * Normalization map for setting keys across different sources (Env, JSON).
 */
const PROVIDER_KEY_MAP = {
  julesApiKey: ["julesApiKey", "JULES_API_KEY", "julesKey", "JULES_KEY"],
  geminiApiKey: ["geminiApiKey", "GEMINI_API_KEY"],
  codexApiKey: ["codexApiKey", "OPENAI_API_KEY"],
  claudeCodeApiKey: ["claudeCodeApiKey", "ANTHROPIC_API_KEY", "claudeApiKey", "CLAUDE_API_KEY"],
  qwenCodeApiKey: ["qwenCodeApiKey", "DASHSCOPE_API_KEY", "BAILIAN_CODING_PLAN_API_KEY", "QWEN_API_KEY"],
  openCodeApiKey: ["openCodeApiKey", "OPENCODE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GITHUB_TOKEN"],
  antigravityApiKey: ["antigravityApiKey", "ANTIGRAVITY_API_KEY"],
  githubToken: ["githubToken", "GITHUB_TOKEN", "GH_TOKEN"],
  gitlabToken: ["gitlabToken", "GITLAB_TOKEN", "GLAB_TOKEN"],
  jiraToken: ["jiraToken", "JIRA_API_TOKEN", "JIRA_TOKEN"],
} as const;

type ProviderKey = keyof typeof PROVIDER_KEY_MAP;

export interface ExternalSettingsMigrationValues {
  env: Record<ProviderKey, string>;
  settingsJson: Record<ProviderKey, string>;
  resolved: Record<ProviderKey, string>;
}

const readSettingsJson = (projectRoot: string): Record<string, unknown> => {
  const settingsRelativePath = getRelativeCodeUxPath("settings.json");
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

export const loadExternalSettingsMigrationValues = (projectRoot: string): ExternalSettingsMigrationValues => {
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
    env: envHints as ExternalSettingsMigrationValues["env"],
    settingsJson: jsonHints as ExternalSettingsMigrationValues["settingsJson"],
    resolved: resolvedHints as ExternalSettingsMigrationValues["resolved"],
  };
};

export const buildExternalSettingsHints = (
  values: ExternalSettingsMigrationValues,
): ExternalSettingsHints => {
  const homedir = os.homedir();
  const providerAvailability: ExternalSettingsHints["providerAvailability"] = {
    jules: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
    gemini: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
    codex: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
    claudeCode: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
    qwenCode: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
    openCode: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
    antigravity: { hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false },
  };

  const keyToProvider: Record<string, keyof ExternalSettingsHints["providerAvailability"]> = {
    julesApiKey: "jules",
    geminiApiKey: "gemini",
    codexApiKey: "codex",
    claudeCodeApiKey: "claudeCode",
    qwenCodeApiKey: "qwenCode",
    openCodeApiKey: "openCode",
    antigravityApiKey: "antigravity",
  };

  const getDashboardFolder = (p: string): string => {
    if (p === "claudeCode") return "claude-code";
    if (p === "qwenCode") return "qwen-code";
    if (p === "openCode") return "opencode";
    return p;
  };

  for (const [key, provider] of Object.entries(keyToProvider)) {
    providerAvailability[provider].hasApiKey = Boolean(values.resolved[key as ProviderKey]);

    const localAuthFiles = PROVIDER_LOCAL_AUTH_MAP[provider];
    providerAvailability[provider].hasLocalAuth = localAuthFiles.some((segments) =>
      fs.existsSync(path.join(homedir, ...segments))
    );

    if (provider !== "jules") {
      const dashboardCredsDir = path.join(homedir, ".code-ux", "credentials", getDashboardFolder(provider));
      let hasDashboardAuth = false;
      try {
        if (fs.existsSync(dashboardCredsDir)) {
          const files = fs.readdirSync(dashboardCredsDir);
          hasDashboardAuth = files.length > 0;
        }
      } catch {
        // Ignore
      }
      providerAvailability[provider].hasDashboardAuth = hasDashboardAuth;
    }
  }

  return {
    sourceAvailability: {
      environment: Object.values(values.env).some(Boolean),
      settingsJson: Object.values(values.settingsJson).some(Boolean),
    },
    credentialAvailability: Object.fromEntries(
      Object.keys(PROVIDER_KEY_MAP).map((key) => [key, Boolean(values.resolved[key as ProviderKey])]),
    ) as ExternalSettingsHints["credentialAvailability"],
    providerAvailability,
  };
};

export const loadExternalSettingsHints = (projectRoot: string): ExternalSettingsHints => (
  buildExternalSettingsHints(loadExternalSettingsMigrationValues(projectRoot))
);

export const serializeExternalSettingsHints = (input: unknown): ExternalSettingsHints => {
  const hints = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const sourceAvailability = hints.sourceAvailability && typeof hints.sourceAvailability === "object"
    ? hints.sourceAvailability as Record<string, unknown>
    : {};
  const credentialAvailability = hints.credentialAvailability && typeof hints.credentialAvailability === "object"
    ? hints.credentialAvailability as Record<string, unknown>
    : {};
  const legacyEnv = hints.env && typeof hints.env === "object" ? hints.env as Record<string, unknown> : {};
  const legacySettingsJson = hints.settingsJson && typeof hints.settingsJson === "object"
    ? hints.settingsJson as Record<string, unknown>
    : {};
  const legacyResolved = hints.resolved && typeof hints.resolved === "object"
    ? hints.resolved as Record<string, unknown>
    : {};
  const rawProviderAvailability = hints.providerAvailability && typeof hints.providerAvailability === "object"
    ? hints.providerAvailability as Record<string, unknown>
    : {};
  const credentialConfigured = (key: ProviderKey): boolean => (
    credentialAvailability[key] === true || Boolean(legacyResolved[key])
  );
  const providerMetadata = (
    provider: keyof ExternalSettingsHints["providerAvailability"],
    key: ProviderKey,
  ): ExternalSettingsHints["providerAvailability"][typeof provider] => {
    const raw = rawProviderAvailability[provider];
    const availability = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      hasApiKey: availability.hasApiKey === true || credentialConfigured(key),
      hasLocalAuth: availability.hasLocalAuth === true,
      hasDashboardAuth: availability.hasDashboardAuth === true,
    };
  };

  return {
    sourceAvailability: {
      environment: sourceAvailability.environment === true || Object.values(legacyEnv).some(Boolean),
      settingsJson: sourceAvailability.settingsJson === true || Object.values(legacySettingsJson).some(Boolean),
    },
    credentialAvailability: Object.fromEntries(
      Object.keys(PROVIDER_KEY_MAP).map((key) => [key, credentialConfigured(key as ProviderKey)]),
    ) as ExternalSettingsHints["credentialAvailability"],
    providerAvailability: {
      jules: providerMetadata("jules", "julesApiKey"),
      gemini: providerMetadata("gemini", "geminiApiKey"),
      codex: providerMetadata("codex", "codexApiKey"),
      claudeCode: providerMetadata("claudeCode", "claudeCodeApiKey"),
      qwenCode: providerMetadata("qwenCode", "qwenCodeApiKey"),
      openCode: providerMetadata("openCode", "openCodeApiKey"),
      antigravity: providerMetadata("antigravity", "antigravityApiKey"),
    },
  };
};
