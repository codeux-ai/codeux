import type { FunctionComponent } from "preact";
import type { SystemSettings } from "../../../types.js";
import { PillChoiceGroup, Row, Toggle } from "../settings/SettingsFormFields.js";
import { SectionCard } from "../settings/panels/SharedPanelComponents.js";

export interface OnboardingAppearanceStepProps {
  settings: SystemSettings | null;
  updateAppearance: (updates: Partial<SystemSettings["defaults"]["appearance"]>) => void;
}

export const OnboardingAppearanceStep: FunctionComponent<OnboardingAppearanceStepProps> = ({
  settings,
  updateAppearance,
}) => {
  if (!settings) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left Column: Core Layout & Feel */}
        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-signal-400">Core Display</h4>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Theme Preference</div>
            <PillChoiceGroup
              value={settings.defaults.appearance.theme}
              onChange={(v) => updateAppearance({ theme: v as "SYSTEM" | "LIGHT" | "DARK" })}
              options={[
                { value: "SYSTEM", label: "System" },
                { value: "LIGHT", label: "Light" },
                { value: "DARK", label: "Dark" },
              ]}
            />
          </div>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Navigation Layout</div>
            <PillChoiceGroup
              value={settings.defaults.appearance.navigationMode}
              onChange={(v) => updateAppearance({ navigationMode: v as "SIDEBAR" | "DOCK" })}
              options={[
                { value: "SIDEBAR", label: "Sidebar" },

                { value: "DOCK", label: "Dock" },
              ]}
            />
          </div>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <Row
              label="Enable Reduced Motion"
              description="Disable background animations and transitions"
            >
              <Toggle
                aria-labelledby="reduced-motion-label"
                value={settings.defaults.appearance.reducedMotion === "REDUCE"}
                onChange={(v) => updateAppearance({ reducedMotion: v ? "REDUCE" : "NONE" })}
              />
            </Row>
          </div>
        </div>

        {/* Right Column: Code & Terminal */}
        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-signal-400">Code & Terminal</h4>

          </div>
      </div>
    </div>
  );
};