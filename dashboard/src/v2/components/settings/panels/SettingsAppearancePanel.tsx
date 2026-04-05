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
    </Card>
  );
};
