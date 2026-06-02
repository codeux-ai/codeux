import type { FunctionComponent } from "preact";
import { Layers } from "lucide-preact";
import type { Sprint } from "../../types.js";
import { SprintControls } from "../sprints/SprintControls.js";
import type { SprintStreamState } from "../../hooks/use-overview-stream-actions.js";

interface SprintStreamRowProps {
  sprint: Sprint;
  taskCount: number;
  state: SprintStreamState;
  onStartStop: () => void;
  onPauseResume: () => void;
}

const formatSprintKey = (sprint: Sprint): string => (
  sprint.number ? `SPR-${sprint.number}` : (sprint.slug?.toUpperCase() ?? "SPRINT")
);

/**
 * Group header row for the overview "Active Streams" list. Shows which sprint the
 * tasks below belong to, its progress, and live run controls.
 */
export const SprintStreamRow: FunctionComponent<SprintStreamRowProps> = ({
  sprint,
  taskCount,
  state,
  onStartStop,
  onPauseResume,
}) => {
  const completion = Math.max(0, Math.min(100, Math.round(sprint.completion ?? 0)));
  const accent = state.isPaused
    ? "bg-status-amber"
    : state.isActive
      ? "bg-status-green"
      : "bg-slate-400 dark:bg-slate-500";

  return (
    <div className="group/sprint relative flex flex-col gap-4 rounded-[1.5rem] border border-black/[0.06] bg-gradient-to-r from-signal-500/[0.05] via-white/40 to-transparent px-5 py-4 backdrop-blur-sm dark:border-white/[0.07] dark:from-signal-500/[0.07] dark:via-void-800/40 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-400">
          <Layers className="h-4 w-4" strokeWidth={2.1} />
          <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-void-800 ${accent}`}>
            {state.isActive && !state.isPaused && (
              <span className="absolute inset-0 animate-ping rounded-full bg-status-green opacity-70" />
            )}
          </span>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
              {formatSprintKey(sprint)}
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {taskCount} task{taskCount === 1 ? "" : "s"}
            </span>
          </div>
          <h3 className="mt-0.5 truncate font-display text-base font-black tracking-tight text-slate-900 dark:text-white">
            {sprint.name}
          </h3>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-5">
        <div className="hidden min-w-[8rem] flex-col gap-1.5 md:flex">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <span>Progress</span>
            <span className="font-mono text-slate-600 dark:text-slate-300">{completion}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-signal-500 to-status-green transition-[width] duration-700 ease-out"
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SprintControls
            isActive={state.isActive}
            isPaused={state.isPaused}
            isStartStopPending={state.primaryBusy}
            isPauseResumePending={state.pauseResumeBusy}
            onStartStop={onStartStop}
            onPauseResume={onPauseResume}
          />
        </div>
      </div>
    </div>
  );
};
