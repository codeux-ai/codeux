import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { SettingsAgentAuthoringPanel } from "./SettingsAgentAuthoringPanel.js";
import { SettingsAgentPersistentSkillsPanel } from "./SettingsAgentPersistentSkillsPanel.js";
import { SettingsAgentReflectionPanel } from "./SettingsAgentReflectionPanel.js";
import { SettingsAgentRoutingPanel } from "./SettingsAgentRoutingPanel.js";

export interface SettingsAgentsPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentsPanel: FunctionComponent<SettingsAgentsPanelProps> = ({ state }) => {
  if (!state.editableSettings) {
    return null;
  }

  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <SettingsAgentRoutingPanel state={state} />
      <SettingsAgentReflectionPanel state={state} />
      <SettingsAgentPersistentSkillsPanel state={state} />
      <SettingsAgentAuthoringPanel state={state} />
    </div>
  );
};
