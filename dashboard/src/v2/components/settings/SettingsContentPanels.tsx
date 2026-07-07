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
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { SettingsActivePanelStatus } from "./SettingsActivePanelStatus.js";

export const SettingsContentPanels: FunctionComponent<{
  state: SettingsPageState;
  stickyTop?: string;
  showActivePanelStatus?: boolean;
}> = ({ state, stickyTop = "9.5rem", showActivePanelStatus = true }) => {
  const { activeCategory, activeDirty, activeSaving, error, saveMessage, loading, resettingProject } = state;
  const tokens = useInteractionTokens();

  const renderPanel = () => {
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

  return (
    <div aria-busy={activeSaving || loading || resettingProject ? "true" : undefined} data-reset-busy={resettingProject ? "true" : undefined} data-settings-state={error ? "error" : resettingProject ? "resetting" : activeSaving ? "saving" : activeDirty ? "dirty" : "saved"}>
      {showActivePanelStatus ? <SettingsActivePanelStatus state={state} stickyTop={stickyTop} /> : null}
      <ActionFeedbackRegion
        status={error ? "error" : loading || activeSaving || resettingProject ? "pending" : saveMessage ? "success" : activeDirty ? "warning" : "idle"}
        message={error || (loading ? "Loading settings without clearing current values..." : resettingProject ? "Resetting project overrides. Current values remain visible." : activeSaving ? "Saving settings. Current values remain visible." : saveMessage || (activeDirty ? "You have unsaved changes in this settings scope." : null))}
        autoDismiss={false}
      />
      <div
        key={activeCategory}
        data-active-category={activeCategory}
        data-motion-contract="enterExit"
        className="mt-3 motion-safe:animate-form-slide-down motion-reduce:animate-none"
        style={{
          transitionDuration: tokens.enterExit.duration,
          transitionTimingFunction: tokens.enterExit.ease,
        }}
      >
        {renderPanel()}
      </div>
    </div>
  );
};
