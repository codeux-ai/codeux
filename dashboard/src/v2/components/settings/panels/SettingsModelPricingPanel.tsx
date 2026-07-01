import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { Banknote, Search } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { useModelCatalog, modelsDevLogoUrl } from "../../ui/ModelCombobox.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import { ModelPriceOverrideModal } from "../ModelPriceOverrideModal.js";
import type { ModelCatalogEntry } from "../../../../../../src/domain/model-catalog/model-catalog-types.js";
import type { TokenPricing } from "../../../../../../src/contracts/app-types.js";

const MAX_VISIBLE_RESULTS = 100;

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

  const relevantIds = useMemo(() => {
    if (!systemSettings) return new Set<string>();
    const ids = new Set<string>(Object.keys(overrides));
    for (const provider of Object.values(systemSettings.integrations.providers)) {
      if (provider.customModel) ids.add(provider.customModel);
      if (provider.qwenModelId) ids.add(provider.qwenModelId);
      if (provider.openCodeModelId) ids.add(provider.openCodeModelId);
    }
    for (const provider of Object.values(systemSettings.defaults.aiProvider.providers)) {
      if (provider.model) ids.add(provider.model);
    }
    return ids;
  }, [systemSettings, overrides]);

  const visibleEntries = useMemo<ModelCatalogEntry[]>(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return catalog.filter((entry) => relevantIds.has(entry.id));
    }
    return catalog
      .filter((entry) => `${entry.providerName} ${entry.modelName} ${entry.id}`.toLowerCase().includes(query))
      .slice(0, MAX_VISIBLE_RESULTS);
  }, [catalog, search, relevantIds]);

  if (!systemSettings) {
    return null;
  }

  const editingEntry = editingId ? catalog.find((entry) => entry.id === editingId) : undefined;

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
            : "Showing models referenced by your configured providers and any existing overrides. Search to browse the full catalogue."}
        </p>

        <div className="flex flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {visibleEntries.length === 0 ? (
            <div className="py-6 text-center text-xs font-medium text-slate-400">
              {search.trim() ? "No matching models." : "No models in use yet. Search to browse the catalogue."}
            </div>
          ) : visibleEntries.map((entry) => {
            const override = overrides[entry.id];
            return (
              <div key={entry.id} className="flex items-center gap-3 py-3">
                <ProviderBrandIcon
                  id={entry.providerId}
                  src={modelsDevLogoUrl(entry.providerId)}
                  fallbackLabel={entry.providerName}
                  className="h-8 w-8 rounded-[0.6rem]"
                  imageClassName="h-4 w-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {entry.providerName} — {entry.modelName}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatPrice(override ?? entry.cost)}
                    {override ? <span className="ml-1.5 font-semibold text-signal-600 dark:text-signal-400">(override)</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(entry.id)}
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

      {editingEntry ? (
        <ModelPriceOverrideModal
          isOpen
          onClose={() => setEditingId(null)}
          modelLabel={`${editingEntry.providerName} — ${editingEntry.modelName}`}
          basePrice={editingEntry.cost}
          override={overrides[editingEntry.id]}
          onSave={(pricing) => updateSystem((current) => {
            const nextOverrides = { ...current.modelPricing.overrides };
            if (pricing) {
              nextOverrides[editingEntry.id] = pricing;
            } else {
              delete nextOverrides[editingEntry.id];
            }
            return { ...current, modelPricing: { overrides: nextOverrides } };
          })}
        />
      ) : null}
    </div>
  );
};
