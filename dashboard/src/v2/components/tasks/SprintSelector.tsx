import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import { ChevronDown, ListChecks, Target } from "lucide-preact";
import { formatSprintDisplay } from "../../lib/format-sprint.js";
import type { Sprint } from "../../types.js";

export interface SprintSelectorProps {
  sprints: Sprint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  sprintKeyPrefix: string;
}

export const SprintSelector: FunctionComponent<SprintSelectorProps> = memo(({
  sprints,
  selectedId,
  onSelect,
  sprintKeyPrefix,
}) => {
  const [open, setOpen] = useState(false);
  const selected = selectedId ? sprints.find((sprint: Sprint) => sprint.id === selectedId) : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        className={`group flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all duration-300 min-w-0 max-w-full ${
          selected
            ? "bg-ember-500/[0.06] dark:bg-ember-500/[0.08] border-ember-500/20 dark:border-ember-500/25 shadow-[0_0_20px_rgba(255,184,0,0.06)]"
            : "bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06]"
        } hover:border-ember-500/40 dark:hover:border-ember-500/40`}
      >
        <Target className={`w-4 h-4 shrink-0 ${selected ? "text-ember-500" : "text-slate-400"} transition-colors`} strokeWidth={2} />
        <span className={`text-sm font-bold tracking-tight truncate min-w-0 ${selected ? "text-ember-600 dark:text-ember-400" : "text-slate-600 dark:text-slate-400"}`}>
          {selected ? formatSprintDisplay(selected, sprintKeyPrefix) : "All Sprints"}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] z-50 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col max-h-[60vh]">
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200 ${
              !selectedId ? "bg-signal-500/[0.06] dark:bg-signal-500/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            }`}
          >
            <ListChecks className="w-4 h-4 text-signal-500" strokeWidth={2} />
            <div className="flex-1">
              <span className="text-sm font-bold text-slate-800 dark:text-white">All Sprints</span>
            </div>
          </button>

          <div className="h-px bg-black/[0.04] dark:bg-white/[0.04] shrink-0" />

          <div className="overflow-y-auto min-h-0">
            {sprints.map((sprint) => {
              const isActive = selectedId === sprint.id;
              return (
                <button
                  key={sprint.id}
                  onClick={() => { onSelect(sprint.id); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200 ${
                    isActive ? "bg-ember-500/[0.06] dark:bg-ember-500/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    sprint.status === "running" ? "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)] animate-pulse" :
                    sprint.status === "paused" ? "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.45)]" :
                    sprint.status === "completed" ? "bg-signal-500" :
                    sprint.status === "failed" ? "bg-status-red" :
                    sprint.status === "cancelled" ? "bg-slate-400 dark:bg-slate-500" :
                    "bg-slate-400 dark:bg-slate-600"
                  }`} />
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className={`text-sm font-bold tracking-tight truncate min-w-0 ${isActive ? "text-ember-600 dark:text-ember-400" : "text-slate-800 dark:text-white"}`}>
                      {formatSprintDisplay(sprint, sprintKeyPrefix)}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.1em] truncate min-w-0">{sprint.date}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0 pl-2">
                    <span className="text-[10px] font-mono font-bold text-slate-500">{sprint.tasksCount}</span>
                    <div className="w-12 h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-signal-500 transition-all duration-500" style={{ width: `${sprint.completion}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
