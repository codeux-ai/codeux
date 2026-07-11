import type { FunctionComponent } from "preact";
import { FileText } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { Row, Toggle } from "../SettingsFormFields.js";
import { SectionCard, getBadge, getFieldBadge } from "./SharedPanelComponents.js";

export interface SettingsAgentAuthoringPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentAuthoringPanel: FunctionComponent<SettingsAgentAuthoringPanelProps> = ({ state }) => {
  const { activeScope, editableSettings, projectSources, updateEditableSettings } = state;
  if (!editableSettings) return null;

  const mirrorEnabled = editableSettings.agents.saveToProjectDirectory;

  return (
    <SectionCard
      title="Project Markdown Mirror"
      watermark="AGT"
      badge={getBadge(activeScope, projectSources, "agents")}
      icon={<FileText strokeWidth={2.4} />}
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
        <div className="min-w-0 rounded-[1.2rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs font-medium leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-slate-400">
          Mirror project-authored agents into `.code-ux/agents` when instructions should move through normal repository review. The dashboard keeps built-in and home agents separate from this project mirror.
        </div>
        <div role="status" className="min-w-0 rounded-[1.2rem] border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-xs font-semibold leading-relaxed text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
          {mirrorEnabled ? "Mirror enabled for dashboard-authored project agents." : "Mirror disabled; project agents stay database-backed only."}
        </div>
      </div>
      <Row
        label="Save agent markdown to project directory"
        description="When enabled, dashboard edits write a companion markdown file under `.code-ux/agents` for the selected project. Default and home agent files are never modified."
        badge={getFieldBadge(activeScope, projectSources, "agents.saveToProjectDirectory")}
      >
        <Toggle
          aria-label="Toggle setting"
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
      <Row label="Mirror directory" description="Dashboard-authored markdown companions live alongside other project-local Code UX files." last>
        <div className="min-w-0 break-all rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
          .code-ux/agents
        </div>
      </Row>
    </SectionCard>
  );
};
