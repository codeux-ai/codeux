import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { AvantgardeSelect, type SelectOption } from "./AvantgardeSelect.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { modelsDevLogoUrl } from "./ModelCombobox.js";
import type { ModelCatalogProviderSummary } from "../../../../../src/domain/model-catalog/model-catalog-types.js";

let providersPromise: Promise<ModelCatalogProviderSummary[]> | null = null;

function loadProviderCatalog(): Promise<ModelCatalogProviderSummary[]> {
  if (!providersPromise) {
    providersPromise = fetch("/api/model-catalog/providers")
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => []);
  }
  return providersPromise;
}

/** Test-only hook to force a re-fetch on the next render. */
export function resetProviderCatalogCache(): void {
  providersPromise = null;
}

export function useProviderCatalog(): ModelCatalogProviderSummary[] {
  const [providers, setProviders] = useState<ModelCatalogProviderSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadProviderCatalog().then((entries) => {
      if (!cancelled) setProviders(entries);
    });
    return () => { cancelled = true; };
  }, []);
  return providers;
}

/**
 * Searchable, icon-enhanced API provider picker sourced from the models.dev catalogue.
 * Selecting a known provider reports its published base API endpoint (when models.dev has
 * one) so the caller can autofill a base-URL field; typing a provider outside the catalogue
 * is also accepted (self-hosted gateways, private proxies) and reports no endpoint.
 */
export const ProviderCombobox: FunctionComponent<{
  value: string;
  onChange: (value: string, apiBaseUrl: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}> = ({ value, onChange, disabled = false, placeholder = "Search providers…", "aria-label": ariaLabel }) => {
  const providers = useProviderCatalog();

  const options = useMemo<SelectOption[]>(() => {
    const providerOptions: SelectOption[] = providers.map((provider) => ({
      value: provider.id,
      label: provider.name,
      icon: (
        <ProviderBrandIcon
          id={provider.id}
          src={modelsDevLogoUrl(provider.id)}
          fallbackLabel={provider.name}
          className="h-4 w-4 rounded-[0.35rem]"
          imageClassName="h-2.5 w-2.5"
        />
      ),
    }));
    const trimmedValue = value.trim();
    if (trimmedValue && !providerOptions.some((option) => option.value === trimmedValue)) {
      providerOptions.unshift({ value: trimmedValue, label: trimmedValue });
    }
    return providerOptions;
  }, [providers, value]);

  return (
    <div className="min-w-[220px]">
      <AvantgardeSelect
        value={value}
        onChange={(nextValue) => {
          const match = providers.find((provider) => provider.id === nextValue);
          onChange(nextValue, match?.apiBaseUrl);
        }}
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
