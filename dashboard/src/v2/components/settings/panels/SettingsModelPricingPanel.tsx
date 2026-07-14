import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { Banknote, Search } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { useModelCatalog, modelsDevLogoUrl } from "../../ui/ModelCombobox.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import { ModelPriceOverrideModal } from "../ModelPriceOverrideModal.js";
import {
  formatModelPrice,
  getModelPricingOverrideAliases,
  getRelevantModelPricingRefs,
  getVisibleModelPricingRefs,
  MAX_VISIBLE_MODEL_PRICING_RESULTS,
  normalizeModelPricingOverrides,
} from "../../../lib/settings-view-models.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsModelsMessages } from "../../../i18n/messages/settings-models.js";

export const SettingsModelPricingPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { locale, formatNumber, translate: t, translatePlural: tp } = useDashboardI18n();
  const { systemSettings, updateSystem } = state;
  const catalog = useModelCatalog();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const overrides = systemSettings?.modelPricing?.overrides ?? {};
  const normalizedOverrides = useMemo(() => normalizeModelPricingOverrides(overrides), [overrides]);
  const overrideAliases = useMemo(() => getModelPricingOverrideAliases(overrides), [overrides]);
  const relevantRefs = useMemo(
    () => getRelevantModelPricingRefs(systemSettings, catalog, normalizedOverrides, locale),
    [systemSettings, normalizedOverrides, catalog, locale],
  );
  const visibleEntries = useMemo(
    () => getVisibleModelPricingRefs(catalog, search, relevantRefs),
    [catalog, search, relevantRefs],
  );

  if (!systemSettings) {
    return null;
  }

  const editingRef = editingId ? (visibleEntries.find((entry) => entry.id === editingId) ?? relevantRefs.get(editingId)) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        title={t(settingsModelsMessages, "modelPricing")}
        helpId="model-pricing"
        summary={t(settingsModelsMessages, "modelPricingSummary")}
        configureLabel={t(settingsModelsMessages, "configure")}
        watermark="USD"
        icon={<Banknote strokeWidth={2.4} />}
        accent="purple"
        highlights={[
          { label: t(settingsModelsMessages, "modelsInUse"), value: formatNumber(relevantRefs.size), tone: "active" },
          { label: t(settingsModelsMessages, "overrides"), value: formatNumber(Object.keys(normalizedOverrides).length) },
          { label: t(settingsModelsMessages, "catalog"), value: tp(settingsModelsMessages, "models", catalog.length, { count: formatNumber(catalog.length) }) },
        ]}
      >
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder={t(settingsModelsMessages, "searchPricingPlaceholder")}
            className="w-full bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none dark:text-slate-200"
          />
        </div>

        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {search.trim()
            ? t(settingsModelsMessages, "showingCatalogMatches", { count: formatNumber(MAX_VISIBLE_MODEL_PRICING_RESULTS) })
            : t(settingsModelsMessages, "showingConfiguredModels")}
        </p>

        <div className="flex flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {visibleEntries.length === 0 ? (
            <div className="py-6 text-center text-xs font-medium text-slate-400">
              {search.trim() ? t(settingsModelsMessages, "noMatchingModels") : t(settingsModelsMessages, "noModelsInUse")}
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
                        {t(settingsModelsMessages, "custom")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatModelPrice(override ?? ref.catalogEntry?.cost, locale)}
                    {override ? <span className="ml-1.5 font-semibold text-signal-600 dark:text-signal-400">{t(settingsModelsMessages, "overrideSuffix")}</span> : null}
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
                  {override ? t(settingsModelsMessages, "editOverride") : t(settingsModelsMessages, "setOverride")}
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
