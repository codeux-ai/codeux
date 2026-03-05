import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import { automationOptions } from "./settings-options.js";
import { SettingsCard } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";
import type { FieldDescriptor } from "./field-descriptors.js";
import { SettingsFieldRenderer } from "./SettingsFieldRenderer.js";

const basicDescriptors: FieldDescriptor<DashboardSettings>[] = [
  {
    id: "dashboardPort",
    type: "input",
    inputType: "number",
    label: "Dashboard Port",
    description: "Default `4444`. If the port is occupied, server startup automatically tries the next port.",
    min: 1,
    max: 65535,
    step: 1,
    getValue: (settings) => settings.dashboardPort,
    onInput: (settings, value) => ({
      ...settings,
      dashboardPort: Math.max(1, Math.min(65535, Number.parseInt(value || "4444", 10) || 4444)),
    }),
  },
  {
    id: "enableDebugLogFile",
    type: "toggle",
    label: "Enable Internal Debug Log File",
    description: "When enabled, internal server errors are logged to `.jules-subagents/debug.log` without polluting MCP stdout.",
    getValue: (settings) => settings.enableDebugLogFile,
    onToggle: (settings, checked) => ({ ...settings, enableDebugLogFile: checked }),
  },
  {
    id: "automationLevel",
    type: "select",
    label: "Automation Level",
    options: automationOptions,
    getValue: (settings) => settings.automationLevel,
    onChange: (settings, value) => ({ ...settings, automationLevel: value as DashboardSettings["automationLevel"] }),
  },
];

const automationInterventionDescriptors: FieldDescriptor<DashboardSettings>[] = [
  {
    id: "autoApprovePlan",
    type: "toggle",
    label: "Auto-approve plan requests",
    disabled: (settings) => settings.automationLevel !== "SEMI_AUTO",
    getValue: (settings) => settings.automationInterventions.autoApprovePlan,
    onToggle: (settings, checked) => ({
      ...settings,
      automationInterventions: { ...settings.automationInterventions, autoApprovePlan: checked },
    }),
  },
  {
    id: "autoAnswerClarification",
    type: "toggle",
    label: "Auto-answer clarification requests",
    disabled: (settings) => settings.automationLevel !== "SEMI_AUTO",
    getValue: (settings) => settings.automationInterventions.autoAnswerClarification,
    onToggle: (settings, checked) => ({
      ...settings,
      automationInterventions: { ...settings.automationInterventions, autoAnswerClarification: checked },
    }),
  },
  {
    id: "autoResumePaused",
    type: "toggle",
    label: "Auto-resume paused sessions",
    disabled: (settings) => settings.automationLevel !== "SEMI_AUTO",
    getValue: (settings) => settings.automationInterventions.autoResumePaused,
    onToggle: (settings, checked) => ({
      ...settings,
      automationInterventions: { ...settings.automationInterventions, autoResumePaused: checked },
    }),
  },
  {
    id: "clarificationAnswerTemplate",
    type: "textarea",
    label: "Clarification auto-answer template",
    disabled: (settings) => settings.automationLevel !== "SEMI_AUTO" && settings.automationLevel !== "FULL",
    rows: 4,
    getValue: (settings) => settings.automationInterventions.clarificationAnswerTemplate,
    onInput: (settings, value) => ({
      ...settings,
      automationInterventions: { ...settings.automationInterventions, clarificationAnswerTemplate: value },
    }),
  },
];

export const BasicSettingsSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard title="Basic Settings">
    {basicDescriptors.map((descriptor) => (
      <SettingsFieldRenderer
        key={descriptor.id}
        descriptor={descriptor}
        context={settings}
        onChange={onChange}
      />
    ))}

    <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300">Jules Action Handling</p>
      <p className="text-[11px] text-slate-500">
        FULL auto-handles plan approvals, clarification replies, and paused sessions. ALWAYS_ASK requires human intervention. SEMI_AUTO follows the toggles below.
      </p>
      {automationInterventionDescriptors.map((descriptor) => (
        <SettingsFieldRenderer
          key={descriptor.id}
          descriptor={descriptor}
          context={settings}
          onChange={onChange}
          className={descriptor.type === "textarea" ? "block space-y-2" : undefined}
        />
      ))}
    </div>
  </SettingsCard>
);
