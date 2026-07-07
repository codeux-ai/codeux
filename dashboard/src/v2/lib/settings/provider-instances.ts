import type {
  ExternalSettingsHints,
  ProviderConfigId,
  ProviderId,
  ProjectProviderSettings,
  ProjectSettings,
  SystemProviderCredentialSettings,
  SystemSettings,
} from "../../../types.js";
import { sanitizeSystemProviderConfig } from "../provider-runtime-preview.js";
import {
  DEFAULT_PROVIDER_CONFIG_FILE_PATHS,
  DEFAULT_PROVIDER_WEIGHT,
} from "../../../../../src/repositories/settings-defaults.js";

export const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  "mockup-cli": "Mockup CLI",
};

export const getProviderTypeLabel = (providerId: ProviderId): string => providerLabels[providerId];

export const getProviderDefaultAuthPath = (providerId: ProviderId): string => {
  switch (providerId) {
    case "gemini":
      return "~/.gemini";
    case "codex":
      return "~/.codex";
    case "claude-code":
      return "~/.claude";
    case "qwen-code":
      return "~/.qwen";
    case "opencode":
      return "~/.local/share/opencode";
    case "antigravity":
      return "~/.antigravity";
    default:
      return "";
  }
};

const getProviderDefaultConfigMode = (providerId: ProviderId): SystemProviderCredentialSettings["providerConfigMode"] => (
  providerId === "jules" || providerId === "mockup-cli" ? "none" : "copyHost"
);

const getProviderDefaultConfigPath = (providerId: ProviderId): string => (
  providerId === "jules" || providerId === "mockup-cli"
    ? ""
    : DEFAULT_PROVIDER_CONFIG_FILE_PATHS[providerId]
);

export const createProjectProviderDraft = (
  providerId: ProviderId,
  name: string,
): ProjectProviderSettings => ({
  provider: providerId,
  name,
  enabled: providerId !== "claude-code" && providerId !== "qwen-code" && providerId !== "opencode" && providerId !== "mockup-cli",
  model: providerId === "codex"
    ? "gpt-5.5"
    : providerId === "qwen-code"
      ? "qwen3-coder-plus"
      : providerId === "opencode"
        ? "anthropic/claude-sonnet-4-5"
        : "default",
  weight: DEFAULT_PROVIDER_WEIGHT,
  thinkingMode: providerId === "codex" || providerId === "claude-code" || providerId === "qwen-code" || providerId === "opencode" ? "HIGH" : "MEDIUM",
  maxConcurrentTasks: providerId === "jules" ? 15 : 0,
});

export const createSystemProviderDraft = (
  providerId: ProviderId,
  name: string,
): SystemProviderCredentialSettings => {
  const base: SystemProviderCredentialSettings = {
    provider: providerId,
    name,
    apiKey: "",
    authType: "apiKey",
    mountAuth: false,
    authPath: getProviderDefaultAuthPath(providerId),
    providerConfigMode: getProviderDefaultConfigMode(providerId),
    providerConfigPath: getProviderDefaultConfigPath(providerId),
  };

  if (providerId === "qwen-code") {
    return {
      ...base,
      qwenAuthMode: "MODEL_PROVIDER",
      qwenRegion: "international",
      qwenBaseUrl: "http://127.0.0.1:11434/v1",
      qwenEnvKey: "OLLAMA_API_KEY",
      qwenModelId: "glm-4.7-flash",
      qwenProtocol: "openai",
      qwenAdditionalModelProviders: [],
    };
  }

  if (providerId === "opencode") {
    return {
      ...base,
      openCodeAuthMode: "ENV_KEY",
      openCodeProviderId: "ollama",
      openCodeModelId: "glm-4.7-flash",
      openCodeBaseUrl: "http://127.0.0.1:11434/v1",
      openCodeEnvKey: "OLLAMA_API_KEY",
      openCodePackage: "@ai-sdk/openai-compatible",
    };
  }

  return base;
};

const getProviderInstanceSortKey = (
  providerConfigId: ProviderConfigId,
  providerType: ProviderId,
): { isPrimary: number; createdAt: number } => {
  if (providerConfigId === providerType) {
    return { isPrimary: 0, createdAt: 0 };
  }
  const suffix = providerConfigId.startsWith(`${providerType}-`)
    ? providerConfigId.slice(providerType.length + 1)
    : providerConfigId;
  const createdAt = Number.parseInt(suffix.split("-")[0], 36);
  return { isPrimary: 1, createdAt: Number.isFinite(createdAt) ? createdAt : Number.MAX_SAFE_INTEGER };
};

export const sortProviderConfigEntries = <T extends { provider: ProviderId; name: string }>(
  entries: Array<[ProviderConfigId, T]>,
): Array<[ProviderConfigId, T]> => (
  [...entries].sort((left, right) => {
    const providerCompare = getProviderTypeLabel(left[1].provider).localeCompare(getProviderTypeLabel(right[1].provider));
    if (providerCompare !== 0) {
      return providerCompare;
    }
    const leftKey = getProviderInstanceSortKey(left[0], left[1].provider);
    const rightKey = getProviderInstanceSortKey(right[0], right[1].provider);
    if (leftKey.isPrimary !== rightKey.isPrimary) {
      return leftKey.isPrimary - rightKey.isPrimary;
    }
    if (leftKey.createdAt !== rightKey.createdAt) {
      return leftKey.createdAt - rightKey.createdAt;
    }
    return left[0].localeCompare(right[0]);
  })
);

export const getProviderInstanceLabel = (provider: { provider: ProviderId; name: string }): string => (
  `${provider.name} · ${getProviderTypeLabel(provider.provider)}`
);

export const getHintApiKey = (
  providerId: ProviderId,
  hints: ExternalSettingsHints | null,
): string => {
  if (providerId === "jules") {
    return hints?.resolved.julesApiKey || "";
  }
  if (providerId === "gemini") {
    return hints?.resolved.geminiApiKey || "";
  }
  if (providerId === "codex") {
    return hints?.resolved.codexApiKey || "";
  }
  if (providerId === "claude-code") {
    return hints?.resolved.claudeCodeApiKey || "";
  }
  if (providerId === "qwen-code") {
    return hints?.resolved.qwenCodeApiKey || "";
  }
  if (providerId === "antigravity") {
    return hints?.resolved.antigravityApiKey || "";
  }
  if (providerId === "mockup-cli") {
    return "";
  }
  return hints?.resolved.openCodeApiKey || "";
};

export const getLegacyIntegrationApiKey = (
  systemSettings: SystemSettings | null,
  providerId: ProviderId,
): string => {
  const integrations = (systemSettings?.integrations || {}) as Record<string, unknown>;
  if (providerId === "jules") {
    return typeof integrations.julesApiKey === "string" ? integrations.julesApiKey : "";
  }
  if (providerId === "gemini") {
    return typeof integrations.geminiApiKey === "string" ? integrations.geminiApiKey : "";
  }
  if (providerId === "codex") {
    return typeof integrations.codexApiKey === "string" ? integrations.codexApiKey : "";
  }
  if (providerId === "claude-code") {
    return typeof integrations.claudeCodeApiKey === "string" ? integrations.claudeCodeApiKey : "";
  }
  if (providerId === "qwen-code") {
    return typeof integrations.qwenCodeApiKey === "string" ? integrations.qwenCodeApiKey : "";
  }
  if (providerId === "antigravity") {
    return typeof integrations.antigravityApiKey === "string" ? integrations.antigravityApiKey : "";
  }
  if (providerId === "mockup-cli") {
    return "";
  }
  return typeof integrations.openCodeApiKey === "string" ? integrations.openCodeApiKey : "";
};

export const getSystemIntegrationProviders = (
  systemSettings: SystemSettings | null,
): Record<ProviderConfigId, SystemProviderCredentialSettings> => {
  const providers = systemSettings?.integrations?.providers;
  if (providers && Object.keys(providers).length > 0) {
    return Object.fromEntries(
      Object.entries(providers).map(([id, config]) => [id, sanitizeSystemProviderConfig(config)])
    );
  }

  const fallback: Record<ProviderConfigId, SystemProviderCredentialSettings> = {};
  for (const providerId of ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"] as ProviderId[]) {
    const apiKey = getLegacyIntegrationApiKey(systemSettings, providerId);
    fallback[providerId] = sanitizeSystemProviderConfig({
      ...createSystemProviderDraft(providerId, getProviderTypeLabel(providerId)),
      apiKey,
    });
  }
  return fallback;
};

export const inferProviderTypeFromConfigId = (providerConfigId: ProviderConfigId): ProviderId | null => {
  if (providerConfigId === "jules" || providerConfigId.startsWith("jules-")) return "jules";
  if (providerConfigId === "gemini" || providerConfigId.startsWith("gemini-")) return "gemini";
  if (providerConfigId === "codex" || providerConfigId.startsWith("codex-")) return "codex";
  if (providerConfigId === "claude-code" || providerConfigId.startsWith("claude-code-") || providerConfigId.startsWith("claude-")) return "claude-code";
  if (providerConfigId === "qwen-code" || providerConfigId.startsWith("qwen-code-") || providerConfigId.startsWith("qwen-")) return "qwen-code";
  if (providerConfigId === "opencode" || providerConfigId.startsWith("opencode-")) return "opencode";
  if (providerConfigId === "antigravity" || providerConfigId.startsWith("antigravity-")) return "antigravity";
  return null;
};

export const getSystemProvidersByType = (
  systemSettings: SystemSettings | null,
  providerId: ProviderId,
): Array<[ProviderConfigId, SystemProviderCredentialSettings]> => (
  Object.entries(getSystemIntegrationProviders(systemSettings))
    .filter(([, provider]) => provider.provider === providerId)
);

export const getProjectProvidersByType = (
  settings: ProjectSettings,
  providerId: ProviderId,
): Array<[ProviderConfigId, ProjectProviderSettings]> => (
  Object.entries(settings.aiProvider.providers)
    .filter(([providerConfigId, provider]) => (provider.provider || inferProviderTypeFromConfigId(providerConfigId)) === providerId)
);

export const hasProviderInstanceApiKey = (
  providerConfigId: ProviderConfigId,
  systemSettings: SystemSettings | null,
): boolean => Boolean(getSystemIntegrationProviders(systemSettings)[providerConfigId]?.apiKey?.trim());

const hasAnyProviderApiKey = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): boolean => (
  getSystemProvidersByType(systemSettings, providerId).some(([, provider]) => provider.apiKey.trim().length > 0)
  || Boolean(getLegacyIntegrationApiKey(systemSettings, providerId).trim())
  || Boolean(getHintApiKey(providerId, hints).trim())
);

export const providerSupportsModelSelection = (providerId: ProviderId): boolean => providerId !== "jules";

export const providerSupportsThinkingMode = (providerId: ProviderId): boolean => providerId !== "jules";

export const isProviderAvailable = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): boolean => (
  hasAnyProviderApiKey(providerId, systemSettings, hints)
  || (providerId !== "jules" && getSystemProvidersByType(systemSettings, providerId).some(([, provider]) => provider.mountAuth))
);

export const isProviderInstanceAvailable = (
  providerConfigId: ProviderConfigId,
  systemSettings: SystemSettings | null,
): boolean => {
  const providerConfig = getSystemIntegrationProviders(systemSettings)[providerConfigId];
  const providerType = providerConfig?.provider;
  if (!providerType) {
    return false;
  }
  return hasProviderInstanceApiKey(providerConfigId, systemSettings)
    || (providerType !== "jules" && providerConfig.mountAuth);
};

export const getProviderInstanceAuthLabel = (
  providerConfigId: ProviderConfigId,
  systemSettings: SystemSettings | null,
  dockerExecutionEnabled: boolean,
): string | null => {
  const providerConfig = getSystemIntegrationProviders(systemSettings)[providerConfigId];
  const providerType = providerConfig?.provider;
  if (!providerType) {
    return null;
  }
  const hasApiKey = hasProviderInstanceApiKey(providerConfigId, systemSettings);
  const hasMountedAuth = providerType !== "jules" && providerConfig.mountAuth;

  if (providerType === "jules") {
    return hasApiKey ? "API key" : null;
  }

  if (providerConfig.authType === "dashboardAuth") {
    return "Dashboard login";
  }

  if (hasMountedAuth && hasApiKey) {
    return dockerExecutionEnabled ? "Auth mount + API key" : "Mount config + API key";
  }
  if (hasMountedAuth) {
    return dockerExecutionEnabled ? "Auth mount enabled" : "Mount config enabled";
  }
  return hasApiKey ? "API key" : null;
};

export const getProviderAuthLabel = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
  dockerExecutionEnabled: boolean,
): string | null => {
  const systemProviders = getSystemProvidersByType(systemSettings, providerId);
  if (systemProviders.length > 0) {
    const labels = systemProviders
      .map(([providerConfigId]) => getProviderInstanceAuthLabel(providerConfigId, systemSettings, dockerExecutionEnabled))
      .filter((label): label is string => Boolean(label));
    if (labels.length > 0) {
      return labels.length === 1 ? labels[0] : `${labels.length} credentials`;
    }
  }
  return hasAnyProviderApiKey(providerId, systemSettings, hints) ? "API key" : null;
};

export const getEligibleProviders = (
  systemSettings: SystemSettings | null,
  editableSettings: ProjectSettings,
  hints: ExternalSettingsHints | null,
): ProviderConfigId[] => (
  Object.entries(editableSettings.aiProvider.providers)
    .filter(([providerConfigId, provider]) => {
      const providerType = provider.provider || inferProviderTypeFromConfigId(providerConfigId);
      if (!providerType) {
        return false;
      }
      return provider.enabled && (isProviderInstanceAvailable(providerConfigId, systemSettings)
        || Boolean(getHintApiKey(providerType, hints)));
    })
    .map(([providerConfigId]) => providerConfigId)
);

export const countConnectedProviders = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): number => {
  const stored = getSystemProvidersByType(systemSettings, providerId)
    .filter(([, provider]) => provider.apiKey.trim().length > 0 || (provider.provider !== "jules" && provider.mountAuth))
    .length;
  return Math.max(stored, hints && getHintApiKey(providerId, hints).trim() ? 1 : 0);
};
