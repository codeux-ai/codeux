import type { FunctionComponent } from "preact";
import { GitBranch } from "lucide-preact";
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
            <div className="text-base font-black text-slate-900 dark:text-white">Git mode</div>
            <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Remote mode keeps pull requests and CI automation available. Local mode stays repo-local for offline or self-managed workflows.
            </div>
            <div className="mt-4">
              <PillChoiceGroup
                value={gitMode}
                onChange={(value) => updateCliWorkflow({ gitMode: value as "local" | "remote" })}
                options={[
                  { value: "remote", label: "Remote branch generation" },
                  { value: "local", label: "Local branch generation" },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
