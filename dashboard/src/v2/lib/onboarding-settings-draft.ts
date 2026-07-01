import type {
  OnboardingProviderCredentialStatus,
  ProviderConfigId,
  ProviderId,
  ProjectSettings,
  SystemSettings
} from "../../types.js";
import {
  createProjectProviderDraft,
  sortProviderConfigEntries
} from "./settings-view-models.js";

export const buildProviderConfigId = (providerId: ProviderId): ProviderConfigId => (
  `${providerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
);

export const getProviderInitialSelection = (
  providers: OnboardingProviderCredentialStatus[],
  settings: SystemSettings,
): ProviderId[] => {
  const detected = providers
    .filter((provider) => provider.available || provider.mountEnabled)
    .map((provider) => provider.provider);
  const enabled = Object.values(settings.defaults.aiProvider.providers)
    .filter((provider) => provider.enabled)
    .map((provider) => provider.provider);
  return Array.from(new Set<ProviderId>(["jules", ...enabled, ...detected]));
};

export const getSystemProvidersByType = (
  settings: SystemSettings | null,
  providerId: ProviderId,
): Array<[ProviderConfigId, SystemSettings["integrations"]["providers"][ProviderConfigId]]> => (
  sortProviderConfigEntries(Object.entries(settings?.integrations.providers || {})
    .filter(([, provider]) => provider.provider === providerId) as Array<[ProviderConfigId, SystemSettings["integrations"]["providers"][ProviderConfigId]]>)
);

export const getFirstCliProviderConfigId = (providers: ProjectSettings["aiProvider"]["providers"]): ProviderConfigId | null => (
  Object.entries(providers).find(([, provider]) => provider.provider !== "jules")?.[0] || null
);

export const syncProjectProvidersToIntegrationCatalog = (
  settings: SystemSettings,
  nextIntegrationProviders: SystemSettings["integrations"]["providers"],
): ProjectSettings => {
  const nextProjectProviders = Object.fromEntries(
    Object.entries(nextIntegrationProviders).map(([providerConfigId, provider]) => [
      providerConfigId,
      settings.defaults.aiProvider.providers[providerConfigId]
        ? {
          ...settings.defaults.aiProvider.providers[providerConfigId],
          provider: provider.provider,
          name: provider.name,
        }
        : createProjectProviderDraft(provider.provider, provider.name),
    ]),
  ) as ProjectSettings["aiProvider"]["providers"];

  const nextInvocationRouting = Object.fromEntries(
    Object.entries(settings.defaults.aiProvider.invocationRouting).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        provider: route.provider && nextProjectProviders[route.provider] ? route.provider : null,
        allowedProviders: route.allowedProviders.filter((providerConfigId) => nextProjectProviders[providerConfigId]),
        providers: Object.fromEntries(
          Object.entries(route.providers).filter(([providerConfigId]) => nextProjectProviders[providerConfigId]),
        ),
      },
    ]),
  ) as ProjectSettings["aiProvider"]["invocationRouting"];

  const fallbackGlobalProvider = settings.defaults.aiProvider.provider && nextProjectProviders[settings.defaults.aiProvider.provider]
    ? settings.defaults.aiProvider.provider
    : Object.keys(nextProjectProviders)[0] || null;
  const fallbackWorkerProvider = nextProjectProviders[settings.defaults.workers.virtualWorkerProvider]
    ? settings.defaults.workers.virtualWorkerProvider
    : getFirstCliProviderConfigId(nextProjectProviders) || fallbackGlobalProvider || settings.defaults.workers.virtualWorkerProvider;

  return {
    ...settings.defaults,
    aiProvider: {
      ...settings.defaults.aiProvider,
      provider: fallbackGlobalProvider,
      providers: nextProjectProviders,
      invocationRouting: nextInvocationRouting,
    },
    workers: {
      ...settings.defaults.workers,
      virtualWorkerProvider: fallbackWorkerProvider,
    },
  };
};
