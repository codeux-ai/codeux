import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { Banknote, Search } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { useModelCatalog, modelsDevLogoUrl } from "../../ui/ModelCombobox.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import { ModelPriceOverrideModal } from "../ModelPriceOverrideModal.js";
import type { ModelCatalogEntry } from "../../../../../../src/domain/model-catalog/model-catalog-types.js";
import type { ProviderId, TokenPricing } from "../../../../../../src/contracts/app-types.js";
import type { SystemProviderCredentialSettings } from "../../../../../../src/contracts/settings-scope-types.js";

const MAX_VISIBLE_RESULTS = 100;

/** Mirrors src/domain/model-catalog/model-catalog-matcher.ts's built-in provider mapping, for the same "which catalogue provider does this CLI provider mean" question, client-side. */
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

/** A model referenced by a configured provider instance, whether or not it exists in the models.dev catalogue. */
interface RelevantModelRef {
  /** Same "<provider>/<model>" scheme used as the price-override key, whether or not it's a real catalogue id. */
  id: string;
  providerId: string;
  providerName: string;
  modelName: string;
  catalogEntry: ModelCatalogEntry | undefined;
  usedBy: ModelUsageTag[];
}

interface ModelUsageTag {
  id: string;
  label: string;
  provider: ProviderId | string;
}

const formatPrice = (pricing: TokenPricing | undefined): string => (
  pricing
    ? `$${pricing.inputTokens}/M in • $${pricing.outputTokens}/M out${pricing.cachedInputTokens > 0 ? ` • $${pricing.cachedInputTokens}/M cached` : ""}`
    : "No published pricing"
);

const splitCanonicalModelId = (model: string): { providerId: string; modelId: string } | null => {
  const [providerId, ...modelParts] = model.split("/");
  const modelId = modelParts.join("/");
  return providerId && modelId ? { providerId, modelId } : null;
};

const resolveBuiltInProviderModelRef = (provider: ProviderId, model: string): { providerId?: string; modelId: string } => {
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

const normalizeOverrideId = (id: string): string => {
  const [providerId, ...modelParts] = id.split("/");
  if (providerId === "custom" && modelParts.length >= 2) {
    return modelParts.join("/");
  }
  return id;
};

export const SettingsModelPricingPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { systemSettings, updateSystem } = state;
  const catalog = useModelCatalog();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const overrides = systemSettings?.modelPricing?.overrides ?? {};
  const normalizedOverrides = useMemo(() => {
    const normalized: Record<string, TokenPricing> = {};
    for (const [id, pricing] of Object.entries(overrides)) {
      const normalizedId = normalizeOverrideId(id);
      if (id === normalizedId || !normalized[normalizedId]) {
        normalized[normalizedId] = pricing;
      }
    }
    return normalized;
  }, [overrides]);
  const overrideAliases = useMemo(() => {
    const aliases = new Map<string, string[]>();
    for (const id of Object.keys(overrides)) {
      const normalizedId = normalizeOverrideId(id);
      aliases.set(normalizedId, [...(aliases.get(normalizedId) ?? []), id]);
    }
    return aliases;
  }, [overrides]);

  const relevantRefs = useMemo(() => {
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

    // Instance-level custom routing. If no API provider field is selected and the
    // model is already a canonical "provider/model" id, preserve that provider
    // namespace instead of inventing "custom/provider/model".
    for (const [configId, instance] of Object.entries(systemSettings.integrations.providers)) {
      if (instance.customModel) addConfigRef(configId, instance, instance.customModel, instance.customProviderId);
      if (instance.qwenModelId) addConfigRef(configId, instance, instance.qwenModelId, instance.qwenApiProviderId);
      if (instance.openCodeModelId) addConfigRef(configId, instance, instance.openCodeModelId, instance.openCodeProviderId);
    }

    // Built-in AI_MODEL_CATALOG dropdown selections: best-effort map to a catalogue provider,
    // unless the selected model is already a canonical "provider/model" id.
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
        // OpenCode's built-in model field is already "<provider>/<model>".
        const [providerId, ...modelParts] = provider.model.split("/");
        if (providerId && modelParts.length > 0) addRef(providerId, modelParts.join("/"), usageTag);
        continue;
      }
      const resolved = resolveBuiltInProviderModelRef(provider.provider, provider.model);
      addRef(resolved.providerId, resolved.modelId, usageTag);
    }

    // Existing overrides always stay visible, even if the referencing provider was since removed.
    for (const id of Object.keys(normalizedOverrides)) {
      if (refs.has(id)) continue;
      const [providerId, ...modelParts] = id.split("/");
      addRef(providerId, modelParts.join("/"), { id: `override:${id}`, label: "Override", provider: "custom" });
    }

    return refs;
  }, [systemSettings, normalizedOverrides, catalog]);

  const visibleEntries = useMemo<RelevantModelRef[]>(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return [...relevantRefs.values()];
    }
    return catalog
      .filter((entry) => `${entry.providerName} ${entry.modelName} ${entry.id}`.toLowerCase().includes(query))
      .slice(0, MAX_VISIBLE_RESULTS)
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
  }, [catalog, search, relevantRefs]);

  if (!systemSettings) {
    return null;
  }

  const editingRef = editingId ? (visibleEntries.find((entry) => entry.id === editingId) ?? relevantRefs.get(editingId)) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Model Pricing" watermark="USD" icon={<Banknote strokeWidth={2.4} />}>
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search the catalogue by provider or model name…"
            className="w-full bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none dark:text-slate-200"
          />
        </div>

        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {search.trim()
            ? `Showing up to ${MAX_VISIBLE_RESULTS} matches from the catalogue.`
            : "Showing models referenced by your configured providers and any existing overrides — including self-hosted/custom models with no catalogue price. Search to browse the full catalogue."}
        </p>

        <div className="flex flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {visibleEntries.length === 0 ? (
            <div className="py-6 text-center text-xs font-medium text-slate-400">
              {search.trim() ? "No matching models." : "No models in use yet. Search to browse the catalogue."}
            </div>
          ) : visibleEntries.map((ref) => {
            const override = normalizedOverrides[ref.id];
            return (
              <div key={ref.id} className="flex items-center gap-3 py-3">
                <ProviderBrandIcon
                  id={ref.providerId}
                  src={modelsDevLogoUrl(ref.providerId)}
                  fallbackLabel={ref.providerName}
                  className="h-8 w-8 rounded-[0.6rem]"
                  imageClassName="h-4 w-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {ref.providerName} — {ref.modelName}
                    {!ref.catalogEntry ? (
                      <span className="ml-1.5 rounded-full border border-black/[0.06] bg-black/[0.02] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02]">
                        custom
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatPrice(override ?? ref.catalogEntry?.cost)}
                    {override ? <span className="ml-1.5 font-semibold text-signal-600 dark:text-signal-400">(override)</span> : null}
                  </div>
                  {ref.usedBy.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {ref.usedBy.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-black/[0.06] bg-black/[0.025] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"
                          title={tag.label}
                        >
                          <ProviderBrandIcon
                            id={tag.provider}
                            fallbackLabel={tag.label}
                            className="h-3.5 w-3.5 rounded-[0.25rem] border-0 bg-transparent shadow-none"
                            imageClassName="h-2.5 w-2.5"
                          />
                          <span className="truncate">{tag.label}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(ref.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600 hover:bg-black/[0.04] dark:border-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                >
                  <Banknote className="h-3.5 w-3.5" />
                  {override ? "Edit override" : "Set override"}
                </button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {editingRef ? (
        <ModelPriceOverrideModal
          isOpen
          onClose={() => setEditingId(null)}
          modelLabel={`${editingRef.providerName} — ${editingRef.modelName}`}
          basePrice={editingRef.catalogEntry?.cost}
          override={normalizedOverrides[editingRef.id]}
          onSave={(pricing) => updateSystem((current) => {
            const nextOverrides = { ...current.modelPricing.overrides };
            for (const alias of overrideAliases.get(editingRef.id) ?? []) {
              delete nextOverrides[alias];
            }
            if (pricing) {
              nextOverrides[editingRef.id] = pricing;
            } else {
              delete nextOverrides[editingRef.id];
            }
            return { ...current, modelPricing: { overrides: nextOverrides } };
          })}
        />
      ) : null}
    </div>
  );
};
