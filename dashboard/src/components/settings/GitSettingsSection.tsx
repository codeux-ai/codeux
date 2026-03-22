import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import { updateGitHubMode, updateGitSettings } from "../../lib/settings-updaters.js";
import { FieldLabel, SettingsCard, ToggleRow } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";
import { AvantgardeSelect } from "../../v2/components/ui/AvantgardeSelect.js";

const githubModeOptions = [
  { value: "REMOTE", label: "Remote (GitHub CLI)" },
  { value: "LOCAL", label: "Local (Git Commands)" },
];

export const GitSettingsSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard title="Git Settings">
    <label className="block space-y-2">
      <FieldLabel>GitHub Mode</FieldLabel>
      <AvantgardeSelect
        value={settings.git.githubMode}
        onChange={(val) => {
          const nextMode = val as DashboardSettings["git"]["githubMode"];
          onChange(updateGitHubMode(settings, nextMode));
        }}
        options={githubModeOptions}
      />
      <p className="text-[11px] text-slate-500">
        Exactly one Git Manager skillset is active based on mode: remote enables <code>git_manager_remote</code>, local enables <code>git_manager_local</code>.
      </p>
    </label>
    <label className="block space-y-2">
      <FieldLabel>Default Branch</FieldLabel>
      <input
        type="text"
        value={settings.git.defaultBranch}
        onInput={(event) =>
          onChange(updateGitSettings(settings, {
            defaultBranch: event.currentTarget.value,
          }))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
        placeholder="main"
      />
    </label>
    <label className="block space-y-2">
      <FieldLabel>Feature Branch Prefix</FieldLabel>
      <input
        type="text"
        value={settings.git.featureBranchPrefix}
        onInput={(event) =>
          onChange(updateGitSettings(settings, {
            featureBranchPrefix: event.currentTarget.value,
          }))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
        placeholder="feature/"
      />
    </label>
    <label className="block space-y-2">
      <FieldLabel>Sprint Branch Scheme</FieldLabel>
      <input
        type="text"
        value={settings.git.sprintBranchScheme}
        onInput={(event) =>
          onChange(updateGitSettings(settings, {
            sprintBranchScheme: event.currentTarget.value,
          }))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
        placeholder="feature/sprint{sprint}-implementation"
      />
      <p className="text-[11px] text-slate-500">Use {"{sprint}"} or {"{n}"} as placeholder, e.g. <code>feature/sprint{"{sprint}"}-implementation</code>.</p>
    </label>
    <label className="block space-y-2">
      <FieldLabel>GitHub Token</FieldLabel>
      <input
        type="password"
        value={settings.git.githubToken}
        onInput={(event) =>
          onChange(updateGitSettings(settings, {
            githubToken: event.currentTarget.value,
          }))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
        placeholder="ghp_..."
      />
      <p className="text-[11px] text-slate-500">Priority: UI value first. If empty, fallback to env/settings.json/system auth.</p>
    </label>
    <ToggleRow
      label="Auto create PR when available"
      checked={settings.git.autoCreatePr}
      onToggle={(checked) =>
        onChange(updateGitSettings(settings, {
          autoCreatePr: checked,
        }))
      }
    />
  </SettingsCard>
);
