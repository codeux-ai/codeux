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
 * Searchable, icon-enhanced model picker sourced from the models.dev catalogue
 * (https://models.dev), prefetched into assets/models-dev/catalog.json and served via
 * GET /api/model-catalog. Falls back to a free-typed value for models outside the
 * catalogue (private/self-hosted gateway models).
 *
 * The value is always the bare model identifier (e.g. "claude-sonnet-4-5"), never a
 * "<provider>/<model>" composite — the provider is a separate, paired field (see
 * ProviderCombobox), and most APIs reject a provider-prefixed model id. When `providerId`
 * is set, options are restricted to that provider's models so the identifier is guaranteed
 * correct for whichever endpoint the paired provider field points at.
 */
export const ModelCombobox: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  /** Restrict results to a single models.dev provider id, paired with an API provider field. */
  providerId?: string;
}> = ({ value, onChange, disabled = false, placeholder = "Search models…", "aria-label": ariaLabel, providerId }) => {
  const catalog = useModelCatalog();

  const options = useMemo<SelectOption[]>(() => {
    const scoped = providerId ? catalog.filter((entry) => entry.providerId === providerId) : catalog;
    const catalogOptions: SelectOption[] = scoped.map((entry) => ({
      value: entry.modelId,
      label: providerId ? entry.modelName : `${entry.providerName} — ${entry.modelName}`,
      icon: (
        <ProviderBrandIcon
          id={entry.providerId}
          src={modelsDevLogoUrl(entry.providerId)}
          fallbackLabel={entry.providerName}
          className="h-4 w-4 rounded-[0.35rem]"
          imageClassName="h-2.5 w-2.5"
        />
      ),
    }));
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
        aria-label={ariaLabel}
      />
    </div>
  );
};
