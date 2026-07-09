import type {
  ProviderConfigId,
  ProviderId,
  SystemProviderCredentialSettings,
  SystemSettings,
  ThinkingMode,
  VirtualWorkerProvider,
} from "../../../types.js";
import {
  DEFAULT_PROVIDER_CONFIG_NAMES,
  DEFAULT_PROVIDER_SETTINGS,
  getProviderThinkingModeOptions as getProviderThinkingModeOptionsFromDefaults,
  normalizeProviderThinkingMode,
  PUBLIC_VIRTUAL_WORKER_PROVIDERS,
  VIRTUAL_WORKER_PROVIDERS,
} from "../../../../../src/repositories/settings-defaults.js";
import { AI_MODEL_CATALOG, getConfiguredProviderModel } from "./model-options.js";
import {
  getSystemIntegrationProviders,
  inferProviderTypeFromConfigId,
} from "./provider-instances.js";

export const thinkingModeOptions: Array<{ value: ThinkingMode; label: string }> = [
  ...new Map(
    ([
      "gemini",
      "codex",
      "claude-code",
      "qwen-code",
      "opencode",
      "antigravity",
    ] as ProviderId[])
      .flatMap((providerId) => getProviderThinkingModeOptionsFromDefaults(providerId))
      .map((option) => [option.value, option] as const),
  ).values(),
];

export const getProviderThinkingModeOptions = (providerId: ProviderId): Array<{ value: ThinkingMode; label: string }> => (
  [...getProviderThinkingModeOptionsFromDefaults(providerId)]
);

export const getProviderThinkingModeValue = (providerId: ProviderId, value: ThinkingMode): ThinkingMode => (
  normalizeProviderThinkingMode(providerId, value)
);

export const getProviderThinkingModeLabel = (providerId: ProviderId, value: ThinkingMode): string => {
  const normalized = normalizeProviderThinkingMode(providerId, value);
  return getProviderThinkingModeOptions(providerId).find((option) => option.value === normalized)?.label || normalized;
};

export interface ProviderDisplayMetadata {
  providerConfigId: ProviderConfigId;
  provider: ProviderId;
  displayLabel: string;
  iconProviderId: ProviderId;
  effectiveModel: string;
}

export interface VirtualProviderDisplayMetadata extends ProviderDisplayMetadata {
  provider: VirtualWorkerProvider;
  iconProviderId: VirtualWorkerProvider;
}

const isVirtualWorkerProvider = (providerId: ProviderId): providerId is VirtualWorkerProvider => (
  VIRTUAL_WORKER_PROVIDERS.includes(providerId as VirtualWorkerProvider)
);

const isProviderInstanceAvailableForDisplay = (provider: SystemProviderCredentialSettings): boolean => (
  provider.apiKey.trim().length > 0 || (provider.provider !== "jules" && provider.mountAuth)
);

export const resolveProviderDisplayModel = (
  provider: ProviderId,
  baseModel: string | null | undefined,
  workerModel?: string | null,
  systemProvider?: SystemProviderCredentialSettings | null,
): string => {
  const fallbackModel = baseModel?.trim() || DEFAULT_PROVIDER_SETTINGS[provider].model;
  const configuredModel = getConfiguredProviderModel(provider, systemProvider, fallbackModel);
  if (configuredModel) {
    return configuredModel;
  }
  if (provider === "jules") {
    return fallbackModel;
  }
  const normalizedWorkerModel = typeof workerModel === "string" ? workerModel.trim() : "";
  if (!normalizedWorkerModel || normalizedWorkerModel === "default") {
    return fallbackModel;
  }
  return (AI_MODEL_CATALOG[provider] || []).includes(normalizedWorkerModel)
    ? normalizedWorkerModel
    : fallbackModel;
};

export const getProviderDisplayMetadata = (
  systemSettings: SystemSettings | null,
  providerConfigId: ProviderConfigId,
  workerModel?: string | null,
): ProviderDisplayMetadata | null => {
  const projectProvider = systemSettings?.defaults?.aiProvider?.providers?.[providerConfigId];
  const systemProvider = systemSettings ? getSystemIntegrationProviders(systemSettings)[providerConfigId] : undefined;
  const provider = projectProvider?.provider || systemProvider?.provider || inferProviderTypeFromConfigId(providerConfigId);
  if (!provider) {
    return null;
  }
  const displayLabel = (projectProvider?.name || systemProvider?.name || DEFAULT_PROVIDER_CONFIG_NAMES[provider]).trim()
    || DEFAULT_PROVIDER_CONFIG_NAMES[provider];

  return {
    providerConfigId,
    provider,
    displayLabel,
    iconProviderId: provider,
    effectiveModel: resolveProviderDisplayModel(provider, projectProvider?.model, workerModel, systemProvider),
  };
};

export const getVirtualProviderDisplayMetadata = (
  systemSettings: SystemSettings | null,
): VirtualProviderDisplayMetadata[] => {
  if (!systemSettings) {
    return PUBLIC_VIRTUAL_WORKER_PROVIDERS.map((provider) => ({
      providerConfigId: provider,
      provider,
      displayLabel: DEFAULT_PROVIDER_CONFIG_NAMES[provider],
      iconProviderId: provider,
      effectiveModel: resolveProviderDisplayModel(provider, DEFAULT_PROVIDER_SETTINGS[provider].model),
    }));
  }

  return Object.entries(getSystemIntegrationProviders(systemSettings))
    .filter(([, provider]) => isVirtualWorkerProvider(provider.provider) && isProviderInstanceAvailableForDisplay(provider))
    .map(([providerConfigId]) => getProviderDisplayMetadata(systemSettings, providerConfigId))
    .filter((metadata): metadata is VirtualProviderDisplayMetadata => Boolean(metadata && isVirtualWorkerProvider(metadata.provider)));
};

export const getDefaultRouteOptionLabel = (
  defaultProvider: ProviderDisplayMetadata | null,
): string => defaultProvider ? `Default Route (${defaultProvider.displayLabel})` : "Default Route";

export const getDefaultModelOptionLabel = (
  defaultProvider: Pick<ProviderDisplayMetadata, "effectiveModel"> | null,
): string => {
  const model = defaultProvider?.effectiveModel?.trim();
  return model ? `Default Model (${model})` : "Default Model";
};

export const PROVIDER_CARD_TOKENS: Record<ProviderId, {
  watermark: string;
  logoLabel: string;
  badgeLabel: string;
  badgeClassName: string;
  glowClassName: string;
  railClassName: string;
  noteClassName: string;
}> = {
  jules: {
    watermark: "JLS",
    logoLabel: "J",
    badgeLabel: "Hosted API",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  gemini: {
    watermark: "GMN",
    logoLabel: "G",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  codex: {
    watermark: "CDX",
    logoLabel: "O",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.04] text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200",
  },
  "claude-code": {
    watermark: "CLD",
    logoLabel: "C",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  "qwen-code": {
    watermark: "QWN",
    logoLabel: "Q",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  opencode: {
    watermark: "OPC",
    logoLabel: "O",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  antigravity: {
    watermark: "AGY",
    logoLabel: "AGY",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  "mockup-cli": {
    watermark: "MCK",
    logoLabel: "M",
    badgeLabel: "Internal",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
};
