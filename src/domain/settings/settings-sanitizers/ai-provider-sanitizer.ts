import type {
  DashboardSettings,
  ExternalSettingsHints,
  InvocationRoutingId,
  InvocationRoutingProfile,
  ProviderStrategy,
} from "../../../contracts/app-types.js";
import type {
  ProjectAiProviderSettings,
  ProjectProviderSettings,
  SystemProviderCredentialSettings,
} from "../../../contracts/settings-scope-types.js";
import {
  buildProjectProviderSettings,
  buildDefaultIntegrationProviders,
  resolveAllowedProviderConfigIds,
  resolveInvocationProviderOverrides,
  resolveProviderConfigId,
} from "../provider-config-utils.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_INVOCATION_ROUTING,
  INVOCATION_ROUTING_IDS,
  INVOCATION_ROUTING_PROFILES,
  PROVIDER_STRATEGIES,
} from "../../../repositories/settings-defaults.js";

interface SanitizeAiProviderOptions {
  externalHints?: ExternalSettingsHints;
  integrationProviders?: Record<string, SystemProviderCredentialSettings>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const normalizeInvocationRouting = (
  input: unknown,
  availableProviders: Record<string, ProjectProviderSettings>,
): ProjectAiProviderSettings["invocationRouting"] => {
  const result = {} as ProjectAiProviderSettings["invocationRouting"];
  const routingInput = isRecord(input) ? input : {};

  const isLegacyDashboardReplyDefault = (source: Record<string, unknown> | undefined): boolean => {
    if (!source) {
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
    const source = isRecord(routingInput[routeId]) ? routingInput[routeId] : undefined;
    const defaults = DEFAULT_INVOCATION_ROUTING[routeId];
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
      provider: resolveProviderConfigId(source?.provider, availableProviders),
      allowedProviders: resolveAllowedProviderConfigIds(source?.allowedProviders, availableProviders),
      providers: resolveInvocationProviderOverrides(source?.providers, availableProviders),
    };
  }

  return result;
};

export const sanitizeAiProvider = (
  input: Partial<DashboardSettings> | undefined,
  options: SanitizeAiProviderOptions = {},
): ProjectAiProviderSettings => {
  const aiProviderInput = (input?.aiProvider && typeof input.aiProvider === "object"
    ? input.aiProvider
    : {}) as Record<string, unknown>;

  const integrationProviders = options.integrationProviders || buildDefaultIntegrationProviders(options.externalHints);
  const providers = buildProjectProviderSettings(aiProviderInput.providers, integrationProviders);
  const defaultProviderId = DEFAULT_DASHBOARD_SETTINGS.aiProvider.provider || Object.keys(providers)[0] || null;

  return {
    provider: resolveProviderConfigId(
      aiProviderInput.provider,
      providers,
      defaultProviderId ? providers[defaultProviderId]?.provider || "jules" : "jules",
    ) || defaultProviderId,
    strategy: PROVIDER_STRATEGIES.includes(aiProviderInput.strategy as ProviderStrategy)
      ? aiProviderInput.strategy as ProviderStrategy
      : DEFAULT_DASHBOARD_SETTINGS.aiProvider.strategy,
    providers,
    invocationRouting: normalizeInvocationRouting(aiProviderInput.invocationRouting, providers),
  };
};
