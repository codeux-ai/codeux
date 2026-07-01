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

const MAX_VISIBLE_RESULTS = 100;

/** Mirrors src/domain/model-catalog/model-catalog-matcher.ts's built-in provider mapping, for the same "which catalogue provider does this CLI provider mean" question, client-side. */
const BUILTIN_PROVIDER_TO_CATALOG_PROVIDER: Partial<Record<ProviderId, string>> = {
  gemini: "google",
  codex: "openai",
  "claude-code": "anthropic",
  "qwen-code": "alibaba",
};

/** A model referenced by a configured provider instance, whether or not it exists in the models.dev catalogue. */
interface RelevantModelRef {
  /** Same "<provider>/<model>" scheme used as the price-override key, whether or not it's a real catalogue id. */
  id: string;
  providerId: string;
  providerName: string;
  modelName: string;
  catalogEntry: ModelCatalogEntry | undefined;
}

const formatPrice = (pricing: TokenPricing | undefined): string => (
  pricing
    ? `$${pricing.inputTokens}/M in • $${pricing.outputTokens}/M out${pricing.cachedInputTokens > 0 ? ` • $${pricing.cachedInputTokens}/M cached` : ""}`
    : "No published pricing"
);

export const SettingsModelPricingPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { systemSettings, updateSystem } = state;
  const catalog = useModelCatalog();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const overrides = systemSettings?.modelPricing?.overrides ?? {};

  const relevantRefs = useMemo(() => {
    const refs = new Map<string, RelevantModelRef>();
    if (!systemSettings) return refs;

    const catalogById = new Map(catalog.map((entry) => [entry.id, entry] as const));

    const addRef = (providerId: string | undefined, modelId: string | undefined) => {
      const model = modelId?.trim();
      if (!model) return;
      const provider = providerId?.trim() || "custom";
      const id = `${provider}/${model}`;
      if (refs.has(id)) return;
      const catalogEntry = catalogById.get(id);
      refs.set(id, {
        id,
        providerId: provider,
        providerName: catalogEntry?.providerName ?? provider,
        modelName: catalogEntry?.modelName ?? model,
        catalogEntry,
      });
    };

    // Custom gateway routing: Claude Code/Codex customModel, Qwen modelProvider, OpenCode
    // custom provider — each paired with its own "API provider" field.
    for (const instance of Object.values(systemSettings.integrations.providers)) {
      if (instance.customModel) addRef(instance.customProviderId, instance.customModel);
      if (instance.qwenModelId) addRef(instance.qwenApiProviderId, instance.qwenModelId);
      if (instance.openCodeModelId) addRef(instance.openCodeProviderId, instance.openCodeModelId);
    }

    // Built-in AI_MODEL_CATALOG dropdown selections: best-effort map to a catalogue provider.
    for (const provider of Object.values(systemSettings.defaults.aiProvider.providers)) {
      if (!provider.model) continue;
      if (provider.provider === "opencode") {
        // OpenCode's built-in model field is already "<provider>/<model>".
        const [providerId, ...modelParts] = provider.model.split("/");
        if (providerId && modelParts.length > 0) addRef(providerId, modelParts.join("/"));
        continue;
      }
      addRef(BUILTIN_PROVIDER_TO_CATALOG_PROVIDER[provider.provider], provider.model);
    }

    // Existing overrides always stay visible, even if the referencing provider was since removed.
    for (const id of Object.keys(overrides)) {
      if (refs.has(id)) continue;
      const [providerId, ...modelParts] = id.split("/");
      addRef(providerId, modelParts.join("/"));
    }

    return refs;
  }, [systemSettings, overrides, catalog]);

  const visibleEntries = useMemo<RelevantModelRef[]>(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return [...relevantRefs.values()];
    }
    return catalog
      .filter((entry) => `${entry.providerName} ${entry.modelName} ${entry.id}`.toLowerCase().includes(query))
      .slice(0, MAX_VISIBLE_RESULTS)
      .map((entry) => ({
        id: entry.id,
        providerId: entry.providerId,
        providerName: entry.providerName,
        modelName: entry.modelName,
        catalogEntry: entry,
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
            const override = overrides[ref.id];
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
          override={overrides[editingRef.id]}
          onSave={(pricing) => updateSystem((current) => {
            const nextOverrides = { ...current.modelPricing.overrides };
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
