import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";

interface ProviderConfigRowProps {
  provider: { value: DashboardSettings["aiProvider"]["provider"]; label: string };
  settings: DashboardSettings;
  onChange: (next: DashboardSettings) => void;
}

// Legacy v1 settings surface: retained only so older imports keep compiling.
// The active product UI now uses the v2 Settings page with provider instances.
export const ProviderConfigRow: FunctionComponent<ProviderConfigRowProps> = ({ provider }) => (
  <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 text-xs text-slate-400">
    Provider configuration for `{provider.label}` moved to the v2 Settings page.
  </div>
);
