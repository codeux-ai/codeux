import type { FunctionComponent } from "preact";
import type { SystemSettings } from "../../../types.js";
import { JiraIcon } from "../icons/JiraIcon.js";
import { TextInput } from "../settings/SettingsFormFields.js";

export interface OnboardingJiraStepProps {
  settings: SystemSettings | null;
  jiraSettings: SystemSettings["integrations"]["jira"];
  updateJira: (updates: Partial<SystemSettings["integrations"]["jira"]>) => void;
}

export const OnboardingJiraStep: FunctionComponent<OnboardingJiraStepProps> = ({
  settings,
  jiraSettings,
  updateJira,
}) => {
  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#0052CC]/18 bg-[#0052CC]/10 text-[#0052CC] dark:border-[#4C9AFF]/18 dark:bg-[#4C9AFF]/10 dark:text-[#4C9AFF]">
            <JiraIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Jira Integration (Optional)</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Link Code UX to your Jira Cloud instance to automatically import sprints and create agent tasks directly from Jira tickets.
            </p>
          </div>
        </div>
      </div>
      <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
        <div className="space-y-4">
          <TextInput
            aria-label="Jira Host"
            value={jiraSettings.host}
            onChange={(v) => updateJira({ host: v })}
            placeholder="e.g. company.atlassian.net"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              aria-label="Email"
              value={jiraSettings.email}
              onChange={(v) => updateJira({ email: v })}
              placeholder="Your Jira email"
            />
            <TextInput
              aria-label="API Token"

              value={jiraSettings.apiToken}
              onChange={(v) => updateJira({ apiToken: v })}
              placeholder="Jira API Token"
            />
          </div>
        </div>
      </div>
    </div>
  );
};