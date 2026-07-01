import type { FunctionComponent } from "preact";
import { GitBranch, Compass, RefreshCw } from "lucide-preact";
import type { SystemSettings, ProjectSettings } from "../../../types.js";
import { PillChoiceGroup } from "../settings/SettingsFormFields.js";

export interface OnboardingGitStepProps {
  settings: SystemSettings | null;
  gitMode: "local" | "remote";
  updateCliWorkflow: (updates: Partial<ProjectSettings["cliWorkflow"]>) => void;
}

export const OnboardingGitStep: FunctionComponent<OnboardingGitStepProps> = ({
  settings,
  gitMode,
  updateCliWorkflow,
}) => {
  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Workspace Tracking</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Code UX uses Git to track changes made by AI agents. Agents operate in isolated workspaces and their changes are synchronized via Git patch branches.
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label data-onboarding-card className={`relative flex cursor-pointer items-start gap-3 rounded-[2rem] border p-5 shadow-[0_18px_45px_rgba(15,23,42,0.04)] transition-[border-color,background-color] ${gitMode === "local" ? "border-signal-500/30 bg-signal-500/5 dark:bg-signal-500/10" : "border-black/[0.06] bg-white/75 hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.12]"}`}>
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${gitMode === "local" ? "bg-signal-500/15 text-signal-700 dark:text-signal-200" : "bg-black/[0.04] text-slate-500 dark:bg-white/[0.04]"}`}>
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="gitMode"
                value="local"
                checked={gitMode === "local"}
                onChange={() => updateCliWorkflow({ gitMode: "local" })}
                className="sr-only"
              />
              <div className="font-bold text-slate-900 dark:text-white">Local-only Mode</div>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Branch and patch generation happens entirely on your machine.
            </div>
          </div>
        </label>
        <label data-onboarding-card className={`relative flex cursor-pointer items-start gap-3 rounded-[2rem] border p-5 shadow-[0_18px_45px_rgba(15,23,42,0.04)] transition-[border-color,background-color] ${gitMode === "remote" ? "border-signal-500/30 bg-signal-500/5 dark:bg-signal-500/10" : "border-black/[0.06] bg-white/75 hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.12]"}`}>
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${gitMode === "remote" ? "bg-signal-500/15 text-signal-700 dark:text-signal-200" : "bg-black/[0.04] text-slate-500 dark:bg-white/[0.04]"}`}>
            <RefreshCw className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="gitMode"
                value="remote"
                checked={gitMode === "remote"}
                onChange={() => updateCliWorkflow({ gitMode: "remote" })}
                className="sr-only"
              />
              <div className="font-bold text-slate-900 dark:text-white">Remote Sync Mode</div>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Agents push WIP branches to your remote and pull updates automatically.
            </div>
          </div>
        </label>
      </div>

    </div>
  );
};