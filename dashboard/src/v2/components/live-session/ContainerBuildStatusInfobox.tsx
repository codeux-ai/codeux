import type { FunctionComponent } from "preact";
import { AlertTriangle, CheckCircle2, Layers, RefreshCw } from "lucide-preact";

import type { ContainerBuildProgress } from "../../../lib/activity.js";
import { useLiveI18n, type LiveMessageKey } from "../../i18n/messages/live.js";

const BUILDING_KINDS = new Set<ContainerBuildProgress["kind"]>([
  "cache_miss",
  "lock_wait",
  "build_start",
  "build_step",
]);

const getStatusCopy = (progress: ContainerBuildProgress): {
  titleKey: LiveMessageKey;
  tone: string;
  icon: "building" | "success" | "fallback";
  role: "status" | "alert";
} => {
  if (progress.kind === "build_success") {
    return {
      titleKey: "containerCached",
      tone: "border-status-green/20 bg-status-green/10 text-status-green",
      icon: "success",
      role: "status",
    };
  }
  if (progress.kind === "build_failure_fallback") {
    return {
      titleKey: "containerFallback",
      tone: "border-status-amber/25 bg-status-amber/10 text-status-amber",
      icon: "fallback",
      role: "alert",
    };
  }
  return {
    titleKey: progress.kind === "lock_wait" ? "waitingContainerBuild" : "buildingContainer",
    tone: "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300",
    icon: "building",
    role: "status",
  };
};

const getImageLabel = (progress: ContainerBuildProgress, setupCacheImage: string, loginBaseImage: string): string => {
  const role = progress.imageRole?.replace(/[_-]/g, " ").trim();
  if (role) return role;
  return progress.imageTag.includes("setup-cache") ? setupCacheImage : loginBaseImage;
};

export const isActiveContainerBuildProgress = (progress: ContainerBuildProgress | null | undefined): boolean => (
  progress ? BUILDING_KINDS.has(progress.kind) : false
);

export const ContainerBuildStatusInfobox: FunctionComponent<{
  progress: ContainerBuildProgress | null;
  className?: string;
}> = ({ progress, className = "" }) => {
  const { t, formatNumber } = useLiveI18n();
  if (!progress) return null;

  const status = getStatusCopy(progress);
  const progressId = `container-build-progress-${progress.imageTag.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const percent = progress.progressPercent;
  const hasKnownProgress = typeof percent === "number" && Number.isFinite(percent);
  const imageLabel = getImageLabel(progress, t("setupCacheImage"), t("loginBaseImage"));
  const localizedPercent = hasKnownProgress
    ? formatNumber(percent / 100, { style: "percent", maximumFractionDigits: 1 })
    : null;

  return (
    <div
      role={status.role}
      aria-live={status.role === "alert" ? "assertive" : "polite"}
      className={`rounded-xl border p-3 ${status.tone} ${className}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {status.icon === "success" ? (
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          ) : status.icon === "fallback" ? (
            <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4 motion-safe:animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{t(status.titleKey)}</span>
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-current/20 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.12em]">
              <Layers className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 break-words">{imageLabel}</span>
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            {t("containerBuildDescription")}
          </p>
          <p className="mt-2 break-words text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {progress.stepText || progress.message}
          </p>
          <div className="mt-2">
            <div
              id={progressId}
              role="progressbar"
              aria-label={t("buildProgress", { image: imageLabel })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={hasKnownProgress ? percent : undefined}
              className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
            >
              <div
                className={`h-full rounded-full ${status.icon === "fallback" ? "bg-status-amber" : status.icon === "success" ? "bg-status-green" : "bg-signal-500"}`}
                style={{ width: hasKnownProgress ? `${percent}%` : "100%" }}
              />
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
              {localizedPercent ? t("percentComplete", { percent: localizedPercent }) : t("progressUnavailable")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
