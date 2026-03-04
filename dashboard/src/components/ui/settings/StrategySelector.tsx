import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import { providerOptions, providerStrategyOptions } from "../../settings/settings-options.js";

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
      <select
        value={strategy}
        onChange={(event) => onStrategyChange(event.currentTarget.value as DashboardSettings["aiProvider"]["strategy"])}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      >
        {providerStrategyOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
    <label className="block space-y-2">
      <span className="text-xs text-slate-400">Manual Default Provider</span>
      <select
        value={provider}
        onChange={(event) => onProviderChange(event.currentTarget.value as DashboardSettings["aiProvider"]["provider"])}
        disabled={strategy !== "MANUAL"}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
      >
        {providerOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500">
        `MANUAL` uses selected provider, `WEIGHTED` uses provider weights, `ORCHESTRATOR` routes by task complexity with weighted fallback.
      </p>
    </label>
  </>
);
