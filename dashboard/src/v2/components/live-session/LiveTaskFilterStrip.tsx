import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import {
  LIVE_SESSION_TASK_FILTERS,
  type LiveSessionTaskFilter,
} from "../../lib/live-session-view-model.js";

export const LiveTaskFilterStrip: FunctionComponent<{
  activeFilter: LiveSessionTaskFilter;
  taskCounts: Record<LiveSessionTaskFilter, number>;
  announcement: string;
  onFilterChange: (filter: LiveSessionTaskFilter) => void;
  selectionMovementStyle: {
    transitionDuration: string;
    transitionTimingFunction: string;
  };
  pendingFilter?: LiveSessionTaskFilter | null;
}> = memo(({
  activeFilter,
  taskCounts,
  announcement,
  onFilterChange,
  selectionMovementStyle,
  pendingFilter = null,
}) => {
  const activateFilter = (filter: LiveSessionTaskFilter): void => {
    if (filter === activeFilter || filter === pendingFilter) {
      return;
    }
    onFilterChange(filter);
  };

  return (
    <>
      <div className="flex max-w-full flex-wrap gap-1 rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.04] sm:w-fit" role="tablist" aria-label="Task status filters">
        {LIVE_SESSION_TASK_FILTERS.map((filter, index) => {
          const isSelected = activeFilter === filter;
          const isPending = pendingFilter === filter;
          const disabledReason = isPending
            ? `${filter} filter selection is already in progress.`
            : isSelected
              ? `${filter} filter is already selected.`
              : null;

          return (
            <button
              key={filter}
              role="tab"
              aria-label={`${filter} tasks filter, ${taskCounts[filter]} task${taskCounts[filter] === 1 ? "" : "s"}${disabledReason ? `. ${disabledReason}` : ""}`}
              aria-selected={isSelected}
              aria-disabled={isPending ? "true" : undefined}
              aria-busy={isPending ? "true" : undefined}
              title={disabledReason ?? `Show ${filter.toLowerCase()} tasks`}
              tabIndex={isSelected ? 0 : -1}
              onClick={(event) => {
                if (disabledReason) {
                  event.preventDefault();
                  event.stopPropagation();
                }
                activateFilter(filter);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const nextFilter = LIVE_SESSION_TASK_FILTERS[(index + 1) % LIVE_SESSION_TASK_FILTERS.length];
                  activateFilter(nextFilter);
                  const nextTab = event.currentTarget.parentElement?.children[(index + 1) % LIVE_SESSION_TASK_FILTERS.length] as HTMLElement;
                  nextTab?.focus();
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const prevIndex = index - 1 < 0 ? LIVE_SESSION_TASK_FILTERS.length - 1 : index - 1;
                  const prevFilter = LIVE_SESSION_TASK_FILTERS[prevIndex];
                  activateFilter(prevFilter);
                  const prevTab = event.currentTarget.parentElement?.children[prevIndex] as HTMLElement;
                  prevTab?.focus();
                }
              }}
              style={selectionMovementStyle}
              className={`min-w-0 rounded-lg px-4 py-1.5 text-xs font-semibold
                         transition-all duration-[var(--interaction-selection-movement-duration)] ease-[var(--interaction-selection-movement-ease)] flex items-center gap-2 motion-reduce:transition-none
                         ${isSelected
                           ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                           : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                         } ${isPending ? "cursor-progress opacity-70" : ""}`}
            >
              {filter}
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-mono
                  ${isSelected
                    ? "bg-signal-500/[0.12] text-signal-600 dark:text-signal-400"
                    : "bg-black/[0.06] dark:bg-white/[0.06] text-slate-400"
                  }`}>
                {taskCounts[filter]}
              </span>
              {isPending && <span className="sr-only">{disabledReason}</span>}
            </button>
          );
        })}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
});
