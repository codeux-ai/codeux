import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../../types.js";
import { executionModeOptions } from "../../settings/settings-options.js";
import { FieldLabel } from "../../settings/primitives.js";
import { AvantgardeSelect } from "../../../v2/components/ui/AvantgardeSelect.js";

interface ExecutionModeSelectorProps {
  executionMode: DashboardSettings["cliWorkflow"]["executionMode"];
  onChange: (mode: DashboardSettings["cliWorkflow"]["executionMode"]) => void;
}

export const ExecutionModeSelector: FunctionComponent<ExecutionModeSelectorProps> = ({ executionMode, onChange }) => (
  <label className="block space-y-2">
    <FieldLabel>Execution Mode</FieldLabel>
    <AvantgardeSelect
      value={executionMode}
      onChange={(val) => onChange(val as DashboardSettings["cliWorkflow"]["executionMode"])}
      options={executionModeOptions}
    />
  </label>
);
