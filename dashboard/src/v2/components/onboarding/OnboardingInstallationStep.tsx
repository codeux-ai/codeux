import type { FunctionComponent } from "preact";
import { Check, X, Info } from "lucide-preact";
import type { OnboardingRuntimeReadiness } from "../../../types.js";

export interface OnboardingInstallationStepProps {
  clusterReady: boolean;
  readiness: OnboardingRuntimeReadiness;
  osInfo: {
    osLabel: string;
    dockerDesktopLink: string;
    dockerDownloadLink: string;
    gitLink: string;
    gitInstruction: string;
  };
}

export const OnboardingInstallationStep: FunctionComponent<OnboardingInstallationStepProps> = ({
  clusterReady,
  readiness,
  osInfo,
}) => {
  return (
    <div className="space-y-5">
      <div data-onboarding-card className={`relative overflow-hidden rounded-3xl border p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)] ${clusterReady ? "border-signal-500/20 bg-signal-500/8" : "border-status-amber/25 bg-status-amber/10"}`}>
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${clusterReady ? "bg-signal-500/12 text-signal-600" : "bg-status-amber/15 text-status-amber"}`}>
            {clusterReady ? (
              <Check className="h-6 w-6" strokeWidth={2.5} />
            ) : (
              <X className="h-6 w-6" strokeWidth={2.5} />
            )}
          </div>
          <div>
            <h3 className={`text-base font-black ${clusterReady ? "text-signal-700 dark:text-signal-200" : "text-status-amber"}`}>
              {readiness.cluster.label}
            </h3>
            <p className={`mt-1.5 text-sm leading-relaxed ${clusterReady ? "text-signal-600/80 dark:text-signal-300/80" : "text-status-amber/80"}`}>
              {readiness.cluster.detail}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {readiness.dependencies.map((dep) => (
          <div data-onboarding-card key={dep.id} className="flex items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/70 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.035)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${dep.status === "ready" ? "bg-signal-500/15 text-signal-600" : "bg-status-amber/15 text-status-amber"}`}>
              {dep.status === "ready" ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <X className="h-3.5 w-3.5" strokeWidth={3} />
              )}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {dep.label}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {dep.detail}
              </div>
              {dep.status !== "ready" ? (
                <div className="mt-3 flex gap-2">
                  <a
                    href={dep.id === "docker" ? osInfo.dockerDesktopLink : osInfo.gitLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  >
                    Install for {osInfo.osLabel}
                  </a>
                  {dep.id === "docker" ? (
                    <a
                      href={osInfo.dockerDownloadLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center justify-center rounded-xl border border-black/[0.08] bg-white/50 px-3 text-xs font-bold text-slate-700 hover:bg-white dark:border-white/[0.08] dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                      Engine alternative
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div data-onboarding-card className="flex items-start gap-3 rounded-2xl bg-sky-500/10 p-4 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-sm leading-relaxed">
          Need a hosted solution without local dependencies?{" "}
          <a href="https://codeux.ai/cloud" target="_blank" rel="noreferrer" className="font-bold underline decoration-sky-500/30 underline-offset-4 hover:decoration-sky-500">
            Learn more about Code UX Cloud
          </a>
        </div>
      </div>
    </div>
  );
};