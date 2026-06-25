import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useMemo, useState } from "preact/hooks";
import { ChevronDown, Workflow } from "lucide-preact";
import { RuntimeEventFeed } from "./RuntimeEventFeed.js";
import { useExecutionTimeline } from "../../hooks/ExecutionTimelineContext.js";
import type { ExecutionSprintRunSummary } from "../../types.js";
import { WaveFluid } from "./ui/WaveFluid.js";
import { BorderTrace } from "./ui/BorderTrace.js";

interface ExecutionTimelineProps {
  activeSprintRuns?: ExecutionSprintRunSummary[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export const ExecutionTimeline: FunctionComponent<ExecutionTimelineProps> = memo(({
  activeSprintRuns,
  collapsible = false,
  defaultOpen = true,
}) => {
  const { execution } = useExecutionTimeline();
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const derivedActiveSprintRuns = useMemo(() => {
    return execution
      ? execution.sprintRuns.filter((run) => run.status === "running" || run.status === "queued")
      : [];
  }, [execution, execution?.sprintRuns.length]);
  const resolvedActiveSprintRuns = activeSprintRuns ?? derivedActiveSprintRuns;
  const timelineEvents = useMemo(() => {
    return execution && resolvedActiveSprintRuns.length > 0 ? execution.recentEvents.slice(0, 24) : [];
  }, [execution, resolvedActiveSprintRuns.length]);

  return (
    <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
          className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-200 hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
        >
          <div className="flex items-center gap-2.5">
            <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Runtime Timeline</span>
            {resolvedActiveSprintRuns.length > 0 && (
              <span className="rounded-md bg-signal-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-signal-500">
                {resolvedActiveSprintRuns.length} active
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
            strokeWidth={2}
          />
        </button>
      ) : (
        <div className="relative z-10 flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-2.5">
            <Workflow className="h-4 w-4 text-signal-500" strokeWidth={1.5} />
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Runtime Timeline</span>
            {resolvedActiveSprintRuns.length > 0 && (
              <span className="rounded-md bg-signal-500/10 px-2 py-0.5 text-[9px] font-mono font-bold text-signal-500">
                {resolvedActiveSprintRuns.length} active
              </span>
            )}
          </div>
        </div>
      )}

      <div className={collapsible ? `collapsible-section ${open ? "open" : ""}` : ""} id={contentId}>
        <div className={collapsible ? "collapsible-content relative z-10 px-5 pb-5 pt-0" : "relative z-10 px-5 pb-5 pt-0"}>
          {timelineEvents.length === 0 ? (
            <div role="status" className="flex flex-col items-center justify-center py-10 rounded-xl border border-black/[0.04] bg-black/[0.015] dark:border-white/[0.05] dark:bg-white/[0.015]">
              <Workflow className="w-8 h-8 mb-3 opacity-40 text-signal-500" strokeWidth={1.5} />
              <p className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-400">No runtime events yet</p>
              <p className="text-xs mt-1 font-mono opacity-80 text-slate-500">Listening for execution activity...</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1 dashboard-scrollbar">
              <RuntimeEventFeed events={timelineEvents} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
