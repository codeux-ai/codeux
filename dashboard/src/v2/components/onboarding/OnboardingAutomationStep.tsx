import type { FunctionComponent } from "preact";
import type { SystemSettings } from "../../../types.js";
import { PillChoiceGroup } from "../settings/SettingsFormFields.js";
import { Toggle as UiToggle } from "../ui/Toggle.js";
import { useOnboardingMessages } from "../../i18n/messages/onboarding.js";

type AutomationLevel = SystemSettings["defaults"]["automationLevel"];
type AutoMergeMode = SystemSettings["defaults"]["ciIntelligence"]["featurePrAutoMergeMode"];

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


const Choice = <TValue extends string,>({ title, value, options, onChange }: { title: string, value: TValue, options: Array<[TValue, string]>, onChange: (v: TValue) => void }) => (
  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
    <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{title}</div>
    <PillChoiceGroup
      value={value}
      onChange={(nextValue) => onChange(nextValue as TValue)}
      options={options.map(([v, l]) => ({ value: v, label: l }))}
      aria-label={title}
      valid
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
  const { t } = useOnboardingMessages();
  if (!settings) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Choice<AutomationLevel> title={t("automationLevel")} value={settings.defaults.automationLevel} options={[["ALWAYS_ASK", t("manual")], ["SEMI_AUTO", t("semiAuto")], ["FULL", t("fullAuto")]]} onChange={(v) => updateSettings((s) => ({ ...s, defaults: { ...s.defaults, automationLevel: v } }))} />

      <Choice<AutoMergeMode> title={t("featurePrAutomerge")} value={settings.defaults.ciIntelligence.featurePrAutoMergeMode} options={[
        ["OFF", t("off")],
        ["CREATE_PR", t("createPr")],
        ["WHEN_GREEN", t("whenGreen")],
        ["ALWAYS", t("always")],
      ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, featurePrAutoMergeMode: value } } }))} />
      <Choice<AutoMergeMode> title={t("mainPrAutomerge")} value={settings.defaults.ciIntelligence.mainBranchAutoMergeMode} options={[
        ["OFF", t("off")],
        ["CREATE_PR", t("createPr")],
        ["WHEN_GREEN", t("whenGreen")],
        ["ALWAYS", t("always")],
      ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, mainBranchAutoMergeMode: value } } }))} />
      <ToggleRow title={t("autoApprovePlans")} description={t("autoApprovePlansBody")} checked={settings.defaults.automationInterventions.autoApprovePlan} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, automationInterventions: { ...current.defaults.automationInterventions, autoApprovePlan: checked } } }))} />
      <ToggleRow title={t("memorySystem")} description={t("memorySystemBody")} checked={settings.defaults.memory.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, memory: { ...current.defaults.memory, enabled: checked } } }))} />
      <ToggleRow title={t("resolveMainConflicts")} description={t("resolveMainConflictsBody")} checked={settings.defaults.ciIntelligence.resolveMainMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeConflicts: checked } } }))} />
      <ToggleRow title={t("fixMainCi")} description={t("fixMainCiBody")} checked={settings.defaults.ciIntelligence.resolveMainMergeFailedChecks} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeFailedChecks: checked } } }))} />
      <ToggleRow title={t("resolveFeatureConflicts")} description={t("resolveFeatureConflictsBody")} checked={settings.defaults.ciIntelligence.resolveMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMergeConflicts: checked } } }))} />
      <ToggleRow title={t("enableQaAgent")} description={t("enableQaAgentBody")} checked={settings.defaults.agents.qualityAssurance.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, agents: { ...current.defaults.agents, qualityAssurance: { ...current.defaults.agents.qualityAssurance, enabled: checked } } } }))} />




    </div>
  );
};
