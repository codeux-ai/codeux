import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { AvantgardeSelect, type SelectOption } from "./AvantgardeSelect.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import type { ModelCatalogEntry } from "../../../../../src/domain/model-catalog/model-catalog-types.js";

let catalogPromise: Promise<ModelCatalogEntry[]> | null = null;

function loadModelCatalog(): Promise<ModelCatalogEntry[]> {
  if (!catalogPromise) {
    catalogPromise = fetch("/api/model-catalog")
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => []);
  }
  return catalogPromise;
}

/** Test-only hook to force a re-fetch on the next render. */
export function resetModelCatalogCache(): void {
  catalogPromise = null;
}

export function useModelCatalog(): ModelCatalogEntry[] {
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadModelCatalog().then((entries) => {
      if (!cancelled) setCatalog(entries);
    });
    return () => { cancelled = true; };
  }, []);
  return catalog;
}

export const modelsDevLogoUrl = (providerId: string): string => `https://models.dev/logos/${providerId}.svg`;

/**
 * models.dev catalogues ~147 "providers", but most are gateways/resellers/regional mirrors
 * (OpenRouter, Vercel AI Gateway, Databricks, GitLab Duo, dozens of proxy/aggregator brands)
 * that re-list the same underlying models from a handful of real model creators under their
 * own id/name conventions — e.g. the same GPT-5 shows up as "gpt-5", "databricks-gpt-5",
 * "duo-chat-gpt-5-1", etc. Deduping by bare model id doesn't collapse those, since each
 * gateway invents its own id. So without a specific provider selected, the browsable default
 * list is restricted to the primary model-creator providers below — a real "one row per
 * model" list — rather than every gateway's copy of it. Selecting a specific provider (e.g.
 * OpenRouter itself) still shows that provider's full model list, allowlist or not.
 */
const PRIMARY_MODEL_PROVIDER_IDS = new Set([
  "anthropic", "openai", "google", "alibaba", "mistral", "deepseek", "xai",
  "cohere", "perplexity", "moonshotai", "zhipuai", "minimax", "zai", "llama",
]);

/**
 * Searchable, icon-enhanced model picker sourced from the models.dev catalogue
 * (https://models.dev), prefetched into assets/models-dev/catalog.json and served via
 * GET /api/model-catalog. Falls back to a free-typed value for models outside the
 * catalogue (private/self-hosted gateway models).
 *
 * The value is always the bare model identifier (e.g. "claude-sonnet-4-5"), never a
 * "<provider>/<model>" composite — the provider is a separate, paired field (see
 * ProviderCombobox). Without one selected, the list is limited to primary model-creator
 * providers (see PRIMARY_MODEL_PROVIDER_IDS) and deduped to one row per bare model id, so it
 * reads as a clean model list rather than every gateway's copy of the same models — all of
 * it is shown (no render cap), since the allowlist already keeps it to a few hundred rows at
 * most and any hard cap would just show whichever provider happens to sort first. Once a
 * specific provider is selected, options are scoped to just that provider's models (any
 * provider, allowlisted or not) — that guarantees the identifier is correct for whichever
 * endpoint the paired provider field points at, and is where the render cap actually matters,
 * since a single gateway (OpenRouter, Vercel AI Gateway, etc.) can list hundreds of models.
 */
export const ModelCombobox: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  /** Scopes the browsable model list to a single models.dev provider id, paired with an API provider field. */
  providerId?: string;
}> = ({ value, onChange, disabled = false, placeholder = "Search models…", "aria-label": ariaLabel, providerId }) => {
  const catalog = useModelCatalog();

  const options = useMemo<SelectOption[]>(() => {
    const scoped = providerId
      ? catalog.filter((entry) => entry.providerId === providerId)
      : catalog.filter((entry) => PRIMARY_MODEL_PROVIDER_IDS.has(entry.providerId));
    // Dedupe to one row per bare model id — a small residual overlap even within the
    // primary-provider list (e.g. regional variants) shouldn't show as separate rows.
    const seenModelIds = new Set<string>();
    const catalogOptions: SelectOption[] = [];
    for (const entry of scoped) {
      if (seenModelIds.has(entry.modelId)) {
        continue;
      }
      seenModelIds.add(entry.modelId);
      catalogOptions.push({
        value: entry.modelId,
        label: entry.modelName,
        icon: providerId ? (
          <ProviderBrandIcon
            id={entry.providerId}
            src={modelsDevLogoUrl(entry.providerId)}
            fallbackLabel={entry.providerName}
            className="h-4 w-4 rounded-[0.35rem]"
            imageClassName="h-2.5 w-2.5"
          />
        ) : undefined,
      });
    }
    const trimmedValue = value.trim();
    if (trimmedValue && !catalogOptions.some((option) => option.value === trimmedValue)) {
      catalogOptions.unshift({ value: trimmedValue, label: trimmedValue });
    }
    return catalogOptions;
  }, [catalog, value, providerId]);

  return (
    <div className="min-w-[220px]">
      <AvantgardeSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        searchable
        allowCustomValue
        maxVisibleOptions={providerId ? 100 : undefined}
        aria-label={ariaLabel}
      />
    </div>
  );
};
