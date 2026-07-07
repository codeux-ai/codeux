import type { FunctionComponent, TargetedEvent } from "preact";
import type { SystemSettings } from "../../../types.js";
import { PillChoiceGroup, SelectInput } from "../settings/SettingsFormFields.js";

export interface OnboardingAppearanceStepProps {
  settings: SystemSettings | null;
  updateAppearance: (updates: Partial<SystemSettings["defaults"]["appearance"]>) => void;
}

type AppearanceSettings = SystemSettings["defaults"]["appearance"];
type AppearanceOption<T extends string> = { value: T; label: string; hint?: string };

const themeOptions: Array<AppearanceOption<AppearanceSettings["theme"]>> = [
  { value: "SYSTEM", label: "System", hint: "Follow the OS preference." },
  { value: "LIGHT", label: "Light", hint: "Use the bright dashboard palette." },
  { value: "DARK", label: "Dark", hint: "Use the low-light dashboard palette." },
];

const navigationModeOptions: Array<AppearanceOption<AppearanceSettings["navigationMode"]>> = [
  { value: "SIDEBAR", label: "Sidebar", hint: "Keep navigation visible." },
  { value: "DOCK", label: "Dock", hint: "Use the compact floating dock." },
];

const reducedMotionOptions: Array<AppearanceOption<AppearanceSettings["reducedMotion"]>> = [
  { value: "AUTO", label: "Auto", hint: "Follow the OS preference." },
  { value: "REDUCE", label: "Reduce", hint: "Minimize motion." },
  { value: "NONE", label: "None", hint: "Use standard motion." },
];

const backgroundModeOptions: Array<AppearanceOption<AppearanceSettings["backgroundMode"]>> = [
  { value: "ANIMATED", label: "Animated", hint: "Use the dashboard shader background." },
  { value: "STATIC", label: "Static", hint: "Use a solid color." },
];

const zoomLevelOptions: Array<{ value: string; label: string }> = [
  { value: "0.75", label: "75%" },
  { value: "0.9", label: "90%" },
  { value: "1", label: "100%" },
  { value: "1.1", label: "110%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "1.75", label: "175%" },
  { value: "2", label: "200%" },
  { value: "2.25", label: "225%" },
  { value: "2.5", label: "250%" },
];

function isOptionValue<T extends string>(
  value: string,
  options: ReadonlyArray<AppearanceOption<T>>,
): value is T {
  return options.some((option) => option.value === value);
}

export const OnboardingAppearanceStep: FunctionComponent<OnboardingAppearanceStepProps> = ({
  settings,
  updateAppearance,
}) => {
  if (!settings) return null;

  const appearance = settings.defaults.appearance;
  const supportsNativeZoom = typeof window !== "undefined" && Boolean(window.codeUxDesktop?.setZoom);
  const backgroundMode = appearance.backgroundMode ?? "ANIMATED";
  const staticBackgroundColor = appearance.staticBackgroundColor || "#0d0f12";

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-signal-400">Core Display</h4>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Theme</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select light, dark, or sync with your system.</div>
            <div className="mt-4">
              <PillChoiceGroup
                value={appearance.theme}
                onChange={(value) => {
                  if (isOptionValue(value, themeOptions)) {
                    updateAppearance({ theme: value });
                  }
                }}
                options={themeOptions}
              />
            </div>
          </div>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Navigation Mode</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose between floating dock or sidebar.</div>
            <div className="mt-4">
              <PillChoiceGroup
                value={appearance.navigationMode}
                onChange={(value) => {
                  if (isOptionValue(value, navigationModeOptions)) {
                    updateAppearance({ navigationMode: value });
                  }
                }}
                options={navigationModeOptions}
              />
            </div>
          </div>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Reduced Motion</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Limit interface animations and transitions.</div>
            <div className="mt-4">
              <PillChoiceGroup
                value={appearance.reducedMotion}
                onChange={(value) => {
                  if (isOptionValue(value, reducedMotionOptions)) {
                    updateAppearance({ reducedMotion: value });
                  }
                }}
                options={reducedMotionOptions}
              />
            </div>
          </div>

          {supportsNativeZoom ? (
            <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Zoom Level</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Scale the desktop interface size.</div>
              <div className="mt-4">
                <SelectInput
                  value={String(appearance.zoomLevel ?? 1)}
                  onChange={(value) => updateAppearance({ zoomLevel: Number(value) })}
                  options={zoomLevelOptions}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-signal-400">Background</h4>

          <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Background Mode</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select animated textures or a flat color.</div>
            <div className="mt-4">
              <PillChoiceGroup
                value={backgroundMode}
                onChange={(value) => {
                  if (isOptionValue(value, backgroundModeOptions)) {
                    updateAppearance({ backgroundMode: value });
                  }
                }}
                options={backgroundModeOptions}
              />
            </div>
          </div>

          {backgroundMode === "STATIC" ? (
            <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Static Color</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a solid background color.</div>
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="color"
                  value={staticBackgroundColor}
                  onInput={(event: TargetedEvent<HTMLInputElement, Event>) => {
                    updateAppearance({ staticBackgroundColor: event.currentTarget.value });
                  }}
                  className="h-10 w-20 cursor-pointer rounded-lg border-2 border-black/[0.06] bg-transparent p-1 focus:outline-none focus:ring-2 focus:ring-signal-500 dark:border-white/[0.06]"
                />
                <span className="font-mono text-sm uppercase text-slate-500 dark:text-slate-400">
                  {staticBackgroundColor}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
