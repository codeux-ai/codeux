import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import { executionModeOptions } from "../../settings/settings-options.js";
import { FieldLabel } from "../../settings/primitives.js";

interface ExecutionModeSelectorProps {
  executionMode: DashboardSettings["cliWorkflow"]["executionMode"];
  onChange: (mode: DashboardSettings["cliWorkflow"]["executionMode"]) => void;
}

export const ExecutionModeSelector: FunctionComponent<ExecutionModeSelectorProps> = ({ executionMode, onChange }) => (
  <label className="block space-y-2">
    <FieldLabel>Execution Mode</FieldLabel>
    <select
      value={executionMode}
      onChange={(event) => onChange(event.currentTarget.value as DashboardSettings["cliWorkflow"]["executionMode"])}
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
    >
      {executionModeOptions.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);
