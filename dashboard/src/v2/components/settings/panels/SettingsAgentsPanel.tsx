import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../../i18n/messages/settings-agents-guidance.js";
import { SettingsAgentAuthoringPanel } from "./SettingsAgentAuthoringPanel.js";
import { SettingsAgentPersistentSkillsPanel } from "./SettingsAgentPersistentSkillsPanel.js";
import { SettingsAgentReflectionPanel } from "./SettingsAgentReflectionPanel.js";
import { SettingsAgentRoutingPanel } from "./SettingsAgentRoutingPanel.js";

export interface SettingsAgentsPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentsPanel: FunctionComponent<SettingsAgentsPanelProps> = ({ state }) => {
  const { translate } = useDashboardI18n();
  if (!state.editableSettings) {
    return null;
  }

  return (
    <section aria-label={translate(settingsAgentsGuidanceMessages, "agentsConfiguration")} className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <SettingsAgentRoutingPanel state={state} />
      <SettingsAgentReflectionPanel state={state} />
      <SettingsAgentPersistentSkillsPanel state={state} />
      <SettingsAgentAuthoringPanel state={state} />
    </section>
  );
};
