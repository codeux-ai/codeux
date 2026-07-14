// ARIA live-region strategy:
// - Errors / disconnects → aria-live="assertive"
// - Status updates / progress → aria-live="polite"

import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  MessageCircle,
  PauseCircle,
  RotateCw,
  TimerReset,
  XCircle,
} from "lucide-preact";
import type { GitTrackingStatus } from "../../types.js";


import { getSafeUrl } from "../lib/safe-url.js";
import { useLiveI18n } from "../i18n/messages/live.js";

interface GitCIStatusPanelProps {
  status: GitTrackingStatus | null;
  error: string | null;
}

function statusTone(value: string | null): string {
  if (!value) {
    return "text-slate-400";
  }
  const normalized = value.toUpperCase();
  if (normalized === "SUCCESS" || normalized === "COMPLETED" || normalized === "MERGED") {
    return "text-status-green";
  }
  if (normalized === "CANCEL_REQUESTED") {
    return "text-status-amber";
  }
  if (normalized === "IN_PROGRESS" || normalized === "QUEUED" || normalized === "PENDING" || normalized === "QUOTA") {
    return "text-status-amber";
  }
  if (normalized === "FAILURE" || normalized === "FAILED" || normalized === "ERROR" || normalized === "CANCELLED") {
    return "text-status-red";
  }
  return "text-slate-400";
}

function isActiveCiState(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toUpperCase();
  return normalized === "IN_PROGRESS" || normalized === "QUEUED" || normalized === "PENDING" || normalized === "QUOTA";
}

function ciStatusIcon(statusValue: string | null | undefined, conclusionValue: string | null | undefined): FunctionComponent<any> {
  const value = (conclusionValue ?? statusValue ?? "").toUpperCase();
  if (isActiveCiState(statusValue) || isActiveCiState(conclusionValue)) {
    return RotateCw;
  }
  if (value === "SUCCESS" || value === "COMPLETED") {
    return CheckCircle2;
  }
  if (value === "CANCELLED" || value === "CANCEL_REQUESTED") {
    return PauseCircle;
  }
  if (value === "FAILURE" || value === "FAILED" || value === "ERROR") {
    return XCircle;
  }
  return CircleDot;
}

function prStatusIcon(value: string | null | undefined): FunctionComponent<any> {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "MERGED") {
    return CheckCircle2;
  }
  if (normalized === "QUEUED" || normalized === "PENDING" || normalized === "IN_PROGRESS" || normalized === "QUOTA") {
    return TimerReset;
  }
  if (normalized === "FAILURE" || normalized === "FAILED" || normalized === "ERROR" || normalized === "CANCELLED") {
    return XCircle;
  }
  return GitPullRequest;
}

function statusLabel(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ") : "UNKNOWN";
}

const GitCIStatusPanel: FunctionComponent<GitCIStatusPanelProps> = memo(({ status, error }) => {
  const { t, tp, formatNumber, formatTime } = useLiveI18n();
  if (error) {
    return (
      // Using aria-live="assertive" here because a Git tracking error prevents the user from understanding their source control state and requires immediate attention.
      <div role="alert" aria-live="assertive" className="group relative overflow-hidden rounded-[1.75rem] border border-status-red/20 bg-white/80 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-3">
          <XCircle className="h-5 w-5 text-status-red" strokeWidth={1.5} aria-hidden="true" />
          <div className="min-w-0">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-status-red">{t("gitTrackingError")}</span>
            <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white p-7 shadow-sm dark:border-white/[0.08] dark:bg-void-800">
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("loadingGitStatus")}</span>
      </div>
    );
  }

  const activeCiCount = status.ciRuns.filter((run) => isActiveCiState(run.status) || isActiveCiState(run.conclusion)).length;

  return (
    <div role="region" aria-label={t("gitCiPrStatus")} aria-live="polite" className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white p-7 shadow-sm dark:border-white/[0.08] dark:bg-void-800">



      <div className="relative z-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-4 w-4 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("gitCiPr")}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{status.branch ?? t("noBranch")}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                status.dirty
                  ? "bg-status-amber/15 text-status-amber"
                  : "bg-status-green/15 text-status-green"
              }`}>
                {t(status.dirty ? "dirty" : "clean")}
              </span>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
            status.mode === "REMOTE"
              ? "border border-signal-500/15 bg-signal-500/8 text-signal-500"
              : "bg-black/[0.04] text-slate-400 dark:bg-white/[0.04]"
          }`}>
            {status.mode}
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2">
          {[
            { label: t("tracking"), value: status.tracking.label },
            { label: t("openPrs"), value: formatNumber(status.openPullRequests.length) },
            { label: t("activeCi"), value: formatNumber(activeCiCount) },
            { label: t("merges"), value: formatNumber(status.mergedPullRequests.length) },
            { label: t("updated"), value: formatTime(new Date(status.lastUpdated)) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-black/[0.02] p-2.5 dark:bg-white/[0.02]">
              <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
              <span className="block break-words text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300">{value}</span>
            </div>
          ))}
        </div>

        {status.warnings.length > 0 && (
          <div role="status" aria-live="polite" className="rounded-xl border border-status-amber/20 bg-status-amber/[0.04] p-4">
            <span className="mb-2 block text-[8px] font-bold uppercase tracking-[0.14em] text-status-amber">{t("warnings")}</span>
            {status.warnings.map((warning) => (
              <p key={warning} className="break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{warning}</p>
            ))}
          </div>
        )}

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <GitPullRequest className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} aria-hidden="true" />
            {t("openPrs")}
          </span>
          {status.openPullRequests.length === 0 ? (
            <p role="status" className="font-mono text-[11px] text-slate-400 dark:text-slate-600">{t("noOpenPrs")}</p>
          ) : (
            <div className="space-y-2">
              {status.openPullRequests.slice(0, 5).map((pr) => {
                const PrIcon = prStatusIcon(pr.mergeStateStatus);
                return (
                  <a
                    key={pr.url}
                    href={getSafeUrl(pr.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/pr block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-signal-500/20 hover:bg-signal-500/[0.02] dark:border-white/[0.04] dark:bg-white/[0.015]"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="break-words text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          <span className="font-mono text-slate-500">#{pr.number}</span> {pr.title}
                        </p>
                        <p className="break-all text-[10px] font-mono text-slate-400">{pr.headRefName ?? "?"} → {pr.baseRefName ?? "?"}</p>
                      </div>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 transition-colors duration-200 group-hover/pr:text-signal-500 dark:text-slate-600" strokeWidth={2} aria-hidden="true" />
                    </div>
                    <p className={`mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono ${statusTone(pr.mergeStateStatus)}`}>
                      <PrIcon className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                      <span>{t("mergeStatus", { status: statusLabel(pr.mergeStateStatus) })}</span>
                      <span className="text-slate-400">·</span>
                      <MessageCircle className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={1.8} aria-hidden="true" />
                      <span className="text-slate-400">{tp("commentsCount", pr.comments, { count: formatNumber(pr.comments) })}</span>
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <CircleDot className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} aria-hidden="true" />
            {t("ciRuns")}
          </span>
          {status.ciRuns.length === 0 ? (
            <p role="status" className="font-mono text-[11px] text-slate-400 dark:text-slate-600">{t("noCiRuns")}</p>
          ) : (
            <div className="space-y-2">
              {status.ciRuns.slice(0, 5).map((run) => {
                const CiIcon = ciStatusIcon(run.status, run.conclusion);
                const isActive = isActiveCiState(run.status) || isActiveCiState(run.conclusion);
                return (
                  <a
                    key={`${run.id ?? run.url}`}
                    href={getSafeUrl(run.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-signal-500/20 dark:border-white/[0.04] dark:bg-white/[0.015]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 break-words text-[11px] font-semibold text-slate-700 dark:text-slate-300">{run.workflowName || run.name}</p>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" strokeWidth={2} aria-hidden="true" />
                    </div>
                    <p className={`mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono ${statusTone(run.conclusion || run.status)}`}>
                      <CiIcon
                        className={`h-3 w-3 shrink-0 ${isActive ? "animate-spin motion-reduce:animate-none" : ""}`}
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />
                      <span className="sr-only">{run.status}</span>
                      <span>{t("ciStatus", {
                        status: run.conclusion
                          ? t("ciConclusion", { status: statusLabel(run.status), conclusion: statusLabel(run.conclusion) })
                          : statusLabel(run.status),
                      })}</span>
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <GitMerge className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} aria-hidden="true" />
            {t("recentMerges")}
          </span>
          {status.mergedPullRequests.length === 0 ? (
            <p role="status" className="font-mono text-[11px] text-slate-400 dark:text-slate-600">{t("noRecentMerges")}</p>
          ) : (
            <div className="dashboard-scrollbar max-h-60 space-y-2 overflow-y-auto pr-1">
              {status.mergedPullRequests.map((merged) => (
                <a
                  key={merged.url}
                  href={getSafeUrl(merged.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-status-green/20 dark:border-white/[0.04] dark:bg-white/[0.015]"
                >
                  <p className="break-words text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <span className="font-mono text-slate-500">#{merged.number}</span> {merged.title}
                  </p>
                  <p className="mt-0.5 break-all text-[10px] font-mono text-slate-400">{merged.headRefName ?? "?"} → {merged.baseRefName ?? "?"}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-status-green">
                    <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
                    {t("mergedAt", { time: merged.mergedAt ? formatTime(new Date(merged.mergedAt)) : "" })}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export { GitCIStatusPanel };
