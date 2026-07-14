import type { FunctionComponent } from "preact";
import { AlertTriangle, Check, Download, Loader2, RefreshCw, ShieldAlert, Terminal, X } from "lucide-preact";
import type {
  OnboardingDependencyInstallMode,
  OnboardingDependencyInstallerOption,
  OnboardingDependencyInstallerResult,
  OnboardingRuntimeReadiness,
} from "../../../types.js";
import { useOnboardingMessages, type OnboardingMessageKey } from "../../i18n/messages/onboarding.js";

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
  selectedInstallMode?: OnboardingDependencyInstallMode | null;
  runningInstallMode?: OnboardingDependencyInstallMode | null;
  lastInstallResult?: OnboardingDependencyInstallerResult | null;
  installError?: string | null;
  checkingReadiness?: boolean;
  onAutoInstall?: () => void;
  onInstallMode?: (mode: OnboardingDependencyInstallMode) => void;
  onRecheck?: () => void;
}

const INSTALLER_MODE_LABELS: Record<OnboardingDependencyInstallMode, string> = {
  "docker-desktop-git": "Docker Desktop",
  "docker-engine-git": "Docker Engine",
};

const COMMAND_MESSAGE_LIMIT = 500;

type Translate = (key: OnboardingMessageKey, variables?: Readonly<Record<string, string | number | boolean | bigint | undefined>>) => string;

const platformLabel = (platform: OnboardingDependencyInstallerOption["platform"], t: Translate): string => {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return t("unsupportedPlatform");
};

const automationLabel = (option: OnboardingDependencyInstallerOption, t: Translate): string => {
  if (!option.available || option.automation === "unsupported") return t("unavailable");
  if (option.automation === "automated") return t("automated");
  if (option.automation === "partial") return t("guided");
  return t("manual");
};

const modeLabel = (mode: OnboardingDependencyInstallMode): string => INSTALLER_MODE_LABELS[mode];

const boundCommandMessage = (message: string): string => (
  message.length <= COMMAND_MESSAGE_LIMIT
    ? message
    : `...${message.slice(message.length - COMMAND_MESSAGE_LIMIT)}`
);

const isDockerDependency = (dependencyId: string): boolean => dependencyId === "docker" || dependencyId.startsWith("docker-");

const hasMissingRequiredDependencies = (readiness: OnboardingRuntimeReadiness): boolean => (
  readiness.dependencies.some((dependency) => dependency.required && dependency.status !== "ready")
);

const isDegradedOption = (option: OnboardingDependencyInstallerOption): boolean => (
  option.available && (option.automation === "partial" || option.requiresManualDownload)
);

const optionReason = (option: OnboardingDependencyInstallerOption, t: Translate): string | null => {
  if (!option.available || option.automation === "unsupported") {
    return option.guidance[0] ?? t("installerUnavailable");
  }
  if (isDegradedOption(option)) {
    return option.guidance[0] ?? t("installerPartial");
  }
  if (option.automation === "manual") {
    return option.guidance[0] ?? t("installerManual");
  }
  return null;
};

export const OnboardingInstallationStep: FunctionComponent<OnboardingInstallationStepProps> = ({
  clusterReady,
  readiness,
  osInfo,
  selectedInstallMode = null,
  runningInstallMode = null,
  lastInstallResult = null,
  installError = null,
  checkingReadiness = false,
  onAutoInstall,
  onInstallMode,
  onRecheck,
}) => {
  const { t } = useOnboardingMessages();
  const missingRequired = hasMissingRequiredDependencies(readiness);
  const recommendedOption = readiness.installers.options.find((option) => option.mode === readiness.installers.recommendedMode);
  const canAutoInstall = missingRequired && Boolean(recommendedOption?.available);
  const anyInstallRunning = runningInstallMode !== null;
  const failedCommands = lastInstallResult?.commands.filter((command) => command.status === "failed") ?? [];
  const statusLabel = (status: string): string => {
    if (status === "ready") return t("statusReady");
    if (status === "missing") return t("statusMissing");
    if (status === "warning") return t("statusWarning");
    if (status === "success") return t("statusSuccess");
    if (status === "partial") return t("statusPartial");
    if (status === "failed") return t("statusFailed");
    if (status === "skipped") return t("statusSkipped");
    return status;
  };

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
          <div aria-live="polite">
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
          <div data-onboarding-card key={dep.id} role="status" aria-label={t("dependencyStatus", { dependency: dep.label, status: statusLabel(dep.status) })} className="flex items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/70 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.035)] dark:border-white/[0.06] dark:bg-white/[0.04]">
            <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${dep.status === "ready" ? "bg-signal-500/15 text-signal-600" : "bg-status-amber/15 text-status-amber"}`}>
              {dep.status === "ready" ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <X className="h-3.5 w-3.5" strokeWidth={3} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  {dep.label}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${dep.status === "ready" ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : "bg-status-amber/10 text-status-amber"}`}>
                  {statusLabel(dep.status)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {dep.detail ?? dep.description}
              </div>
              {dep.status !== "ready" ? (
                <div className="mt-3 space-y-2">
                  <div className="rounded-xl bg-black/[0.04] p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
                    {dep.resolution}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isDockerDependency(dep.id) ? (
                      <>
                        <a
                          href={osInfo.dockerDesktopLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                        >
                          {t("installForOs", { os: osInfo.osLabel })}
                        </a>
                        <a
                          href={osInfo.dockerDownloadLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center rounded-xl border border-black/[0.08] bg-white/50 px-3 text-xs font-bold text-slate-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                          {t("engineAlternative")}
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {canAutoInstall ? (
        <section data-onboarding-card aria-labelledby="onboarding-auto-install-title" className="rounded-3xl border border-signal-500/20 bg-signal-500/10 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.055)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h4 id="onboarding-auto-install-title" className="text-sm font-black text-slate-950 dark:text-white">
                {t("autoInstallTitle")}
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {t("autoInstallBody")}
              </p>
            </div>
            <button
              type="button"
              onClick={onAutoInstall}
              disabled={!onAutoInstall || anyInstallRunning}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            >
              {anyInstallRunning ? <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden className="h-4 w-4" />}
              {t("autoInstallDependencies")}
            </button>
          </div>
        </section>
      ) : null}

      {missingRequired && readiness.installers.options.length > 0 ? (
        <section data-onboarding-card aria-labelledby="onboarding-advanced-install-title" className="rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_14px_38px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 id="onboarding-advanced-install-title" className="text-sm font-black text-slate-950 dark:text-white">
                {t("advancedInstallerChoices")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t("advancedInstallerBody")}
              </p>
            </div>
            {onRecheck ? (
              <button
                type="button"
                onClick={onRecheck}
                disabled={checkingReadiness}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200"
              >
                <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checkingReadiness ? "animate-spin motion-reduce:animate-none" : ""}`} />
                {checkingReadiness ? t("checking") : t("recheck")}
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {readiness.installers.options.map((option) => {
              const reason = optionReason(option, t);
              const running = runningInstallMode === option.mode;
              const selected = selectedInstallMode === option.mode;
              const disabled = !option.available || option.automation === "unsupported" || runningInstallMode !== null || !onInstallMode;

              return (
                <article key={option.mode} className={`flex min-h-full flex-col rounded-2xl border p-4 ${selected ? "border-signal-500/40 bg-signal-500/8" : "border-black/[0.06] bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.035]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h5 className="text-sm font-black text-slate-950 dark:text-white">
                        {modeLabel(option.mode)}
                      </h5>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-slate-900/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                          {platformLabel(option.platform, t)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${option.available ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : "bg-status-amber/10 text-status-amber"}`}>
                          {automationLabel(option, t)}
                        </span>
                        {option.recommended ? (
                          <span className="rounded-full bg-signal-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
                            {t("recommended")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isDegradedOption(option) ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-amber" aria-label={t("guidedMode")} />
                    ) : option.requiresPrivilege ? (
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-amber" aria-label={t("requiresPrivilege")} />
                    ) : null}
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {option.description}
                  </p>
                  {reason ? (
                    <p className={`mt-3 rounded-xl p-3 text-xs leading-relaxed ${option.available ? "bg-status-amber/10 text-status-amber" : "bg-black/[0.04] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400"}`}>
                      {reason}
                    </p>
                  ) : null}
                  {(option.requiresPrivilege || option.requiresManualDownload) ? (
                    <div className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {option.requiresPrivilege ? (
                        <div className="flex gap-2">
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-amber" />
                          <span>{t("privilegeWarning")}</span>
                        </div>
                      ) : null}
                      {option.requiresManualDownload ? (
                        <div className="flex gap-2">
                          <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-amber" />
                          <span>{t("manualDownloadWarning")}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {option.guidance.length > 1 ? (
                    <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {option.guidance.slice(1).map((guidance) => (
                        <li key={guidance}>{guidance}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-auto pt-4">
                    <button
                      type="button"
                      onClick={() => onInstallMode?.(option.mode)}
                      disabled={disabled}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      {running ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Terminal aria-hidden className="h-3.5 w-3.5" />}
                      {running ? t("installing") : option.available ? t("useInstaller", { installer: modeLabel(option.mode) }) : t("manualSetupRequired")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {runningInstallMode ? (
        <div role="status" aria-live="polite" className="rounded-2xl border border-signal-500/20 bg-signal-500/10 p-4 text-sm text-signal-700 dark:text-signal-200">
          <div className="flex items-center gap-2 font-black">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {t("installingMode", { installer: modeLabel(runningInstallMode) })}
          </div>
          <p className="mt-1.5 leading-relaxed">
            {t("installingBody")}
          </p>
        </div>
      ) : null}

      {installError ? (
        <div role="status" aria-live="polite" className="rounded-2xl border border-status-red/20 bg-status-red/10 p-4 text-sm text-status-red">
          <div className="font-black">{t("installIncomplete")}</div>
          <p className="mt-1.5 leading-relaxed">{installError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {lastInstallResult && onInstallMode ? (
              <button
                type="button"
                onClick={() => onInstallMode(lastInstallResult.mode)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-status-red/25 px-3 text-xs font-black uppercase tracking-[0.12em] focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/40"
              >
                {t("retryInstaller", { installer: modeLabel(lastInstallResult.mode) })}
              </button>
            ) : null}
            {onRecheck ? (
              <button
                type="button"
                onClick={onRecheck}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-status-red/25 px-3 text-xs font-black uppercase tracking-[0.12em] focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/40"
              >
                {t("recheckReadiness")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {lastInstallResult ? (
        <section role="status" aria-live="polite" aria-labelledby="onboarding-install-result-title" className="rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_14px_38px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 id="onboarding-install-result-title" className="text-sm font-black text-slate-950 dark:text-white">
                {t("latestInstallResult")}
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {lastInstallResult.message}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${lastInstallResult.status === "success" ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : "bg-status-amber/10 text-status-amber"}`}>
              {statusLabel(lastInstallResult.status)}
            </span>
          </div>

          {(lastInstallResult.requiresPrivilege || lastInstallResult.requiresManualDownload) ? (
            <div className="mt-4 grid gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300 sm:grid-cols-2">
              {lastInstallResult.requiresPrivilege ? (
                <div className="rounded-xl bg-status-amber/10 p-3 text-status-amber">
                  {t("privilegeResult")}
                </div>
              ) : null}
              {lastInstallResult.requiresManualDownload ? (
                <div className="rounded-xl bg-status-amber/10 p-3 text-status-amber">
                  {t("manualDownloadResult")}
                </div>
              ) : null}
            </div>
          ) : null}

          {lastInstallResult.skippedDependencyGroups.length > 0 ? (
            <div className="mt-4 rounded-2xl bg-black/[0.04] p-4 dark:bg-white/[0.05]">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("skippedGroups")}
              </div>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {lastInstallResult.skippedDependencyGroups.map((group) => (
                  <li key={group.groupId}>
                    {group.label}: {group.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {failedCommands.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-status-red/20 bg-status-red/10 p-4 text-status-red">
              <div className="text-xs font-black uppercase tracking-[0.14em]">
                {t("failedCommands")}
              </div>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed">
                {failedCommands.map((command) => (
                  <li key={command.id}>
                    <div className="font-mono">{command.displayCommand}</div>
                    {command.stderrSummary ? <div>stderr: {command.stderrSummary}</div> : null}
                    {command.stdoutSummary ? <div>stdout: {command.stdoutSummary}</div> : null}
                    {command.message ? <div>{boundCommandMessage(command.message)}</div> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {lastInstallResult.postInstallGuidance.length > 0 ? (
            <div className="mt-4 rounded-2xl bg-sky-500/10 p-4 text-sky-700 dark:text-sky-300">
              <div className="text-xs font-black uppercase tracking-[0.14em]">
                {t("nextSteps")}
              </div>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed">
                {lastInstallResult.postInstallGuidance.map((guidance) => (
                  <li key={guidance}>{guidance}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {onRecheck ? (
              <button
                type="button"
                onClick={onRecheck}
                disabled={checkingReadiness}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-black uppercase tracking-[0.12em] text-white disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:bg-white dark:text-slate-950"
              >
                <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checkingReadiness ? "animate-spin motion-reduce:animate-none" : ""}`} />
                {t("recheckReadiness")}
              </button>
            ) : null}
            {lastInstallResult.status !== "success" && onInstallMode ? (
              <button
                type="button"
                onClick={() => onInstallMode(lastInstallResult.mode)}
                disabled={anyInstallRunning}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200"
              >
                {t("retryInstaller", { installer: modeLabel(lastInstallResult.mode) })}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {!missingRequired ? (
        <div role="status" aria-live="polite" className="rounded-2xl border border-signal-500/20 bg-signal-500/8 p-4 text-sm leading-relaxed text-signal-700 dark:text-signal-200">
          {t("readinessComplete")}
          {onRecheck ? (
            <button
              type="button"
              onClick={onRecheck}
              disabled={checkingReadiness}
              className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-signal-500/20 px-3 text-xs font-black uppercase tracking-[0.12em] disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
            >
              <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checkingReadiness ? "animate-spin motion-reduce:animate-none" : ""}`} />
              {t("recheck")}
            </button>
          ) : null}
        </div>
      ) : null}

    </div>
  );
};
