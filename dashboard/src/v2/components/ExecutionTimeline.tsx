import type { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { RuntimeEventFeed } from "./RuntimeEventFeed.js";
import { useExecutionTimeline } from "../../hooks/ExecutionTimelineContext.js";
import type { ExecutionSprintRunSummary } from "../../types.js";

interface ExecutionTimelineProps {
  activeSprintRuns: ExecutionSprintRunSummary[];
}

export const ExecutionTimeline: FunctionComponent<ExecutionTimelineProps> = ({ activeSprintRuns }) => {
  const { execution } = useExecutionTimeline();
  const timelineEvents = useMemo(() => {
    return execution && activeSprintRuns.length > 0 ? execution.recentEvents.slice(0, 24) : [];
  }, [execution, activeSprintRuns.length]);

  return (
    <div>
      <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 block mb-3">Runtime Timeline</span>
      {timelineEvents.length === 0 ? (
        <p role="status" className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">No task run events recorded yet.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto dashboard-scrollbar pr-1">
          <RuntimeEventFeed events={timelineEvents} />
        </div>
      )}
    </div>
  );
};
