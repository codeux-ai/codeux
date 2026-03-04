import type { FunctionComponent } from "preact";
import { updateAiProvider } from "../../lib/settings-updaters.js";
import {
  providerOptions,
} from "./settings-options.js";
import { SettingsCard } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";
import { ProviderConfigRow } from "../ui/settings/ProviderConfigRow.js";
import { StrategySelector } from "../ui/settings/StrategySelector.js";

export const AiProviderSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard title="AI Provider">
    <StrategySelector
      strategy={settings.aiProvider.strategy}
      provider={settings.aiProvider.provider}
      onStrategyChange={(strategy) =>
        onChange(updateAiProvider(settings, { strategy }))
      }
      onProviderChange={(provider) =>
        onChange(updateAiProvider(settings, { provider }))
      }
    />
    <div className="space-y-3">
      {providerOptions.map((provider) => (
        <ProviderConfigRow
          key={provider.value}
          provider={provider}
          settings={settings}
          onChange={onChange}
        />
      ))}
    </div>
    <p className="text-[11px] text-slate-500">
      Keys are optional. Empty values fallback to system-wide env/auth. Session workflows remain branch+PR based across providers.
    </p>
  </SettingsCard>
);
