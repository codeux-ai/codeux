import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Target } from "lucide-preact";
import type { Task } from "../../types.js";

export interface SprintProgressCardSprint {
  id: string;
  name: string;
  date: string;
}

export interface SprintProgressCardProps {
  sprint: SprintProgressCardSprint;
  tasks: Task[];
}

export const SprintProgressCard: FunctionComponent<SprintProgressCardProps> = memo(({ sprint, tasks }) => {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div aria-hidden className="absolute -right-4 -bottom-6 text-[6rem] font-black tracking-tighter text-black/[0.025] dark:text-white/[0.02] pointer-events-none select-none font-display leading-none">
        {pct}%
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-ember-500/[0.1] dark:bg-ember-500/[0.15] flex items-center justify-center">
          <Target className="w-5 h-5 text-ember-500" strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-lg font-black font-display tracking-tight text-slate-900 dark:text-white">{sprint.name}</h3>
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-[0.1em]">{sprint.date}</p>
        </div>
      </div>

      <div
        className="flex gap-1 h-2.5 rounded-full overflow-hidden mb-5"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Sprint progress: ${pct}%`}
      >
        {completed > 0 && <div className="bg-status-green rounded-full transition-all duration-700" style={{ width: `${(completed / total) * 100}%` }} />}
        {inProgress > 0 && <div className="bg-signal-500 rounded-full transition-all duration-700" style={{ width: `${(inProgress / total) * 100}%` }} />}
        {pending > 0 && <div className="bg-slate-200 dark:bg-slate-700 rounded-full transition-all duration-700" style={{ width: `${(pending / total) * 100}%` }} />}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Completed", value: completed, color: "text-status-green" },
          { label: "Running", value: inProgress, color: "text-signal-500" },
          { label: "Queued", value: pending, color: "text-slate-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col items-center py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
            <span className={`text-xl font-black font-mono leading-none ${color}`}>{value}</span>
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-1">{label}</span>
          </div>
        ))}
      </div>

      <Link
        to="/sprints"
        className="flex items-center gap-1.5 mt-5 pt-4 border-t border-black/[0.05] dark:border-white/[0.04] text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:text-ember-500 transition-colors duration-200 group/link"
      >
        <ArrowUpRight className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform duration-200" strokeWidth={2.5} />
        View Sprint
      </Link>
    </div>
  );
});
