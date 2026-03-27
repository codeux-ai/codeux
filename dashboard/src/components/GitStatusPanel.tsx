import type { FunctionComponent } from "preact";
import { formatTime } from "../lib/time.js";
import type { GitTrackingStatus } from "../types.js";

interface GitStatusPanelProps {
  status: GitTrackingStatus | null;
  error: string | null;
}

const statusTone = (value: string | null): string => {
  if (!value) return "text-slate-400";
  const normalized = value.toUpperCase();
  if (normalized === "SUCCESS" || normalized === "COMPLETED" || normalized === "MERGED") return "text-emerald-400";
  if (normalized === "IN_PROGRESS" || normalized === "QUEUED" || normalized === "PENDING") return "text-amber-400";
  if (normalized === "FAILURE" || normalized === "FAILED" || normalized === "ERROR") return "text-red-400";
  return "text-slate-300";
};

export const GitStatusPanel: FunctionComponent<GitStatusPanelProps> = ({ status, error }) => {
  if (error) {
    return (
      <section className="bg-slate-900/50 backdrop-blur-md border border-red-500/30 rounded-xl p-6">
        <h4 className="text-[10px] font-bold text-red-300 uppercase tracking-[0.2em] mb-3">Git Tracking Error</h4>
        <p className="text-sm text-red-200">{error}</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-xl p-6">
        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">Git Tracking</h4>
        <p className="text-sm text-slate-500">Loading git status...</p>
      </section>
    );
  }

  return (
    <section className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Git / CI / PR Tracking</h4>
        <span className={`text-[10px] font-bold uppercase ${status.mode === "REMOTE" ? "text-sky-400" : "text-slate-400"}`}>
          {status.mode}
        </span>
      </div>

      <div className="text-xs text-slate-400 space-y-1">
        <p>Branch: <span className="font-mono text-slate-200">{status.branch ?? "-"}</span></p>
        <p>Workspace: <span className="font-mono text-slate-200">{status.dirty ? "Dirty" : "Clean"}</span></p>
        <p>Tracking: <span className="font-mono text-slate-200">{status.tracking.label}</span></p>
        <p>Updated: <span className="font-mono text-slate-300">{formatTime(status.lastUpdated)}</span></p>
      </div>

      {status.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest mb-2">Warnings</p>
          <ul className="space-y-1">
            {status.warnings.map((warning) => (
              <li key={warning} className="text-xs text-amber-100/80">{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Open PRs</p>
        <div className="space-y-2">
          {status.openPullRequests.length === 0 ? (
            <p className="text-xs text-slate-500">No open PRs tracked.</p>
          ) : (
            status.openPullRequests.slice(0, 5).map((pr) => (
              <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 hover:border-slate-600 transition-colors">
                <p className="text-xs font-semibold text-slate-200">#{pr.number} {pr.title}</p>
                <p className="text-[11px] font-mono mt-1 text-slate-400">{pr.headRefName ?? "?"} {"->"} {pr.baseRefName ?? "?"}</p>
                <p className={`text-[11px] font-mono mt-1 ${statusTone(pr.mergeStateStatus)}`}>
                  merge: {pr.mergeStateStatus ?? "UNKNOWN"} | comments: {pr.comments}
                </p>
              </a>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">CI Runs</p>
        <div className="space-y-2">
          {status.ciRuns.length === 0 ? (
            <p className="text-xs text-slate-500">No CI runs tracked.</p>
          ) : (
            status.ciRuns.slice(0, 5).map((run) => (
              <a key={`${run.id ?? run.url}`} href={run.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 hover:border-slate-600 transition-colors">
                <p className="text-xs font-semibold text-slate-200">{run.workflowName || run.name}</p>
                <p className={`text-[11px] font-mono mt-1 ${statusTone(run.conclusion || run.status)}`}>
                  {run.status} {run.conclusion ? `/${run.conclusion}` : ""}
                </p>
              </a>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Recent Merges</p>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {status.mergedPullRequests.length === 0 ? (
            <p className="text-xs text-slate-500">No recent merges tracked.</p>
          ) : (
            status.mergedPullRequests.map((merged) => (
              <a key={merged.url} href={merged.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 hover:border-slate-600 transition-colors">
                <p className="text-xs font-semibold text-slate-200">#{merged.number} {merged.title}</p>
                <p className="text-[11px] font-mono mt-1 text-slate-400">{merged.headRefName ?? "?"} {"->"} {merged.baseRefName ?? "?"}</p>
                <p className="text-[11px] font-mono mt-1 text-emerald-400">merged {formatTime(merged.mergedAt ?? undefined)}</p>
              </a>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
