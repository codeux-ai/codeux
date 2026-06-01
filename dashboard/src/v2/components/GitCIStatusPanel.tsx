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
import { formatTime } from "../../lib/time.js";
import type { GitTrackingStatus } from "../../types.js";
import { BorderTrace } from "./ui/BorderTrace.js";
import { WaveFluid } from "./ui/WaveFluid.js";

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

const GitCIStatusPanel: FunctionComponent<GitCIStatusPanelProps> = memo(({ status, error }) => {
  if (error) {
    return (
      // Using aria-live="assertive" here because a Git tracking error prevents the user from understanding their source control state and requires immediate attention.
      <div role="alert" aria-live="assertive" className="group relative overflow-hidden rounded-[1.75rem] border border-status-red/20 bg-white/80 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-3">
          <XCircle className="h-5 w-5 text-status-red" strokeWidth={1.5} />
          <div>
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-status-red">Git Tracking Error</span>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div role="status" aria-live="polite" className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/80 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Loading git status...</span>
      </div>
    );
  }

  const activeCiCount = status.ciRuns.filter((run) => isActiveCiState(run.status) || isActiveCiState(run.conclusion)).length;

  return (
    <div aria-live="polite" className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/80 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      <div className="relative z-10 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Git / CI / PR</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs text-slate-700 dark:text-slate-300">{status.branch ?? "no-branch"}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                status.dirty
                  ? "bg-status-amber/15 text-status-amber"
                  : "bg-status-green/15 text-status-green"
              }`}>
                {status.dirty ? "Dirty" : "Clean"}
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

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Tracking", value: status.tracking.label },
            { label: "Open PRs", value: String(status.openPullRequests.length) },
            { label: "Active CI", value: String(activeCiCount) },
            { label: "Merges", value: String(status.mergedPullRequests.length) },
            { label: "Updated", value: formatTime(status.lastUpdated) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-black/[0.02] p-2.5 dark:bg-white/[0.02]">
              <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
              <span className="block truncate text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300">{value}</span>
            </div>
          ))}
        </div>

        {status.warnings.length > 0 && (
          <div className="rounded-xl border border-status-amber/20 bg-status-amber/[0.04] p-4">
            <span className="mb-2 block text-[8px] font-bold uppercase tracking-[0.14em] text-status-amber">Warnings</span>
            {status.warnings.map((warning) => (
              <p key={warning} className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{warning}</p>
            ))}
          </div>
        )}

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <GitPullRequest className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} />
            Open PRs
          </span>
          {status.openPullRequests.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-400 dark:text-slate-600">No open PRs tracked.</p>
          ) : (
            <div className="space-y-2">
              {status.openPullRequests.slice(0, 5).map((pr) => {
                const PrIcon = prStatusIcon(pr.mergeStateStatus);
                return (
                  <a
                    key={pr.url}
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group/pr block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-signal-500/20 hover:bg-signal-500/[0.02] dark:border-white/[0.04] dark:bg-white/[0.015]"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          <span className="font-mono text-slate-500">#{pr.number}</span> {pr.title}
                        </p>
                        <p className="truncate text-[10px] font-mono text-slate-400">{pr.headRefName ?? "?"} → {pr.baseRefName ?? "?"}</p>
                      </div>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 transition-colors duration-200 group-hover/pr:text-signal-500 dark:text-slate-600" strokeWidth={2} />
                    </div>
                    <p className={`mt-1 flex items-center gap-1.5 text-[10px] font-mono ${statusTone(pr.mergeStateStatus)}`}>
                      <PrIcon className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                      <span className="truncate">merge: {pr.mergeStateStatus ?? "UNKNOWN"}</span>
                      <span className="text-slate-400">·</span>
                      <MessageCircle className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={1.8} />
                      <span className="text-slate-400">{pr.comments}</span>
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <CircleDot className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} />
            CI Runs
          </span>
          {status.ciRuns.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-400 dark:text-slate-600">No CI runs yet for tracked PRs.</p>
          ) : (
            <div className="space-y-2">
              {status.ciRuns.slice(0, 5).map((run) => {
                const CiIcon = ciStatusIcon(run.status, run.conclusion);
                const isActive = isActiveCiState(run.status) || isActiveCiState(run.conclusion);
                return (
                  <a
                    key={`${run.id ?? run.url}`}
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-signal-500/20 dark:border-white/[0.04] dark:bg-white/[0.015]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">{run.workflowName || run.name}</p>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" strokeWidth={2} />
                    </div>
                    <p className={`mt-0.5 flex items-center gap-1.5 text-[10px] font-mono ${statusTone(run.conclusion || run.status)}`}>
                      <CiIcon
                        className={`h-3 w-3 shrink-0 ${isActive ? "animate-spin motion-reduce:animate-none" : ""}`}
                        strokeWidth={1.8}
                      />
                      <span>{run.status}{run.conclusion ? ` / ${run.conclusion}` : ""}</span>
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <GitMerge className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} />
            Recent Merges
          </span>
          {status.mergedPullRequests.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-400 dark:text-slate-600">No recent merges.</p>
          ) : (
            <div className="dashboard-scrollbar max-h-60 space-y-2 overflow-y-auto pr-1">
              {status.mergedPullRequests.map((merged) => (
                <a
                  key={merged.url}
                  href={merged.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-status-green/20 dark:border-white/[0.04] dark:bg-white/[0.015]"
                >
                  <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <span className="font-mono text-slate-500">#{merged.number}</span> {merged.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] font-mono text-slate-400">{merged.headRefName ?? "?"} → {merged.baseRefName ?? "?"}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-status-green">
                    <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} />
                    merged {formatTime(merged.mergedAt ?? undefined)}
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
