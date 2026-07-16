import type { FunctionComponent } from "preact";
import { GitBranch } from "lucide-preact";
import type { SystemSettings, ProjectSettings } from "../../../types.js";
import { Github } from "../icons/GitHostIcons.js";
import { PillChoiceGroup } from "../settings/SettingsFormFields.js";
import { useOnboardingMessages } from "../../i18n/messages/onboarding.js";

export interface OnboardingGitStepProps {
  settings: SystemSettings | null;
  gitMode: "local" | "remote";
  updateCliWorkflow: (updates: Partial<ProjectSettings["cliWorkflow"]>) => void;
  easy?: boolean;
  useGithub?: boolean;
  manageGithubPrWorkflow?: boolean;
  onEasyGithubChange?: (updates: { useGithub?: boolean; manageGithubPrWorkflow?: boolean }) => void;
}

export const OnboardingGitStep: FunctionComponent<OnboardingGitStepProps> = ({
  settings,
  gitMode,
  updateCliWorkflow,
  easy = false,
  useGithub = true,
  manageGithubPrWorkflow = true,
  onEasyGithubChange,
}) => {
  const { t } = useOnboardingMessages();
  if (!settings) return null;

  if (easy) {
    return (
      <div className="space-y-4">
        <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
          <div className="flex items-start gap-3">
            <Github className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
            <div>
              <div className="text-base font-black text-slate-900 dark:text-white">{t("gitHubWorkflow")}</div>
              <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {t("easyGitBody")}
              </div>
            </div>
          </div>
        </div>
        <div data-onboarding-card className="space-y-3 rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/75 p-4 text-left dark:border-white/[0.06] dark:bg-white/[0.04]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-signal-600 focus:ring-2 focus:ring-signal-500"
              checked={useGithub}
              onChange={(event) => onEasyGithubChange?.({
                useGithub: event.currentTarget.checked,
                manageGithubPrWorkflow: event.currentTarget.checked ? manageGithubPrWorkflow : false,
              })}
            />
            <span>
              <span className="block text-sm font-bold text-slate-900 dark:text-white">{t("useGithubWorkspace")}</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("useGithubBody")}</span>
            </span>
          </label>
          <label className={`flex items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/75 p-4 text-left dark:border-white/[0.06] dark:bg-white/[0.04] ${useGithub ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-signal-600 focus:ring-2 focus:ring-signal-500 disabled:cursor-not-allowed"
              checked={useGithub && manageGithubPrWorkflow}
              disabled={!useGithub}
              onChange={(event) => onEasyGithubChange?.({
                useGithub,
                manageGithubPrWorkflow: event.currentTarget.checked,
              })}
            />
            <span>
              <span className="block text-sm font-bold text-slate-900 dark:text-white">{t("manageGithubDefaults")}</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("manageGithubDefaultsBody")}</span>
            </span>
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-black text-slate-900 dark:text-white">{t("gitMode")}</div>
            <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {t("gitModeBody")}
            </div>
            <div className="mt-4">
              <PillChoiceGroup
                aria-label={t("gitMode")}
                value={gitMode}
                onChange={(value) => updateCliWorkflow({ gitMode: value as "local" | "remote" })}
                options={[
                  { value: "remote", label: t("remoteBranchGeneration"), hint: t("remoteHint") },
                  { value: "local", label: t("localBranchGeneration"), hint: t("localHint") },
                ]}
                valid
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
