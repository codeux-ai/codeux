import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import { providerOptions, providerStrategyOptions } from "../../settings/settings-options.js";
import { AvantgardeSelect } from "../../../v2/components/ui/AvantgardeSelect.js";

interface StrategySelectorProps {
  strategy: DashboardSettings["aiProvider"]["strategy"];
  provider: DashboardSettings["aiProvider"]["provider"];
  onStrategyChange: (strategy: DashboardSettings["aiProvider"]["strategy"]) => void;
  onProviderChange: (provider: DashboardSettings["aiProvider"]["provider"]) => void;
}

export const StrategySelector: FunctionComponent<StrategySelectorProps> = ({
  strategy,
  provider,
  onStrategyChange,
  onProviderChange,
}) => (
  <>
    <label className="block space-y-2">
      <span className="text-xs text-slate-400">Routing Strategy</span>
      <AvantgardeSelect
        value={strategy}
        onChange={(val) => onStrategyChange(val as DashboardSettings["aiProvider"]["strategy"])}
        options={providerStrategyOptions}
      />
    </label>
    <label className="block space-y-2">
      <span className="text-xs text-slate-400">Manual Default Provider</span>
      <AvantgardeSelect
        value={provider || ""}
        onChange={(val) => onProviderChange(val as DashboardSettings["aiProvider"]["provider"])}
        options={providerOptions.filter((option) => option.value !== null).map((option) => ({
          value: String(option.value),
          label: option.label,
        }))}
        disabled={strategy !== "MANUAL"}
      />
      <p className="text-[11px] text-slate-500">
        `MANUAL` uses selected provider, `WEIGHTED` uses provider weights, `ORCHESTRATOR` routes by task complexity with weighted fallback.
      </p>
    </label>
  </>
);
