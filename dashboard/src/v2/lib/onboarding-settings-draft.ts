import type {
  DashboardExperienceMode,
  OnboardingProviderCredentialStatus,
  ProviderConfigId,
  ProviderId,
  ProjectSettings,
  SystemSettings
} from "../../types.js";
import {
  createProjectProviderDraft,
  createSystemProviderDraft,
  getProviderTypeLabel,
  sortProviderConfigEntries
} from "./settings-view-models.js";

const EASY_PROVIDER_PRIORITY: ProviderId[] = ["codex", "gemini", "claude-code", "qwen-code", "opencode", "antigravity"];

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

export const getEasyRecommendedProvider = (
  providers: OnboardingProviderCredentialStatus[],
  settings?: SystemSettings | null,
): ProviderId => {
  const availableProvider = EASY_PROVIDER_PRIORITY.find((providerId) => (
    providers.some((provider) => provider.provider === providerId && (provider.available || provider.mountEnabled))
  ));
  if (availableProvider) {
    return availableProvider;
  }

  const enabledProvider = EASY_PROVIDER_PRIORITY.find((providerId) => (
    Object.values(settings?.defaults.aiProvider.providers ?? {}).some((provider) => (
      provider.provider === providerId && provider.enabled
    ))
  ));
  return enabledProvider ?? "codex";
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

export const applyOnboardingExperienceModeDefaults = (
  settings: SystemSettings,
  mode: DashboardExperienceMode,
  options: {
    recommendedProvider?: ProviderId;
    useGithub?: boolean;
    manageGithubPrWorkflow?: boolean;
  } = {},
): SystemSettings => {
  const nextSettings = structuredClone(settings) as SystemSettings;
  nextSettings.defaults.appearance = {
    ...nextSettings.defaults.appearance,
    experienceMode: mode,
  };

  if (mode !== "EASY") {
    return nextSettings;
  }

  const recommendedProvider = options.recommendedProvider ?? "codex";
  const useGithub = options.useGithub ?? nextSettings.defaults.cliWorkflow.gitMode !== "local";
  const manageGithubPrWorkflow = options.manageGithubPrWorkflow ?? nextSettings.defaults.git.autoCreatePr;
  const providerConfigId = Object.entries(nextSettings.integrations.providers)
    .find(([, provider]) => provider.provider === recommendedProvider)?.[0] as ProviderConfigId | undefined
    ?? recommendedProvider;

  if (!nextSettings.integrations.providers[providerConfigId]) {
    nextSettings.integrations.providers[providerConfigId] = createSystemProviderDraft(
      recommendedProvider,
      getProviderTypeLabel(recommendedProvider),
    );
  }
  const recommendedIntegration = nextSettings.integrations.providers[providerConfigId];
  if (
    recommendedIntegration
    && recommendedIntegration.provider !== "jules"
    && (!recommendedIntegration.authType || (recommendedIntegration.authType === "apiKey" && !recommendedIntegration.apiKey.trim()))
  ) {
    nextSettings.integrations.providers[providerConfigId] = {
      ...recommendedIntegration,
      authType: "dashboardAuth",
      mountAuth: true,
      authPath: `~/.code-ux/credentials/${providerConfigId}`,
    };
  }

  nextSettings.defaults = syncProjectProvidersToIntegrationCatalog(nextSettings, nextSettings.integrations.providers);

  for (const [configId, projectProvider] of Object.entries(nextSettings.defaults.aiProvider.providers)) {
    nextSettings.defaults.aiProvider.providers[configId] = {
      ...projectProvider,
      enabled: configId === providerConfigId,
      maxConcurrentTasks: Math.min(projectProvider.maxConcurrentTasks || 1, 1),
    };
  }

  nextSettings.defaults.aiProvider = {
    ...nextSettings.defaults.aiProvider,
    provider: providerConfigId,
    strategy: "MANUAL",
    invocationRouting: Object.fromEntries(
      Object.entries(nextSettings.defaults.aiProvider.invocationRouting).map(([routeId, route]) => [
        routeId,
        {
          ...route,
          provider: providerConfigId,
          allowedProviders: [providerConfigId],
          providers: {
            [providerConfigId]: route.providers[providerConfigId] ?? { enabled: true, weight: 1 },
          },
        },
      ]),
    ) as ProjectSettings["aiProvider"]["invocationRouting"],
  };

  nextSettings.defaults.workers = {
    ...nextSettings.defaults.workers,
    executionMode: "VIRTUAL",
    virtualWorkerProvider: providerConfigId,
    maxConcurrency: Math.min(nextSettings.defaults.workers.maxConcurrency || 1, 3),
  };

  nextSettings.defaults.automationLevel = "SEMI_AUTO";
  nextSettings.defaults.automationInterventions = {
    ...nextSettings.defaults.automationInterventions,
    autoApprovePlan: true,
    autoAnswerClarification: false,
    autoResumePaused: false,
  };
  nextSettings.defaults.memory = {
    ...nextSettings.defaults.memory,
    enabled: true,
  };
  nextSettings.defaults.appearance = {
    ...nextSettings.defaults.appearance,
    experienceMode: "EASY",
    navigationMode: "SIDEBAR",
    theme: "SYSTEM",
    reducedMotion: "AUTO",
    backgroundMode: "ANIMATED",
    backgroundPattern: "NONE",
  };
  nextSettings.defaults.cliWorkflow = {
    ...nextSettings.defaults.cliWorkflow,
    executionMode: "DOCKER",
    gitMode: useGithub ? "remote" : "local",
    containerMountGithubAuth: useGithub && nextSettings.defaults.cliWorkflow.containerMountGithubAuth,
  };
  nextSettings.defaults.git = {
    ...nextSettings.defaults.git,
    githubMode: useGithub ? "REMOTE" : "LOCAL",
    autoCreatePr: useGithub && manageGithubPrWorkflow,
  };
  nextSettings.defaults.ciIntelligence = {
    ...nextSettings.defaults.ciIntelligence,
    enableLivePrMonitoring: useGithub && manageGithubPrWorkflow,
    resolveAllCommentsBeforeMainMerge: useGithub && manageGithubPrWorkflow,
    resolveMainMergeConflicts: useGithub && manageGithubPrWorkflow,
    resolveMainMergeFailedChecks: useGithub && manageGithubPrWorkflow,
    resolveAllCommentsBeforeFeatureMerge: useGithub && manageGithubPrWorkflow,
    resolveMergeConflicts: useGithub && manageGithubPrWorkflow,
    featurePrAutoMergeMode: useGithub && manageGithubPrWorkflow ? "CREATE_PR" : "OFF",
    mainBranchAutoMergeMode: useGithub && manageGithubPrWorkflow ? "CREATE_PR" : "OFF",
  };

  return nextSettings;
};
