import type {
  DashboardSettings,
  ExternalSettingsHints,
  ProviderId,
  ProviderSettings,
  ProviderStrategy,
  ThinkingMode,
} from "../../../contracts/app-types.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  PROVIDER_STRATEGIES,
  THINKING_MODES,
} from "../../../repositories/settings-defaults.js";

const normalizeProviderSettings = (
  input: Partial<Record<ProviderId, Partial<ProviderSettings>>> | undefined,
  externalHints?: ExternalSettingsHints,
  julesApiKeyFallback?: string
): Record<ProviderId, ProviderSettings> => {
  const result: Record<ProviderId, ProviderSettings> = {
    jules: { ...DEFAULT_PROVIDER_SETTINGS.jules },
    gemini: { ...DEFAULT_PROVIDER_SETTINGS.gemini },
    codex: { ...DEFAULT_PROVIDER_SETTINGS.codex },
    "claude-code": { ...DEFAULT_PROVIDER_SETTINGS["claude-code"] },
  };

  for (const providerId of PROVIDER_IDS) {
    const source = input?.[providerId];
    const fallbackApiKey = providerId === "jules"
      ? (julesApiKeyFallback || externalHints?.resolved.julesApiKey || "")
      : providerId === "gemini"
        ? (externalHints?.resolved.geminiApiKey || "")
        : providerId === "claude-code"
          ? (externalHints?.resolved.claudeCodeApiKey || "")
          : (externalHints?.resolved.codexApiKey || "");

    const normalizedThinkingMode = THINKING_MODES.includes(source?.thinkingMode as ThinkingMode)
      ? (source?.thinkingMode as ThinkingMode)
      : DEFAULT_PROVIDER_SETTINGS[providerId].thinkingMode;

    const weightCandidate = typeof source?.weight === "number" ? source.weight : DEFAULT_PROVIDER_SETTINGS[providerId].weight;
    const normalizedWeight = Number.isFinite(weightCandidate) ? Math.max(0, Math.round(weightCandidate)) : DEFAULT_PROVIDER_SETTINGS[providerId].weight;

    result[providerId] = {
      enabled: typeof source?.enabled === "boolean" ? source.enabled : DEFAULT_PROVIDER_SETTINGS[providerId].enabled,
      model: typeof source?.model === "string" && source.model.trim().length > 0
        ? source.model.trim()
        : DEFAULT_PROVIDER_SETTINGS[providerId].model,
      weight: normalizedWeight,
      thinkingMode: normalizedThinkingMode,
      apiKey: typeof source?.apiKey === "string" ? source.apiKey : fallbackApiKey,
    };
  }

  return result;
};

export const sanitizeAiProvider = (
  input: Partial<DashboardSettings> | undefined,
  externalHints?: ExternalSettingsHints
): DashboardSettings["aiProvider"] => {
  const aiProviderInput = (input?.aiProvider && typeof input.aiProvider === "object"
    ? input.aiProvider
    : {}) as Partial<DashboardSettings["aiProvider"]>;

  const normalizedProvider = PROVIDER_IDS.includes(aiProviderInput.provider as ProviderId)
    ? (aiProviderInput.provider as ProviderId)
    : DEFAULT_DASHBOARD_SETTINGS.aiProvider.provider;

  const normalizedStrategy = PROVIDER_STRATEGIES.includes(aiProviderInput.strategy as ProviderStrategy)
    ? (aiProviderInput.strategy as ProviderStrategy)
    : DEFAULT_DASHBOARD_SETTINGS.aiProvider.strategy;

  const julesApiKey = typeof aiProviderInput.julesApiKey === "string"
    ? aiProviderInput.julesApiKey
    : (externalHints?.resolved.julesApiKey || "");

  const providers = normalizeProviderSettings(aiProviderInput.providers, externalHints, julesApiKey);
  providers.jules.apiKey = julesApiKey || providers.jules.apiKey;

  return {
    provider: normalizedProvider,
    strategy: normalizedStrategy,
    providers,
    julesApiKey: providers.jules.apiKey,
  };
};
