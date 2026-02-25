import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { DashboardSettings, SkillToggle } from "../types.js";

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

const automationOptions: Array<{ value: DashboardSettings["automationLevel"]; label: string }> = [
  { value: "FULL", label: "Full" },
  { value: "SEMI_AUTO", label: "Semi Auto" },
  { value: "ALWAYS_ASK", label: "Always Ask" },
];

const loopStepOptions: Array<{ key: keyof DashboardSettings["sprintLoopSteps"]; label: string; detail: string }> = [
  { key: "branchPreflight", label: "Branch Preflight", detail: "Validate local/remote sprint branch before orchestration." },
  { key: "planningPreflight", label: "Planning Preflight", detail: "Block status/orchestration when no sprint subtasks exist." },
  { key: "loadSubtasks", label: "Load Subtasks", detail: "Read sprint subtask markdown files from disk." },
  { key: "sessionSync", label: "Session Sync", detail: "Pull existing Jules sessions and attach IDs/activities." },
  { key: "statusDerivation", label: "Status Derivation", detail: "Calculate PENDING/RUNNING/BLOCKED/COMPLETED/FAILED." },
  { key: "startReadyTasks", label: "Start Ready Tasks", detail: "Create new Jules sessions for ready independent tasks." },
  { key: "mergeProtocol", label: "Merge Protocol", detail: "Emit merge instructions for completed but unmerged tasks." },
  { key: "actionRequiredProtocol", label: "Action Required Protocol", detail: "Emit instructions for paused/approval feedback states." },
  { key: "statusTable", label: "Status Table", detail: "Render the task status table in reports." },
  { key: "watchLoop", label: "Watch Loop", detail: "Allow long-running orchestration watch mode." },
];

const updateSkill = (skills: SkillToggle[], index: number, enabled: boolean): SkillToggle[] => {
  return skills.map((skill, currentIndex) => (currentIndex === index ? { ...skill, enabled } : skill));
};

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
  const [internalSkillsUnlocked, setInternalSkillsUnlocked] = useState<boolean>(false);

  const handleUnlockInternalSkills = (): void => {
    const confirmed = window.confirm(
      "Warning: Disabling internal MCP skills can break orchestration and task execution. Continue and unlock internal skill editing?"
    );
    if (confirmed) {
      setInternalSkillsUnlocked(true);
    }
  };

  const handleSkillToggle = (skill: SkillToggle, index: number, enabled: boolean): void => {
    if (skill.isInternal && !internalSkillsUnlocked) {
      return;
    }
    if (skill.isInternal) {
      const confirmed = window.confirm(
        "You are changing an internal skill. This may break core MCP behavior. Do you want to continue?"
      );
      if (!confirmed) {
        return;
      }
    }
    if (skill.name === "git_manager_remote" || skill.name === "git_manager_local") {
      const nextMode = skill.name === "git_manager_remote" ? "REMOTE" : "LOCAL";
      onChange({
        ...settings,
        git: {
          ...settings.git,
          githubMode: nextMode,
        },
        skills: settings.skills.map((entry) => {
          if (entry.name === "git_manager_remote") return { ...entry, enabled: nextMode === "REMOTE" };
          if (entry.name === "git_manager_local") return { ...entry, enabled: nextMode === "LOCAL" };
          if (entry.name === "git_manager") return { ...entry, enabled: true };
          return entry;
        }),
      });
      return;
    }

    onChange({
      ...settings,
      skills: updateSkill(settings.skills, index, enabled),
    });
  };

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
        <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Basic Settings</h3>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">Automation Level</span>
            <select
              value={settings.automationLevel}
              onChange={(event) =>
                onChange({
                  ...settings,
                  automationLevel: event.currentTarget.value as DashboardSettings["automationLevel"],
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            >
              {automationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">AI Provider</h3>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">Provider</span>
            <select
              value={settings.aiProvider.provider}
              disabled
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            >
              <option value="jules">Jules</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">Jules API Key</span>
            <input
              type="password"
              value={settings.aiProvider.julesApiKey}
              onInput={(event) =>
                onChange({
                  ...settings,
                  aiProvider: {
                    ...settings.aiProvider,
                    julesApiKey: event.currentTarget.value,
                  },
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              placeholder="AIza..."
            />
          </label>
        </article>

        <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Git Settings</h3>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">GitHub Mode</span>
            <select
              value={settings.git.githubMode}
              onChange={(event) =>
                onChange((() => {
                  const nextMode = event.currentTarget.value as DashboardSettings["git"]["githubMode"];
                  return {
                    ...settings,
                    git: {
                      ...settings.git,
                      githubMode: nextMode,
                    },
                    skills: settings.skills.map((skill) => {
                      if (skill.name === "git_manager_remote") return { ...skill, enabled: nextMode === "REMOTE" };
                      if (skill.name === "git_manager_local") return { ...skill, enabled: nextMode === "LOCAL" };
                      if (skill.name === "git_manager") return { ...skill, enabled: true };
                      return skill;
                    }),
                  };
                })())
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            >
              <option value="REMOTE">Remote (GitHub CLI)</option>
              <option value="LOCAL">Local (Git Commands)</option>
            </select>
            <p className="text-[11px] text-slate-500">
              Exactly one Git Manager skillset is active based on mode: remote enables <code>git_manager_remote</code>, local enables <code>git_manager_local</code>.
            </p>
          </label>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">Default Branch</span>
            <input
              type="text"
              value={settings.git.defaultBranch}
              onInput={(event) =>
                onChange({
                  ...settings,
                  git: {
                    ...settings.git,
                    defaultBranch: event.currentTarget.value,
                  },
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              placeholder="main"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">Feature Branch Prefix</span>
            <input
              type="text"
              value={settings.git.featureBranchPrefix}
              onInput={(event) =>
                onChange({
                  ...settings,
                  git: {
                    ...settings.git,
                    featureBranchPrefix: event.currentTarget.value,
                  },
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              placeholder="feature/"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">Sprint Branch Scheme</span>
            <input
              type="text"
              value={settings.git.sprintBranchScheme}
              onInput={(event) =>
                onChange({
                  ...settings,
                  git: {
                    ...settings.git,
                    sprintBranchScheme: event.currentTarget.value,
                  },
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              placeholder="feature/sprint{sprint}-implementation"
            />
            <p className="text-[11px] text-slate-500">Use {"{sprint}"} or {"{n}"} as placeholder, e.g. <code>feature/sprint{"{sprint}"}-implementation</code>.</p>
          </label>
          <label className="block space-y-2">
            <span className="text-xs text-slate-400">GitHub Token</span>
            <input
              type="password"
              value={settings.git.githubToken}
              onInput={(event) =>
                onChange({
                  ...settings,
                  git: {
                    ...settings.git,
                    githubToken: event.currentTarget.value,
                  },
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              placeholder="ghp_..."
            />
            <p className="text-[11px] text-slate-500">Priority: UI value first. If empty, fallback to env/settings.json/system auth.</p>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={settings.git.autoCreatePr}
              onChange={(event) =>
                onChange({
                  ...settings,
                  git: {
                    ...settings.git,
                    autoCreatePr: event.currentTarget.checked,
                  },
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
            />
            Auto create PR when available
          </label>
        </article>

        <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">CI Intelligence</h3>
          <p className="text-xs text-slate-500">
            Controls protocol checks generated by the sprint loop for feature branch and main branch merge stages.
          </p>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
            <span className="text-sm text-slate-200">Enable CI Intelligence</span>
            <input
              type="checkbox"
              checked={settings.ciIntelligence.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  ciIntelligence: {
                    ...settings.ciIntelligence,
                    enabled: event.currentTarget.checked,
                  },
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
            <span className="text-sm text-slate-200">Wait for CI before merge into main</span>
            <input
              type="checkbox"
              checked={settings.ciIntelligence.waitForCiBeforeMainMerge}
              disabled={!settings.ciIntelligence.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  ciIntelligence: {
                    ...settings.ciIntelligence,
                    waitForCiBeforeMainMerge: event.currentTarget.checked,
                  },
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 disabled:opacity-50"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
            <span className="text-sm text-slate-200">Resolve all comments before merge into main</span>
            <input
              type="checkbox"
              checked={settings.ciIntelligence.resolveAllCommentsBeforeMainMerge}
              disabled={!settings.ciIntelligence.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  ciIntelligence: {
                    ...settings.ciIntelligence,
                    resolveAllCommentsBeforeMainMerge: event.currentTarget.checked,
                  },
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 disabled:opacity-50"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
            <span className="text-sm text-slate-200">Wait for CI before merge into feature branch</span>
            <input
              type="checkbox"
              checked={settings.ciIntelligence.waitForCiBeforeFeatureMerge}
              disabled={!settings.ciIntelligence.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  ciIntelligence: {
                    ...settings.ciIntelligence,
                    waitForCiBeforeFeatureMerge: event.currentTarget.checked,
                  },
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 disabled:opacity-50"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
            <span className="text-sm text-slate-200">Resolve all comments before merge into feature branch</span>
            <input
              type="checkbox"
              checked={settings.ciIntelligence.resolveAllCommentsBeforeFeatureMerge}
              disabled={!settings.ciIntelligence.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  ciIntelligence: {
                    ...settings.ciIntelligence,
                    resolveAllCommentsBeforeFeatureMerge: event.currentTarget.checked,
                  },
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 disabled:opacity-50"
            />
          </label>
        </article>

        <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Sprint Loop Steps</h3>
          <p className="text-xs text-slate-500">
            Every sprint loop step is independently toggleable for custom orchestration flows.
          </p>
          <div className="space-y-2">
            {loopStepOptions.map((step) => (
              <label key={step.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
                <span className="text-sm text-slate-200">
                  {step.label}
                  <span className="block text-[11px] text-slate-500">{step.detail}</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.sprintLoopSteps[step.key]}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      sprintLoopSteps: {
                        ...settings.sprintLoopSteps,
                        [step.key]: event.currentTarget.checked,
                      },
                    })
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
              </label>
            ))}
          </div>
        </article>

        <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Skills</h3>
          {!internalSkillsUnlocked && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-200">
                Internal skills are protected. Disabling them can break orchestration, task execution, and automation flows.
              </p>
              <button
                type="button"
                onClick={handleUnlockInternalSkills}
                className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors"
              >
                Unlock Internal Skills
              </button>
            </div>
          )}
          <div className="space-y-3">
            {settings.skills.length === 0 ? (
              <p className="text-sm text-slate-500">No skills configured.</p>
            ) : (
              settings.skills.map((skill, index) => (
                <label
                  key={skill.name}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    skill.isInternal && !internalSkillsUnlocked
                      ? "border-slate-700/50 bg-slate-950/30 opacity-70"
                      : "border-slate-700/70 bg-slate-950/50"
                  }`}
                >
                  <span className="text-sm text-slate-200">
                    {skill.name}
                    {skill.isInternal ? " (internal)" : " (custom)"}
                  </span>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    disabled={skill.name === "git_manager" || (skill.isInternal && !internalSkillsUnlocked)}
                    onChange={(event) => handleSkillToggle(skill, index, event.currentTarget.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                  />
                </label>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
};
