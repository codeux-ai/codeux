import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import { updateProviderConfig } from "../../../lib/settings-updaters.js";
import { thinkingModeOptions } from "../../settings/settings-options.js";
import type { FieldDescriptor } from "../../settings/field-descriptors.js";
import { SettingsFieldRenderer } from "../../settings/SettingsFieldRenderer.js";
import {
  getProviderModelOptions,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
} from "../../../v2/lib/settings-view-models.js";

interface ProviderConfigRowProps {
  provider: { value: DashboardSettings["aiProvider"]["provider"]; label: string };
  settings: DashboardSettings;
  onChange: (next: DashboardSettings) => void;
}

const getModelDescriptor = (providerValue: DashboardSettings["aiProvider"]["provider"]): FieldDescriptor<DashboardSettings> => {
  const modelOptions = getProviderModelOptions(providerValue);

  if (modelOptions.length > 0) {
    return {
      id: "model",
      type: "select",
      label: "Model",
      options: modelOptions,
      getValue: (settings) => settings.aiProvider.providers[providerValue].model,
      onChange: (settings, value) => updateProviderConfig(settings, providerValue, { model: value }),
    };
  }

  return {
    id: "model",
    type: "input",
    label: "Model",
    placeholder: providerValue === "codex" ? "gpt-5.3-codex" : "default",
    getValue: (settings) => settings.aiProvider.providers[providerValue].model,
    onInput: (settings, value) => updateProviderConfig(settings, providerValue, { model: value }),
  };
};

const getProviderDescriptors = (providerValue: DashboardSettings["aiProvider"]["provider"]): FieldDescriptor<DashboardSettings>[] => {
  const descriptors: FieldDescriptor<DashboardSettings>[] = [];

  if (providerSupportsModelSelection(providerValue)) {
    descriptors.push(getModelDescriptor(providerValue));
  }
  if (providerSupportsThinkingMode(providerValue)) {
    descriptors.push({
    id: "thinkingMode",
    type: "select",
    label: "Thinking",
    options: thinkingModeOptions,
    getValue: (settings) => settings.aiProvider.providers[providerValue].thinkingMode,
    onChange: (settings, value) => updateProviderConfig(settings, providerValue, { thinkingMode: value as any }),
    });
  }

  descriptors.push({
    id: "weight",
    type: "range",
    label: "Weight",
    min: 0,
    max: 100,
    getLabelSuffix: (value) => `${value}%`,
    getValue: (settings) => settings.aiProvider.providers[providerValue].weight,
    onInput: (settings, value) => updateProviderConfig(settings, providerValue, { weight: value }),
  });

  return descriptors;
};

const getApiKeyDescriptor = (providerValue: DashboardSettings["aiProvider"]["provider"]): FieldDescriptor<DashboardSettings> => ({
  id: "apiKey",
  type: "input",
  inputType: "password",
  label: "API Key (optional)",
  placeholder: providerValue === "gemini" ? "GEMINI_API_KEY" : providerValue === "codex" ? "OPENAI_API_KEY" : providerValue === "claude-code" ? "ANTHROPIC_API_KEY" : "JULES_API_KEY",
  getValue: (settings) => settings.aiProvider.providers[providerValue].apiKey,
  onInput: (settings, value) => updateProviderConfig(settings, providerValue, { apiKey: value }),
});

export const ProviderConfigRow: FunctionComponent<ProviderConfigRowProps> = ({ provider, settings, onChange }) => {
  const providerConfig = settings.aiProvider.providers[provider.value];
  const gridDescriptors = getProviderDescriptors(provider.value);
  const apiKeyDescriptor = getApiKeyDescriptor(provider.value);
  const showJulesCapabilityNote = !providerSupportsModelSelection(provider.value) || !providerSupportsThinkingMode(provider.value);

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-200">{provider.label}</p>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={providerConfig.enabled}
            onChange={(event) =>
              onChange(updateProviderConfig(settings, provider.value, {
                enabled: event.currentTarget.checked,
              }))
            }
            className="h-4 w-4 rounded border-slate-700 bg-slate-900"
          />
          Enabled
        </label>
      </div>

      {showJulesCapabilityNote ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          Jules API uses provider-managed defaults. Model selection and thinking controls are hidden here because the current API does not expose them.
        </p>
      ) : null}

      <div className={`grid grid-cols-1 gap-2 ${gridDescriptors.length > 1 ? "md:grid-cols-3" : ""}`}>
        {gridDescriptors.map((descriptor) => (
          <SettingsFieldRenderer
            key={descriptor.id}
            descriptor={descriptor}
            context={settings}
            onChange={onChange}
            className="block space-y-1 [&_span]:text-[11px] [&_span]:text-slate-500 [&_input]:px-2 [&_input]:py-1.5 [&_input]:text-xs [&_select]:px-2 [&_select]:py-1.5 [&_select]:text-xs"
          />
        ))}
      </div>

      <SettingsFieldRenderer
        descriptor={apiKeyDescriptor}
        context={settings}
        onChange={onChange}
        className="block space-y-1 [&_span]:text-[11px] [&_span]:text-slate-500 [&_input]:px-2 [&_input]:py-1.5 [&_input]:text-xs"
      />
    </div>
  );
};
