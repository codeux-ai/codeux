import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../types.js";
import { AiProviderSection } from "./settings/AiProviderSection.js";
import { BasicSettingsSection } from "./settings/BasicSettingsSection.js";
import { CiIntelligenceSection } from "./settings/CiIntelligenceSection.js";
import { CliWorkflowSection } from "./settings/CliWorkflowSection.js";
import { GitSettingsSection } from "./settings/GitSettingsSection.js";
import { McpToolsSection } from "./settings/McpToolsSection.js";
import { SkillsSection } from "./settings/SkillsSection.js";
import { SprintLoopSection } from "./settings/SprintLoopSection.js";

interface SettingsPageProps {
  settings: DashboardSettings;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveMessage: string | null;
  onChange: (next: DashboardSettings) => void;
  onSave: () => Promise<void>;
  onImportMissing: () => Promise<void>;
}

export const SettingsPage: FunctionComponent<SettingsPageProps> = ({
  settings,
  isLoading,
  isSaving,
  error,
  saveMessage,
  onChange,
  onSave,
  onImportMissing,
}) => {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLoading || isSaving}
            onClick={() => void onImportMissing()}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Import Missing (.env/.json)
          </button>
          <button
            type="button"
            disabled={isLoading || isSaving}
            onClick={() => void onSave()}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {saveMessage && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{saveMessage}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BasicSettingsSection settings={settings} onChange={onChange} />
        <AiProviderSection settings={settings} onChange={onChange} />
        <GitSettingsSection settings={settings} onChange={onChange} />
        <CiIntelligenceSection settings={settings} onChange={onChange} />
        <SprintLoopSection settings={settings} onChange={onChange} />
        <CliWorkflowSection settings={settings} onChange={onChange} />
        <McpToolsSection settings={settings} onChange={onChange} />
        <SkillsSection settings={settings} onChange={onChange} />
      </div>
    </section>
  );
};
