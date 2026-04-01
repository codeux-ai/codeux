import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import {
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
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

const GitCIStatusPanel: FunctionComponent<GitCIStatusPanelProps> = memo(({ status, error }) => {
  if (error) {
    return (
      <div className="group relative overflow-hidden rounded-[1.75rem] border border-status-red/20 bg-white/70 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-3">
          <XCircle className="h-5 w-5 text-status-red" strokeWidth={1.5} />
          <div>
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-status-red">Git Tracking Error</span>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Loading git status...</span>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      <div className="relative z-10 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GitBranch className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Git / CI / PR</span>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
            status.mode === "REMOTE"
              ? "border border-signal-500/15 bg-signal-500/8 text-signal-500"
              : "bg-black/[0.04] text-slate-400 dark:bg-white/[0.04]"
          }`}>
            {status.mode}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Branch", value: status.branch ?? "—" },
            { label: "Workspace", value: status.dirty ? "Dirty" : "Clean" },
            { label: "Tracking", value: status.tracking.label },
            { label: "Updated", value: formatTime(status.lastUpdated) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-black/[0.02] p-3 dark:bg-white/[0.02]">
              <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</span>
              <span className="block truncate text-xs font-mono font-medium text-slate-700 dark:text-slate-300">{value}</span>
            </div>
          ))}
        </div>

        {status.warnings.length > 0 && (
          <div className="rounded-xl border border-status-amber/20 bg-status-amber/[0.04] p-4">
            <span className="mb-2 block text-[8px] font-bold uppercase tracking-[0.15em] text-status-amber">Warnings</span>
            {status.warnings.map((warning) => (
              <p key={warning} className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{warning}</p>
            ))}
          </div>
        )}

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">
            <GitPullRequest className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} />
            Open PRs
          </span>
          {status.openPullRequests.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-400 dark:text-slate-600">No open PRs tracked.</p>
          ) : (
            <div className="space-y-2">
              {status.openPullRequests.slice(0, 5).map((pr) => (
                <a
                  key={pr.url}
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group/pr block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-signal-500/20 hover:bg-signal-500/[0.02] dark:border-white/[0.04] dark:bg-white/[0.015] focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">#{pr.number} {pr.title}</span>
                    <ExternalLink className="h-3 w-3 text-slate-300 transition-colors duration-200 group-hover/pr:text-signal-500 dark:text-slate-600" strokeWidth={2} />
                  </div>
                  <p className="text-[10px] font-mono text-slate-400">{pr.headRefName ?? "?"} → {pr.baseRefName ?? "?"}</p>
                  <p className={`mt-0.5 text-[10px] font-mono ${statusTone(pr.mergeStateStatus)}`}>
                    merge: {pr.mergeStateStatus ?? "UNKNOWN"} · comments: {pr.comments}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">
            <CircleDot className="mr-1.5 inline h-3 w-3 -mt-px" strokeWidth={2} />
            CI Runs
          </span>
          {status.ciRuns.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-400 dark:text-slate-600">No CI runs tracked.</p>
          ) : (
            <div className="space-y-2">
              {status.ciRuns.slice(0, 5).map((run) => (
                <a
                  key={`${run.id ?? run.url}`}
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-signal-500/20 dark:border-white/[0.04] dark:bg-white/[0.015] focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
                >
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{run.workflowName || run.name}</span>
                  <p className={`mt-0.5 text-[10px] font-mono ${statusTone(run.conclusion || run.status)}`}>
                    {run.status}{run.conclusion ? ` / ${run.conclusion}` : ""}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="mb-3 block text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">
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
                  className="block rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-all duration-200 hover:border-status-green/20 dark:border-white/[0.04] dark:bg-white/[0.015] focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
                >
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">#{merged.number} {merged.title}</span>
                  <p className="mt-0.5 text-[10px] font-mono text-slate-400">{merged.headRefName ?? "?"} → {merged.baseRefName ?? "?"}</p>
                  <p className="mt-0.5 text-[10px] font-mono text-status-green">merged {formatTime(merged.mergedAt ?? undefined)}</p>
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
