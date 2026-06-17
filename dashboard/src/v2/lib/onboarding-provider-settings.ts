import type {
  OnboardingProviderCredentialStatus,
  OnboardingRuntimeReadiness,
  ProviderConfigId,
  ProviderId,
  ProjectSettings,
  SystemSettings
} from "../../types.js";
import {
  createProjectProviderDraft,
  sortProviderConfigEntries,
} from "./settings-view-models.js";

export const providerMountFields: Partial<Record<ProviderId, keyof SystemSettings["defaults"]["cliWorkflow"]>> = {
  gemini: "containerMountGeminiAuth",
  codex: "containerMountCodexAuth",
  "claude-code": "containerMountClaudeCodeAuth",
  "qwen-code": "containerMountQwenCodeAuth",
  opencode: "containerMountOpenCodeAuth",
  antigravity: "containerMountAntigravityAuth",
};

export const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

export const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "antigravity", "codex", "claude-code", "qwen-code", "opencode"];

export const providerDescriptions: Record<ProviderId, string> = {
  jules: "Google Jules API service for agent session and workspace orchestration.",
  gemini: "Gemini CLI with local OAuth auth-copy or API-key based execution.",
  codex: "Codex CLI for OpenAI-powered local container execution.",
  "claude-code": "Claude Code CLI with local auth-copy or provider API key.",
  "qwen-code": "Qwen Code CLI with OAuth, Alibaba Coding Plan, or custom model provider config.",
  opencode: "OpenCode CLI with local auth, provider keys, or OpenAI-compatible endpoints.",
  antigravity: "Antigravity CLI (agy) for Google-powered local container execution.",
};

export const getProviderWatermark = (providerId: ProviderId): string => (
  providerId === "jules" ? "JLS"
    : providerId === "gemini" ? "GMN"
      : providerId === "codex" ? "CDX"
        : providerId === "qwen-code" ? "QWN"
          : providerId === "opencode" ? "OPC"
            : providerId === "antigravity" ? "AGY"
              : "CLD"
);

export const buildProviderConfigId = (providerId: ProviderId): ProviderConfigId => (
  `${providerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
);

export const defaultReadiness: OnboardingRuntimeReadiness = {
  checkedAt: "",
  cluster: {
    status: "not_ready",
    label: "Checking",
    detail: "Runtime checks are loading.",
  },
  dependencies: [],
  providers: [],
};

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

export const cloneSettings = (settings: SystemSettings): SystemSettings => JSON.parse(JSON.stringify(settings)) as SystemSettings;

export const getSystemProvidersByType = (
  settings: SystemSettings | null,
  providerId: ProviderId,
): Array<[ProviderConfigId, SystemSettings["integrations"]["providers"][ProviderConfigId]]> => (
  sortProviderConfigEntries(Object.entries(settings?.integrations.providers || {})
    .filter(([, provider]: [string, any]) => provider.provider === providerId) as Array<[ProviderConfigId, SystemSettings["integrations"]["providers"][ProviderConfigId]]>)
);

export const getFirstCliProviderConfigId = (providers: ProjectSettings["aiProvider"]["providers"]): ProviderConfigId | null => (
  Object.entries(providers).find(([, provider]: [string, any]) => provider.provider !== "jules")?.[0] || null
);

export const syncProjectProvidersToIntegrationCatalog = (
  settings: SystemSettings,
  nextIntegrationProviders: SystemSettings["integrations"]["providers"],
): ProjectSettings => {
  const nextProjectProviders = Object.fromEntries(
    Object.entries(nextIntegrationProviders).map(([providerConfigId, provider]: [string, any]) => [
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
    Object.entries(settings.defaults.aiProvider.invocationRouting).map(([routeId, route]: [string, any]) => [
      routeId,
      {
        ...route,
        provider: route.provider && nextProjectProviders[route.provider] ? route.provider : null,
        allowedProviders: route.allowedProviders.filter((providerConfigId: string) => nextProjectProviders[providerConfigId]),
        providers: Object.fromEntries(
          Object.entries(route.providers).filter(([providerConfigId]: [string, any]) => nextProjectProviders[providerConfigId]),
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
