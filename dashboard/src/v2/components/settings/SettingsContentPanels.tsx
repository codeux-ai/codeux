import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../hooks/use-settings-page-state.js";
import { SettingsGeneralPanel } from "./panels/SettingsGeneralPanel.js";
import { SettingsAppearancePanel } from "./panels/SettingsAppearancePanel.js";
import { SettingsModelsPanel } from "./panels/SettingsModelsPanel.js";
import { SettingsModelPricingPanel } from "./panels/SettingsModelPricingPanel.js";
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
  let panel = null;

  switch (activeCategory) {
    case "general":
      panel = <SettingsGeneralPanel state={state} />;
      break;
    case "appearance":
      panel = <SettingsAppearancePanel state={state} />;
      break;
    case "models":
      panel = <SettingsModelsPanel state={state} />;
      break;
    case "modelPricing":
      panel = <SettingsModelPricingPanel state={state} />;
      break;
    case "sprint":
      panel = <SettingsSprintPanel state={state} />;
      break;
    case "browser":
      panel = <SettingsBrowserPanel state={state} />;
      break;
    case "agents":
      panel = <SettingsAgentsPanel state={state} />;
      break;
    case "memory":
      panel = <SettingsMemoryPanel state={state} />;
      break;
    case "integrations":
      panel = <SettingsIntegrationsPanel state={state} />;
      break;
    case "mcp":
      panel = <SettingsMcpPanel state={state} />;
      break;
    case "danger":
      panel = <SettingsDangerPanel state={state} />;
      break;
    default:
      return null;
  }

  return <div className="flex min-w-0 flex-col gap-4">{panel}</div>;
};
