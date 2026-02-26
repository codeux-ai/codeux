import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { renderMarkdown } from "../lib/markdown.js";
import { formatTime } from "../lib/time.js";
import { getActivityText } from "../lib/activity.js";
import type { Subtask, SubtaskMergeIndicator } from "../types.js";

interface TaskCardProps {
  task: Subtask;
}

const getStatusColor = (status?: string): string => {
  switch (status) {
    case "RUNNING":
      return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    case "COMPLETED":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "FAILED":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "BLOCKED":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-slate-800/50 text-slate-400 border-slate-700";
  }
};

const getIndicatorColor = (indicator?: SubtaskMergeIndicator): string => {
  switch (indicator) {
    case "CI":
      return "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";
    case "AUTOMERGE":
      return "bg-lime-500/10 text-lime-300 border-lime-500/20";
    case "MERGED":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "MERGE_BLOCKED":
      return "bg-amber-500/10 text-amber-300 border-amber-500/20";
    default:
      return "bg-slate-800/50 text-slate-400 border-slate-700";
  }
};

export const TaskCard: FunctionComponent<TaskCardProps> = ({ task }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const hasSession = Boolean(task.session_id || task.session_name);
  const sessionLabel = (task.session_id || task.session_name || "").replace(/^sessions\//, "");
  const providerLabel = task.provider ? task.provider.toUpperCase() : "JULES";
  const getOriginatorClasses = (originator?: string): { border: string; text: string } => {
    const normalized = (originator || "system").toLowerCase();
    if (normalized === "agent") {
      return { border: "border-sky-500/30", text: "text-sky-400" };
    }
    if (normalized === "user") {
      return { border: "border-emerald-500/30", text: "text-emerald-400" };
    }
    if (normalized === "provider") {
      return { border: "border-amber-500/30", text: "text-amber-400" };
    }
    return { border: "border-slate-700", text: "text-slate-400" };
  };

  return (
    <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-5 rounded-2xl hover:bg-slate-900/80 transition-all duration-300 group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-grow max-w-full overflow-hidden">
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-[10px] font-bold px-2 py-0.5 bg-slate-800 rounded text-slate-400">#{task.id}</span>
              <h3 className="font-semibold text-white truncate cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
                {task.title}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {hasSession && (
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-slate-800/50 hover:bg-slate-800 text-slate-500 hover:text-sky-400 transition-all border border-slate-700/50"
                >
                  {showLogs ? "Hide Logs" : "View Logs"}
                </button>
              )}
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-white"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                <svg className={`w-5 h-5 transition-transform duration-500 ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          <div className={`transition-all duration-300 ${isExpanded || showLogs ? "h-0 opacity-0 mb-0 overflow-hidden" : "h-6 opacity-100 mb-4"}`}>
            <p className="text-sm text-slate-500 line-clamp-1 cursor-pointer" onClick={() => setIsExpanded(true)}>
              {task.prompt.substring(0, 120)}...
            </p>
          </div>

          <div className={`expand-grid ${showLogs ? "expanded" : ""}`}>
            <div className="expand-content">
              <div className="space-y-3 mb-6 p-4 bg-slate-950/50 rounded-xl border border-slate-800/50">
                <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                  Live Session Feed
                </h4>
                {!task.activities || task.activities.length === 0 ? (
                  <p className="text-[10px] text-slate-600 italic">Connecting to session logs...</p>
                ) : (
                  task.activities.map((activity) => {
                    const originatorClasses = getOriginatorClasses(activity.originator);
                    return (
                    <div key={activity.id} className={`flex gap-3 text-xs border-l-2 ${originatorClasses.border} pl-3 py-1`}>
                      <div className="flex-grow">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`font-bold text-[10px] ${originatorClasses.text} uppercase`}>
                            {activity.originator || "system"}
                          </span>
                          <span className="text-[9px] text-slate-600 font-mono">{formatTime(activity.createTime)}</span>
                        </div>
                        <div className="text-slate-300 leading-relaxed font-mono text-[11px] line-clamp-2 hover:line-clamp-none transition-all cursor-help">
                          {getActivityText(activity)}
                        </div>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className={`expand-grid ${isExpanded ? "expanded" : ""}`}>
            <div className="expand-content">
              <div className="prose prose-sm prose-invert max-w-none mb-8 text-slate-400 prose-headings:text-slate-200 prose-a:text-blue-400 prose-code:text-sky-300 prose-code:bg-slate-800/50 prose-code:px-1 prose-code:rounded prose-strong:text-slate-200">
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(task.prompt) }} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <span className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all duration-500 ${getStatusColor(task.status)}`}>
            {task.status}
          </span>
          {task.merge_indicator && (
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${getIndicatorColor(task.merge_indicator)}`}>
              {task.merge_indicator}
            </span>
          )}
          {hasSession && <div className="text-[9px] font-mono text-slate-600">{sessionLabel.substring(0, 12)}...</div>}
          <div className="text-[9px] font-mono text-slate-600">{providerLabel}</div>
        </div>
      </div>
      {task.pr_url && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <a className="text-[11px] text-sky-400 hover:text-sky-300 font-mono" href={task.pr_url} target="_blank" rel="noreferrer">
            PR: {task.pr_url}
          </a>
        </div>
      )}
    </div>
  );
};
