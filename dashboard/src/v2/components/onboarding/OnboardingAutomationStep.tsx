import type { FunctionComponent } from "preact";
import type { SystemSettings } from "../../../types.js";
import { PillChoiceGroup } from "../settings/SettingsFormFields.js";

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
      <Choice title="Automation level" value={settings.defaults.automationLevel} options={[
        ["ALWAYS_ASK", "Manual"],
        ["SEMI_AUTO", "Semi-auto"],
        ["FULL", "Full auto"],
      ]} onChange={(v) => updateSettings((s) => ({ ...s, defaults: { ...s.defaults, automationLevel: v as any } }))} />



    </div>
  );
};