import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { PillChoiceGroup } from "../SettingsFormFields.js";
import { SectionCard, Row, getFieldBadge } from "./SharedPanelComponents.js";
import { applyAppearanceSettings } from "../../../lib/apply-appearance.js";

export const SettingsAppearancePanel: FunctionComponent<{
  state: SettingsPageState;
}> = ({ state }) => {
  const settings = state.editableSettings;
  if (!settings) {
    return null;
  }

  const { activeScope, projectSources } = state;
  const appearance = settings.appearance;
  const [showSizeWarning, setShowSizeWarning] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Display Settings" watermark="UI">
        <Row
          label="Navigation Mode"
          description="Choose between a floating dock or a traditional sidebar."
          badge={getFieldBadge(activeScope, projectSources, "appearance.navigationMode")}
        >
          <PillChoiceGroup
            value={appearance.navigationMode}
            onChange={(val) => {
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  navigationMode: val as "DOCK" | "SIDEBAR",
                },
              }));
            }}
            options={[
              { value: "DOCK", label: "Dock" },
              { value: "SIDEBAR", label: "Sidebar" },
            ]}
          />
        </Row>

        <Row
          label="Theme"
          description="Select light, dark, or sync with your system preferences."
          badge={getFieldBadge(activeScope, projectSources, "appearance.theme")}
        >
          <PillChoiceGroup
            value={appearance.theme}
            onChange={(val) => {
              const newTheme = val as "LIGHT" | "DARK" | "SYSTEM";
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  theme: newTheme,
                },
              }));
              applyAppearanceSettings({ theme: newTheme });
            }}
            options={[
              { value: "LIGHT", label: "Light" },
              { value: "DARK", label: "Dark" },
              { value: "SYSTEM", label: "System" },
            ]}
          />
        </Row>

        <Row
          label="Reduced Motion"
          description="Limit interface animations and transitions."
          badge={getFieldBadge(activeScope, projectSources, "appearance.reducedMotion")}
          last
        >
          <PillChoiceGroup
            value={appearance.reducedMotion}
            onChange={(val) => {
              const newReducedMotion = val as "AUTO" | "REDUCE" | "NONE";
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  reducedMotion: newReducedMotion,
                },
              }));
              applyAppearanceSettings({ reducedMotion: newReducedMotion });
            }}
            options={[
              { value: "AUTO", label: "Auto" },
              { value: "REDUCE", label: "Reduce" },
              { value: "NONE", label: "None" },
            ]}
          />
        </Row>
      </SectionCard>

      <SectionCard title="Background" watermark="BG">
        <Row
          label="Background Image"
          description="Upload a custom background image."
          badge={getFieldBadge(activeScope, projectSources, "appearance.backgroundImage")}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4">
              {appearance.backgroundImage ? (
                <>
                  <img src={appearance.backgroundImage} alt="Background Thumbnail" className="h-16 w-16 rounded-lg object-cover border border-black/10 dark:border-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      state.updateEditableSettings((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          backgroundImage: null,
                        },
                      }));
                      applyAppearanceSettings({ backgroundImage: null });
                    }}
                    className="rounded-lg px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-void-800"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    id="bg-image-input"
                    className="hidden"
                    onChange={(e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;

                      setShowSizeWarning(file.size > 5 * 1024 * 1024);

                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const result = reader.result as string;
                        state.updateEditableSettings((current) => ({
                          ...current,
                          appearance: {
                            ...current.appearance,
                            backgroundImage: result,
                          },
                        }));
                        applyAppearanceSettings({ backgroundImage: result });
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('bg-image-input')?.click()}
                    className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-void-800 dark:text-slate-200 dark:hover:bg-void-700"
                  >
                    Upload Image
                  </button>
                </>
              )}
            </div>
            {showSizeWarning && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Large images may slow down the settings page.
              </p>
            )}
          </div>
        </Row>
      </SectionCard>

      <SectionCard title="Background Settings" watermark="BG">
        <Row
          label="Background Mode"
          description="Choose between animated backgrounds or a static solid color."
          badge={getFieldBadge(activeScope, projectSources, "appearance.backgroundMode")}
        >
          <PillChoiceGroup
            value={appearance.backgroundMode || "ANIMATED"}
            onChange={(val) => {
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  backgroundMode: val as "ANIMATED" | "STATIC",
                },
              }));
            }}
            options={[
              { value: "ANIMATED", label: "Animated" },
              { value: "STATIC", label: "Static" },
            ]}
          />
        </Row>

        {(appearance.backgroundMode || "ANIMATED") === "ANIMATED" ? (
          <Row
            label="Animation Style"
            description="Select an award-winning background animation."
            badge={getFieldBadge(activeScope, projectSources, "appearance.animatedBackground")}
            last
          >
            <PillChoiceGroup
              value={appearance.animatedBackground || "deep-ocean"}
              onChange={(val) => {
                state.updateEditableSettings((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    animatedBackground: val,
                  },
                }));
              }}
              options={[
                { value: "deep-ocean", label: "Deep Ocean" },
                { value: "neon-dreams", label: "Neon Dreams" },
                { value: "aurora-borealis", label: "Aurora Borealis" },
                { value: "cosmic-dust", label: "Cosmic Dust" },
                { value: "ethereal-mist", label: "Ethereal Mist" },
                { value: "quantum-field", label: "Quantum Field" },
              ]}
            />
          </Row>
        ) : (
          <Row
            label="Static Color"
            description="Choose a solid background color."
            badge={getFieldBadge(activeScope, projectSources, "appearance.staticBackgroundColor")}
            last
          >
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={appearance.staticBackgroundColor || "#0d0f12"}
                onInput={(e) => {
                  state.updateEditableSettings((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      staticBackgroundColor: (e.target as HTMLInputElement).value,
                    },
                  }));
                }}
                className="h-10 w-20 cursor-pointer rounded-lg border-2 border-black/[0.06] bg-transparent p-1 focus:outline-none focus:ring-2 focus:ring-signal-500 dark:border-white/[0.06]"
              />
              <span className="font-mono text-sm uppercase text-slate-500 dark:text-slate-400">
                {appearance.staticBackgroundColor || "#0d0f12"}
              </span>
            </div>
          </Row>
        )}
      </SectionCard>
    </div>
  );
};
