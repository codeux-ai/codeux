import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";

interface TaskHeaderProps {
  taskId: string;
  title: string;
  hasSession: boolean;
  showLogs: boolean;
  isExpanded: boolean;
  isRerunning: boolean;
  detailPanelId: string;
  livePanelId: string;
  onToggleLogs: () => void;
  onToggleExpanded: () => void;
  onRerun: () => void;
}

export const TaskHeader: FunctionComponent<TaskHeaderProps> = memo(({
  taskId,
  title,
  hasSession,
  showLogs,
  isExpanded,
  isRerunning,
  detailPanelId,
  livePanelId,
  onToggleLogs,
  onToggleExpanded,
  onRerun,
}) => (
  <div className="flex items-center justify-between mb-2 gap-3">
    <div className="flex items-center gap-3 min-w-0">
      <span className="font-mono text-[10px] font-bold px-2 py-0.5 bg-slate-800 rounded text-slate-400">#{taskId}</span>
      <h3 className="font-semibold text-white truncate">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="truncate text-left hover:text-slate-200 transition-colors"
        >
          {title}
        </button>
      </h3>
    </div>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onRerun}
        disabled={isRerunning}
        className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 transition-all border border-amber-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
        title="Rerun task and reset its state"
      >
        {isRerunning ? "Rerunning..." : "Rerun"}
      </button>
      {hasSession && (
        <button
          type="button"
          onClick={onToggleLogs}
          aria-expanded={showLogs}
          aria-controls={livePanelId}
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-slate-800/50 hover:bg-slate-800 text-slate-500 hover:text-sky-400 transition-all border border-slate-700/50"
        >
          {showLogs ? "Hide Logs" : "View Logs"}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={isExpanded}
        aria-controls={detailPanelId}
        className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-white"
        title={isExpanded ? "Collapse" : "Expand"}
      >
        <svg className={`w-5 h-5 transition-transform duration-500 ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  </div>
));
