import type { FunctionComponent } from "preact";
import { Layers } from "lucide-preact";
import type { ProviderConfigId, SystemSettings } from "../../../types.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { SelectInput } from "../settings/SettingsFormFields.js";
import { getProviderTypeLabel } from "../../lib/settings-view-models.js";

export interface OnboardingDefaultsStepProps {
  settings: SystemSettings | null;
  providerInstanceOptions: { value: string; label: string }[];
  workerInstanceOptions: { value: string; label: string }[];
  updateSettings: (recipe: (current: SystemSettings) => SystemSettings) => void;
}

export const OnboardingDefaultsStep: FunctionComponent<OnboardingDefaultsStepProps> = ({
  settings,
  providerInstanceOptions,
  workerInstanceOptions,
  updateSettings,
}) => {
  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <Layers className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Default Configuration</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Select which provider instances handle specific roles when new projects are created.
            </p>
          </div>
        </div>
      </div>

      {providerInstanceOptions.length === 0 ? (
        <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/75 p-6 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]">
          No enabled providers yet. Go back to the Select Providers and Providers steps to enable at least one instance.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Default Primary Provider</div>
              <p className="mb-4 text-xs text-slate-500">The primary intelligence engine for general tasks.</p>
              <SelectInput aria-label="Select input"
                /*label="Primary Provider"*/
                value={settings.defaults.aiProvider.provider || ""}
                onChange={(v) => updateSettings((s) => ({
                  ...s,
                  defaults: { ...s.defaults, aiProvider: { ...s.defaults.aiProvider, provider: v as ProviderConfigId } }
                }))}
                options={providerInstanceOptions}
              />
            </div>

            <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Default CLI Worker Provider</div>
              <p className="mb-4 text-xs text-slate-500">The engine running background CLI tasks (must support tool execution).</p>
              <SelectInput aria-label="Select input"
                /*label="Worker Provider"*/
                value={settings.defaults.workers.virtualWorkerProvider}
                onChange={(v) => updateSettings((s) => ({
                  ...s,
                  defaults: { ...s.defaults, workers: { ...s.defaults.workers, virtualWorkerProvider: v as ProviderConfigId } }
                }))}
                options={workerInstanceOptions}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="px-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Selected Instances Overview</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(settings.integrations.providers)
                .filter(([id, p]) => settings.defaults.aiProvider.providers[id as ProviderConfigId]?.enabled)
                .map(([providerConfigId, provider]) => {
                  const isDefault = settings.defaults.aiProvider.provider === providerConfigId;
                  const isWorker = settings.defaults.workers.virtualWorkerProvider === providerConfigId;

                  return (
                    <div data-onboarding-card key={providerConfigId} className="flex items-center justify-between gap-3 rounded-3xl border border-black/[0.06] bg-white/75 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProviderBrandIcon id={provider.provider} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-900 dark:text-white">{provider.name}</div>
                          <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{getProviderTypeLabel(provider.provider)}</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {isDefault ? (
                          <span className="rounded-full border border-signal-500/25 bg-signal-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-200">Default</span>
                        ) : null}
                        {isWorker ? (
                          <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">Worker</span>
                        ) : null}
                        {!isDefault && !isWorker ? (
                          <span className="rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.04]">Available</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};