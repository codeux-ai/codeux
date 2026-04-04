import type {
  DashboardSettings,
  ExternalSettingsHints,
  InvocationProviderOverrideSettings,
  InvocationRoutingId,
  InvocationRoutingProfile,
  InvocationRoutingSettings,
  ProviderId,
  ProviderSettings,
  ProviderStrategy,
  ThinkingMode,
} from "../../../contracts/app-types.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_INVOCATION_ROUTING,
  DEFAULT_PROVIDER_SETTINGS,
  INVOCATION_ROUTING_IDS,
  INVOCATION_ROUTING_PROFILES,
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
      maxConcurrentTasks: typeof source?.maxConcurrentTasks === "number" ? source.maxConcurrentTasks : DEFAULT_PROVIDER_SETTINGS[providerId].maxConcurrentTasks,
    };
  }

  return result;
};

const normalizeInvocationProviderOverride = (
  input: unknown,
): InvocationProviderOverrideSettings | undefined => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const source = input as Partial<InvocationProviderOverrideSettings>;
  const result: InvocationProviderOverrideSettings = {};

  if (typeof source.enabled === "boolean") {
    result.enabled = source.enabled;
  }
  if (typeof source.model === "string" && source.model.trim().length > 0) {
    result.model = source.model.trim();
  }
  if (typeof source.weight === "number" && Number.isFinite(source.weight)) {
    result.weight = Math.max(0, Math.round(source.weight));
  }
  if (THINKING_MODES.includes(source.thinkingMode as ThinkingMode)) {
    result.thinkingMode = source.thinkingMode as ThinkingMode;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeInvocationRouting = (
  input: Partial<Record<InvocationRoutingId, Partial<InvocationRoutingSettings>>> | undefined,
): Record<InvocationRoutingId, InvocationRoutingSettings> => {
  const result = {} as Record<InvocationRoutingId, InvocationRoutingSettings>;

  const isLegacyDashboardReplyDefault = (source: Partial<InvocationRoutingSettings> | undefined): boolean => {
    if (!source || typeof source !== "object") {
      return false;
    }

    const hasProviderOverrides = !!(
      source.providers
      && typeof source.providers === "object"
      && !Array.isArray(source.providers)
      && Object.keys(source.providers).length > 0
    );

    return source.profile === "GLOBAL"
      && (source.strategy === undefined || source.strategy === "MANUAL")
      && (source.provider === undefined || source.provider === null)
      && (!Array.isArray(source.allowedProviders) || source.allowedProviders.length === 0)
      && !hasProviderOverrides;
  };

  for (const routeId of INVOCATION_ROUTING_IDS) {
    const source = input?.[routeId];
    const defaults = DEFAULT_INVOCATION_ROUTING[routeId];
    const providers: Partial<Record<ProviderId, InvocationProviderOverrideSettings>> = {};
    const sourceProviders = source?.providers && typeof source.providers === "object" && !Array.isArray(source.providers)
      ? source.providers
      : {};

    for (const providerId of PROVIDER_IDS) {
      const normalizedOverride = normalizeInvocationProviderOverride(sourceProviders[providerId]);
      if (normalizedOverride) {
        providers[providerId] = normalizedOverride;
      }
    }

    const allowedProviders = Array.isArray(source?.allowedProviders)
      ? source.allowedProviders.filter((value): value is ProviderId => PROVIDER_IDS.includes(value as ProviderId))
      : defaults.allowedProviders;

    const normalizedProfile = routeId === "dashboard_reply" && isLegacyDashboardReplyDefault(source)
      ? defaults.profile
      : INVOCATION_ROUTING_PROFILES.includes(source?.profile as InvocationRoutingProfile)
        ? source?.profile as InvocationRoutingProfile
        : defaults.profile;

    result[routeId] = {
      profile: normalizedProfile,
      strategy: PROVIDER_STRATEGIES.includes(source?.strategy as ProviderStrategy)
        ? source?.strategy as ProviderStrategy
        : defaults.strategy,
      provider: source?.provider === null
        ? null
        : PROVIDER_IDS.includes(source?.provider as ProviderId)
          ? source?.provider as ProviderId
          : defaults.provider,
      allowedProviders: [...allowedProviders],
      providers,
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
    invocationRouting: normalizeInvocationRouting(aiProviderInput.invocationRouting),
    julesApiKey: providers.jules.apiKey,
  };
};
