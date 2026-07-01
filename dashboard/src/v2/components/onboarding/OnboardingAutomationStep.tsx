import type { FunctionComponent } from "preact";
import type { SystemSettings } from "../../../types.js";
import { PillChoiceGroup } from "../settings/SettingsFormFields.js";
import { Toggle as UiToggle } from "../ui/Toggle.js";

const ToggleRow = ({ title, description, checked, onChange }: { title: string, description: string, checked: boolean, onChange: (v: boolean) => void }) => (
  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-bold text-slate-900 dark:text-white">{title}</div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</div>
      </div>
      <UiToggle value={checked} onChange={onChange} aria-label={title} />
    </div>
  </div>
);


const Choice = ({ title, value, options, onChange }: { title: string, value: string, options: [string, string][], onChange: (v: string) => void }) => (
  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
    <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{title}</div>
    <PillChoiceGroup
      value={value}
      onChange={onChange}
      options={options.map(([v, l]) => ({ value: v, label: l }))}
    />
  </div>
);

export interface OnboardingAutomationStepProps {
  settings: SystemSettings | null;
  updateSettings: (recipe: (current: SystemSettings) => SystemSettings) => void;
}

export const OnboardingAutomationStep: FunctionComponent<OnboardingAutomationStepProps> = ({
  settings,
  updateSettings,
}) => {
  if (!settings) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Choice title="Automation level" value={settings.defaults.automationLevel} options={[["ALWAYS_ASK", "Manual"], ["SEMI_AUTO", "Semi-auto"], ["FULL", "Full auto"]]} onChange={(v) => updateSettings((s) => ({ ...s, defaults: { ...s.defaults, automationLevel: v as any } }))} />

      <Choice title="Feature PR automerge" value={settings.defaults.ciIntelligence.featurePrAutoMergeMode} options={[
        ["OFF", "Off"],
        ["CREATE_PR", "Create PR"],
        ["WHEN_GREEN", "When green"],
        ["ALWAYS", "Always"],
      ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, featurePrAutoMergeMode: value as any } } }))} />
      <Choice title="Main PR automerge" value={settings.defaults.ciIntelligence.mainBranchAutoMergeMode} options={[
        ["OFF", "Off"],
        ["CREATE_PR", "Create PR"],
        ["WHEN_GREEN", "When green"],
        ["ALWAYS", "Always"],
      ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, mainBranchAutoMergeMode: value as any } } }))} />
      <ToggleRow title="Auto-approve plans" description="Let planning continue without manual approval when the generated plan is available." checked={settings.defaults.automationInterventions.autoApprovePlan} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, automationInterventions: { ...current.defaults.automationInterventions, autoApprovePlan: checked } } }))} />
      <ToggleRow title="Memory system" description="Capture sprint and agent learnings for later retrieval." checked={settings.defaults.memory.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, memory: { ...current.defaults.memory, enabled: checked } } }))} />
      <ToggleRow title="Resolve main merge conflicts" description="Let a virtual worker attempt conflicts on the main branch merge gate before escalating." checked={settings.defaults.ciIntelligence.resolveMainMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeConflicts: checked } } }))} />
      <ToggleRow title="Fix main merge CI failures" description="Let a virtual worker fix failing CI on the main branch merge gate before escalating." checked={settings.defaults.ciIntelligence.resolveMainMergeFailedChecks} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeFailedChecks: checked } } }))} />
      <ToggleRow title="Resolve feature merge conflicts" description="Let a virtual worker resolve feature PR conflicts against the sprint branch when safe." checked={settings.defaults.ciIntelligence.resolveMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMergeConflicts: checked } } }))} />
      <ToggleRow title="Enable QA agent" description="Run quality-assurance reviews after task and sprint completion events." checked={settings.defaults.agents.qualityAssurance.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, agents: { ...current.defaults.agents, qualityAssurance: { ...current.defaults.agents.qualityAssurance, enabled: checked } } } }))} />




    </div>
  );
};