import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import { updateCiIntelligence } from "../../lib/settings-updaters.js";
import { SettingsCard } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";
import type { FieldDescriptor } from "./field-descriptors.js";
import { SettingsFieldRenderer } from "./SettingsFieldRenderer.js";

const ciDescriptors: FieldDescriptor<DashboardSettings>[] = [
  {
    id: "enabled",
    type: "toggle",
    label: "Enable CI Intelligence",
    getValue: (settings) => settings.ciIntelligence.enabled,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { enabled: checked }),
  },
  {
    id: "enableLivePrMonitoring",
    type: "toggle",
    label: "Enable Live PR Monitoring",
    disabled: (settings) => !settings.ciIntelligence.enabled || settings.git.githubMode === "LOCAL",
    getValue: (settings) => settings.ciIntelligence.enableLivePrMonitoring,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { enableLivePrMonitoring: checked }),
  },
  {
    id: "resolveAllCommentsBeforeMainMerge",
    type: "toggle",
    label: "Resolve all comments before merge into main",
    disabled: (settings) => !settings.ciIntelligence.enabled,
    getValue: (settings) => settings.ciIntelligence.resolveAllCommentsBeforeMainMerge,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { resolveAllCommentsBeforeMainMerge: checked }),
  },
  {
    id: "resolveAllCommentsBeforeFeatureMerge",
    type: "toggle",
    label: "Resolve all comments before merge into feature branch",
    disabled: (settings) => !settings.ciIntelligence.enabled,
    getValue: (settings) => settings.ciIntelligence.resolveAllCommentsBeforeFeatureMerge,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { resolveAllCommentsBeforeFeatureMerge: checked }),
  },
  {
    id: "resolveMainMergeConflicts",
    type: "toggle",
    label: "Resolve Main Merge Conflicts",
    description: "Escalate detected main-branch merge conflicts to the virtual worker with branch and sprint context.",
    disabled: (settings) => !settings.ciIntelligence.enabled || settings.git.githubMode === "LOCAL",
    getValue: (settings) => settings.ciIntelligence.resolveMainMergeConflicts,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { resolveMainMergeConflicts: checked }),
  },
  {
    id: "resolveMergeConflicts",
    type: "toggle",
    label: "Resolve Feature Merge Conflicts",
    description: "Escalate detected feature-branch merge conflicts to the virtual worker with branch and task prompt context.",
    disabled: (settings) => !settings.ciIntelligence.enabled || settings.git.githubMode === "LOCAL",
    getValue: (settings) => settings.ciIntelligence.resolveMergeConflicts,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { resolveMergeConflicts: checked }),
  },
  {
    id: "waitForJulesCiAutofix",
    type: "toggle",
    label: "Wait for Jules CI Autofix on feature PRs",
    disabled: (settings) => !settings.ciIntelligence.enabled || settings.ciIntelligence.featurePrAutoMergeMode !== "WHEN_GREEN",
    getValue: (settings) => settings.ciIntelligence.waitForJulesCiAutofix,
    onToggle: (settings, checked) => updateCiIntelligence(settings, { waitForJulesCiAutofix: checked }),
  },
  {
    id: "julesCiAutofixMaxRetries",
    type: "input",
    inputType: "number",
    label: "Jules CI Autofix Max Retries",
    description: "After this many failed CI autofix attempts, escalation is raised with exact task IDs and PR links.",
    min: 0,
    max: 20,
    disabled: (settings) => !settings.ciIntelligence.enabled || !settings.ciIntelligence.waitForJulesCiAutofix,
    getValue: (settings) => settings.ciIntelligence.julesCiAutofixMaxRetries,
    onInput: (settings, value) => updateCiIntelligence(settings, { julesCiAutofixMaxRetries: Number(value) }),
  },
  {
    id: "featurePrAutoMergeMode",
    type: "select",
    label: "Feature PR Auto-merge Policy",
    description: "Choose whether feature PRs stop at PR creation, merge only when green, merge immediately when allowed, or stay off.",
    disabled: (settings) => !settings.ciIntelligence.enabled,
    options: [
      { value: "OFF", label: "Disabled" },
      { value: "CREATE_PR", label: "Create PR only" },
      { value: "WHEN_GREEN", label: "When CI and review are clear" },
      { value: "ALWAYS", label: "Always attempt auto-merge" },
    ],
    getValue: (settings) => settings.ciIntelligence.featurePrAutoMergeMode,
    onChange: (settings, value) => updateCiIntelligence(settings, { featurePrAutoMergeMode: value as typeof settings.ciIntelligence.featurePrAutoMergeMode }),
  },
  {
    id: "mainBranchAutoMergeMode",
    type: "select",
    label: "Main Branch Auto-merge Policy",
    description: "Choose whether Sprint OS leaves the final PR alone, creates it only, merges when green, or merges immediately when allowed.",
    disabled: (settings) => !settings.ciIntelligence.enabled,
    options: [
      { value: "OFF", label: "Disabled" },
      { value: "CREATE_PR", label: "Create PR only" },
      { value: "WHEN_GREEN", label: "When CI and review are clear" },
      { value: "ALWAYS", label: "Always attempt auto-merge" },
    ],
    getValue: (settings) => settings.ciIntelligence.mainBranchAutoMergeMode,
    onChange: (settings, value) => updateCiIntelligence(settings, { mainBranchAutoMergeMode: value as typeof settings.ciIntelligence.mainBranchAutoMergeMode }),
  },
];

export const CiIntelligenceSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard
    title="CI Intelligence"
    description="Controls protocol checks generated by the sprint loop for feature branch and main branch merge stages."
  >
    {ciDescriptors.map((descriptor) => (
      <SettingsFieldRenderer
        key={descriptor.id}
        descriptor={descriptor}
        context={settings}
        onChange={onChange}
        className={descriptor.type === "input" || descriptor.type === "select" ? "block space-y-2 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2" : undefined}
      />
    ))}
  </SettingsCard>
);
