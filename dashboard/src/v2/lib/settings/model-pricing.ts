import type { ModelCatalogEntry } from "../../../../../src/domain/model-catalog/model-catalog-types.js";
import type { TokenPricing } from "../../../../../src/contracts/app-types.js";
import type {
  ProviderId,
  SystemProviderCredentialSettings,
  SystemSettings,
} from "../../../types.js";

export const MAX_VISIBLE_MODEL_PRICING_RESULTS = 100;

const BUILTIN_PROVIDER_TO_CATALOG_PROVIDER: Partial<Record<ProviderId, string>> = {
  gemini: "google",
  codex: "openai",
  "claude-code": "anthropic",
  "qwen-code": "alibaba",
};

const BUILTIN_MODEL_ALIASES: Partial<Record<ProviderId, Record<string, string>>> = {
  antigravity: {
    default: "google/gemini-3-flash-preview",
    "gemini-3.5-flash": "google/gemini-3.5-flash",
    "gemini-3.1-pro-high": "google/gemini-3.1-pro-preview",
    "gemini-3.1-pro-low": "google/gemini-3.1-pro-preview",
    "gemini-3-flash": "google/gemini-3-flash-preview",
    "claude-sonnet-4.6-thinking": "anthropic/claude-sonnet-4-6",
    "claude-opus-4.6-thinking": "anthropic/claude-opus-4-6",
    "gpt-oss-120b": "google-vertex/openai/gpt-oss-120b-maas",
  },
};

export interface RelevantModelRef {
  id: string;
  providerId: string;
  providerName: string;
  modelName: string;
  catalogEntry: ModelCatalogEntry | undefined;
  usedBy: ModelUsageTag[];
}

export interface ModelUsageTag {
  id: string;
  label: string;
  provider: ProviderId | string;
}

export const formatModelPrice = (pricing: TokenPricing | undefined): string => (
  pricing
    ? `$${pricing.inputTokens}/M in • $${pricing.outputTokens}/M out${pricing.cachedInputTokens > 0 ? ` • $${pricing.cachedInputTokens}/M cached` : ""}`
    : "No published pricing"
);

export const splitCanonicalModelId = (model: string): { providerId: string; modelId: string } | null => {
  const [providerId, ...modelParts] = model.split("/");
  const modelId = modelParts.join("/");
  return providerId && modelId ? { providerId, modelId } : null;
};

export const resolveBuiltInProviderModelRef = (provider: ProviderId, model: string): { providerId?: string; modelId: string } => {
  const alias = BUILTIN_MODEL_ALIASES[provider]?.[model];
  const canonicalAlias = alias ? splitCanonicalModelId(alias) : null;
  if (canonicalAlias) {
    return { providerId: canonicalAlias.providerId, modelId: canonicalAlias.modelId };
  }
  return {
    providerId: splitCanonicalModelId(model) ? undefined : BUILTIN_PROVIDER_TO_CATALOG_PROVIDER[provider],
    modelId: model,
  };
};

export const normalizeModelPricingOverrideId = (id: string): string => {
  const [providerId, ...modelParts] = id.split("/");
  if (providerId === "custom" && modelParts.length >= 2) {
    return modelParts.join("/");
  }
  return id;
};

export const normalizeModelPricingOverrides = (
  overrides: Record<string, TokenPricing>,
): Record<string, TokenPricing> => {
  const normalized: Record<string, TokenPricing> = {};
  for (const [id, pricing] of Object.entries(overrides)) {
    const normalizedId = normalizeModelPricingOverrideId(id);
    if (id === normalizedId || !normalized[normalizedId]) {
      normalized[normalizedId] = pricing;
    }
  }
  return normalized;
};

export const getModelPricingOverrideAliases = (
  overrides: Record<string, TokenPricing>,
): Map<string, string[]> => {
  const aliases = new Map<string, string[]>();
  for (const id of Object.keys(overrides)) {
    const normalizedId = normalizeModelPricingOverrideId(id);
    aliases.set(normalizedId, [...(aliases.get(normalizedId) ?? []), id]);
  }
  return aliases;
};

export const getRelevantModelPricingRefs = (
  systemSettings: SystemSettings | null,
  catalog: ModelCatalogEntry[],
  normalizedOverrides: Record<string, TokenPricing>,
): Map<string, RelevantModelRef> => {
  const refs = new Map<string, RelevantModelRef>();
  if (!systemSettings) return refs;

  const catalogById = new Map(catalog.map((entry) => [entry.id, entry] as const));
  const providerNameById = new Map(catalog.map((entry) => [entry.providerId, entry.providerName] as const));

  const addRef = (providerId: string | undefined, modelId: string | undefined, usedBy: ModelUsageTag) => {
    const model = modelId?.trim();
    if (!model) return;
    const canonical = providerId?.trim()
      ? { providerId: providerId.trim(), modelId: model }
      : (splitCanonicalModelId(model) ?? { providerId: "custom", modelId: model });
    const id = `${canonical.providerId}/${canonical.modelId}`;
    const catalogEntry = catalogById.get(id);
    const existing = refs.get(id);
    if (existing) {
      if (!existing.usedBy.some((tag) => tag.id === usedBy.id)) {
        existing.usedBy.push(usedBy);
      }
      return;
    }
    refs.set(id, {
      id,
      providerId: canonical.providerId,
      providerName: catalogEntry?.providerName ?? providerNameById.get(canonical.providerId) ?? canonical.providerId,
      modelName: catalogEntry?.modelName ?? canonical.modelId,
      catalogEntry,
      usedBy: [usedBy],
    });
  };

  const addConfigRef = (configId: string, provider: SystemProviderCredentialSettings, modelId: string | undefined, providerId?: string) => {
    const defaults = systemSettings.defaults.aiProvider.providers[configId];
    if (defaults?.enabled === false) return;
    addRef(providerId, modelId, {
      id: configId,
      label: provider.name || defaults?.name || provider.provider,
      provider: provider.provider,
    });
  };

  for (const [configId, instance] of Object.entries(systemSettings.integrations.providers)) {
    if (instance.customModel) addConfigRef(configId, instance, instance.customModel, instance.customProviderId);
    if (instance.qwenModelId) addConfigRef(configId, instance, instance.qwenModelId, instance.qwenApiProviderId);
    if (instance.openCodeModelId) addConfigRef(configId, instance, instance.openCodeModelId, instance.openCodeProviderId);
  }

  for (const [configId, provider] of Object.entries(systemSettings.defaults.aiProvider.providers)) {
    if (provider.enabled === false) continue;
    if (!provider.model) continue;
    const instance = systemSettings.integrations.providers[configId];
    const usageTag: ModelUsageTag = {
      id: configId,
      label: instance?.name || provider.name || provider.provider,
      provider: provider.provider,
    };
    if (provider.provider === "opencode") {
      const [providerId, ...modelParts] = provider.model.split("/");
      if (providerId && modelParts.length > 0) addRef(providerId, modelParts.join("/"), usageTag);
      continue;
    }
    const resolved = resolveBuiltInProviderModelRef(provider.provider, provider.model);
    addRef(resolved.providerId, resolved.modelId, usageTag);
  }

  for (const id of Object.keys(normalizedOverrides)) {
    if (refs.has(id)) continue;
    const [providerId, ...modelParts] = id.split("/");
    addRef(providerId, modelParts.join("/"), { id: `override:${id}`, label: "Override", provider: "custom" });
  }

  return refs;
};

export const getVisibleModelPricingRefs = (
  catalog: ModelCatalogEntry[],
  search: string,
  relevantRefs: Map<string, RelevantModelRef>,
): RelevantModelRef[] => {
  const query = search.trim().toLowerCase();
  if (!query) {
    return [...relevantRefs.values()];
  }
  return catalog
    .filter((entry) => `${entry.providerName} ${entry.modelName} ${entry.id}`.toLowerCase().includes(query))
    .slice(0, MAX_VISIBLE_MODEL_PRICING_RESULTS)
    .map((entry) => ({
      ...(relevantRefs.get(entry.id) ?? {
        id: entry.id,
        providerId: entry.providerId,
        providerName: entry.providerName,
        modelName: entry.modelName,
        catalogEntry: entry,
        usedBy: [],
      }),
    }));
};
