import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { PillChoiceGroup } from "../SettingsFormFields.js";
import { Card, SectionCard, Row, getFieldBadge } from "./SharedPanelComponents.js";

export const SettingsAppearancePanel: FunctionComponent<{
  state: SettingsPageState;
}> = ({ state }) => {
  const settings = state.editableSettings;
  if (!settings) {
    return null;
  }

  const { activeScope, projectSources } = state;
  const appearance = settings.appearance;

  return (
    <Card
      title="Appearance"
      description="Customize the dashboard layout, theme, and motion preferences."
    >
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
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  theme: val as "LIGHT" | "DARK" | "SYSTEM",
                },
              }));
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
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  reducedMotion: val as "AUTO" | "REDUCE" | "NONE",
                },
              }));
            }}
            options={[
              { value: "AUTO", label: "Auto" },
              { value: "REDUCE", label: "Reduce" },
              { value: "NONE", label: "None" },
            ]}
          />
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
    </Card>
  );
};
