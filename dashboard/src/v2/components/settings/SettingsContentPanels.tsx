import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../hooks/use-settings-page-state.js";
import { SettingsGeneralPanel } from "./panels/SettingsGeneralPanel.js";
import { SettingsAppearancePanel } from "./panels/SettingsAppearancePanel.js";
import { SettingsModelsPanel } from "./panels/SettingsModelsPanel.js";
import { SettingsSprintPanel } from "./panels/SettingsSprintPanel.js";
import { SettingsBrowserPanel } from "./panels/SettingsBrowserPanel.js";
import { SettingsAgentsPanel } from "./panels/SettingsAgentsPanel.js";
import { SettingsMemoryPanel } from "./panels/SettingsMemoryPanel.js";
import { SettingsIntegrationsPanel } from "./panels/SettingsIntegrationsPanel.js";
import { SettingsMcpPanel } from "./panels/SettingsMcpPanel.js";
import { SettingsDangerPanel } from "./panels/SettingsDangerPanel.js";

export const SettingsContentPanels: FunctionComponent<{
  state: SettingsPageState;
}> = ({ state }) => {
  const { activeCategory } = state;

  switch (activeCategory) {
    case "general":
      return <SettingsGeneralPanel state={state} />;
    case "appearance":
      return <SettingsAppearancePanel state={state} />;
    case "models":
      return <SettingsModelsPanel state={state} />;
    case "sprint":
      return <SettingsSprintPanel state={state} />;
    case "browser":
      return <SettingsBrowserPanel state={state} />;
    case "agents":
      return <SettingsAgentsPanel state={state} />;
    case "memory":
      return <SettingsMemoryPanel state={state} />;
    case "integrations":
      return <SettingsIntegrationsPanel state={state} />;
    case "mcp":
      return <SettingsMcpPanel state={state} />;
    case "danger":
      return <SettingsDangerPanel state={state} />;
    default:
      return null;
  }
};
