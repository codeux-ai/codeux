import type { FunctionComponent } from "preact";
import { FileText } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../../i18n/messages/settings-agents-guidance.js";
import { Row, Toggle } from "../SettingsFormFields.js";
import { SectionCard, getBadge, getFieldBadge } from "./SharedPanelComponents.js";

export interface SettingsAgentAuthoringPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentAuthoringPanel: FunctionComponent<SettingsAgentAuthoringPanelProps> = ({ state }) => {
  const { translate } = useDashboardI18n();
  const { activeScope, editableSettings, projectSources, updateEditableSettings } = state;
  if (!editableSettings) return null;

  const mirrorEnabled = editableSettings.agents.saveToProjectDirectory;

  return (
    <SectionCard
      title={translate(settingsAgentsGuidanceMessages, "mirrorTitle")}
      watermark="AGT"
      badge={getBadge(activeScope, projectSources, "agents")
        ? translate(settingsAgentsGuidanceMessages, "projectOverride")
        : undefined}
      helpId="project-markdown-mirror"
      icon={<FileText strokeWidth={2.4} />}
      accent="sky"
      summary={translate(settingsAgentsGuidanceMessages, "mirrorSummary")}
      configureLabel={translate(settingsAgentsGuidanceMessages, "mirrorConfigure")}
      highlights={[
        { label: translate(settingsAgentsGuidanceMessages, "mirrorHighlight"), value: translate(settingsAgentsGuidanceMessages, mirrorEnabled ? "enabled" : "off"), tone: mirrorEnabled ? "active" : "neutral" },
        { label: translate(settingsAgentsGuidanceMessages, "mirrorDirectory"), value: ".code-ux/agents" },
        { label: translate(settingsAgentsGuidanceMessages, "mirrorScope"), value: translate(settingsAgentsGuidanceMessages, "mirrorProjectAgents") },
      ]}
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
        <div className="min-w-0 rounded-[1.2rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs font-medium leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-slate-400">
          {translate(settingsAgentsGuidanceMessages, "mirrorExplanation")}
        </div>
        <div role="status" className="min-w-0 rounded-[1.2rem] border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-xs font-semibold leading-relaxed text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
          {translate(settingsAgentsGuidanceMessages, mirrorEnabled ? "mirrorEnabledStatus" : "mirrorDisabledStatus")}
        </div>
      </div>
      <Row
        label={translate(settingsAgentsGuidanceMessages, "mirrorSaveLabel")}
        description={translate(settingsAgentsGuidanceMessages, "mirrorSaveDescription")}
        badge={getFieldBadge(activeScope, projectSources, "agents.saveToProjectDirectory")
          ? translate(settingsAgentsGuidanceMessages, "projectOverride")
          : undefined}
      >
        <Toggle
          aria-label={translate(settingsAgentsGuidanceMessages, "mirrorToggleAria")}
          value={mirrorEnabled}
          onChange={() => updateEditableSettings((current) => ({
            ...current,
            agents: {
              ...current.agents,
              saveToProjectDirectory: !current.agents.saveToProjectDirectory,
            },
          }))}
        />
      </Row>
      <Row label={translate(settingsAgentsGuidanceMessages, "mirrorDirectory")} description={translate(settingsAgentsGuidanceMessages, "mirrorDirectoryDescription")} last>
        <div className="min-w-0 break-all rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
          .code-ux/agents
        </div>
      </Row>
    </SectionCard>
  );
};
