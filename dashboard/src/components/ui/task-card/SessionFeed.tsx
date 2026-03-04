import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { getActivityText } from "../../../lib/activity.js";
import { formatTime } from "../../../lib/time.js";
import type { JulesActivity } from "../../../types.js";

interface SessionFeedProps {
  livePanelId: string;
  showLogs: boolean;
  activities?: JulesActivity[];
}

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

export const SessionFeed: FunctionComponent<SessionFeedProps> = ({ livePanelId, showLogs, activities }) => {
  const feedScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedScrollRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activities]);

  return (
    <div id={livePanelId} className={`expand-grid ${showLogs ? "expanded" : ""}`}>
      <div className="expand-content">
        <div className="space-y-3 mb-6 p-4 bg-slate-950/50 rounded-xl border border-slate-800/50">
          <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            Live Session Feed
          </h4>
          {!activities || activities.length === 0 ? (
            <p className="text-[10px] text-slate-600 italic">Connecting to session logs...</p>
          ) : (
            <div ref={feedScrollRef} className="max-h-72 overflow-y-auto pr-2 dashboard-scrollbar">
              {activities.map((activity) => {
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
