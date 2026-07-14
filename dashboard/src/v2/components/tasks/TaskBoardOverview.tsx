import type { FunctionComponent } from "preact";
import { CheckCircle2, Flame, ListChecks, PlayCircle, Target } from "lucide-preact";
import type { Sprint, Task } from "../../types.js";
import type { TaskBoardState } from "../../lib/task-board-state.js";
import { getTaskLane } from "../../lib/task-board-state.js";

export interface TaskBoardOverviewProps {
  sprint: Pick<Sprint, "id" | "name" | "date"> | null;
  tasks: Task[];
  stats: TaskBoardState["stats"];
}

const overviewMetrics = [
  { key: "total", label: "Filtered total", icon: ListChecks, tone: "text-slate-700 dark:text-slate-200" },
  { key: "inProgress", label: "Running", icon: PlayCircle, tone: "text-signal-600 dark:text-signal-400" },
  { key: "completed", label: "Completed", icon: CheckCircle2, tone: "text-status-green" },
  { key: "critical", label: "Critical", icon: Flame, tone: "text-status-red" },
] as const;

export const TaskBoardOverview: FunctionComponent<TaskBoardOverviewProps> = ({ sprint, tasks, stats }) => {
  const completed = tasks.filter((task) => getTaskLane(task.status) === "completed").length;
  const inProgress = tasks.filter((task) => getTaskLane(task.status) === "in_progress").length;
  const queued = tasks.filter((task) => getTaskLane(task.status) === "pending").length;
  const total = tasks.length;
  const completion = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <section
      aria-labelledby="task-board-overview-heading"
      className="overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
    >
      <h3 id="task-board-overview-heading" className="sr-only">Task board overview</h3>
      <div className={`grid min-w-0 ${sprint ? "xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,1fr)]" : "grid-cols-1"}`}>
        {sprint && (
          <div className="min-w-0 border-b border-black/[0.05] p-5 dark:border-white/[0.05] sm:p-6 xl:border-b-0 xl:border-r">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ember-500/15 bg-ember-500/[0.08] text-ember-500">
                <Target className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ember-600 dark:text-ember-400">
                  Active sprint scope
                </p>
                <h4 className="mt-1 break-words font-display text-base font-semibold tracking-tight text-slate-900 dark:text-white sm:text-lg">
                  {sprint.name}
                </h4>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400">{sprint.date}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className="font-mono text-2xl font-semibold tracking-tighter text-slate-900 dark:text-white">{completion}%</span>
                <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">Complete</span>
              </div>
            </div>

            <div
              className="mt-5 h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.07]"
              role="progressbar"
              aria-label={`Sprint progress for ${sprint.name}`}
              aria-valuenow={completion}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${completed} of ${total} tasks complete`}
            >
              <div
                className="h-full rounded-full bg-status-green transition-[width] motion-reduce:transition-none"
                style={{ width: `${completion}%` }}
              />
            </div>

            <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className="font-mono text-status-green">{completed}</span> completed
              <span aria-hidden="true"> · </span>
              <span className="font-mono text-signal-600 dark:text-signal-400">{inProgress}</span> running
              <span aria-hidden="true"> · </span>
              <span className="font-mono text-slate-500 dark:text-slate-400">{queued}</span> queued
            </p>
          </div>
        )}

        <div className={`grid min-w-0 grid-cols-2 ${sprint ? "" : "sm:grid-cols-4"}`}>
          {overviewMetrics.map(({ key, label, icon: Icon, tone }, index) => (
            <div
              key={key}
              className={`min-w-0 p-4 sm:p-5 ${index % 2 === 0 ? "border-r border-black/[0.05] dark:border-white/[0.05]" : ""} ${index < 2 ? "border-b border-black/[0.05] dark:border-white/[0.05]" : ""} ${!sprint && index === 1 ? "sm:border-r sm:border-black/[0.05] sm:dark:border-white/[0.05]" : ""} ${!sprint ? "sm:border-b-0" : ""}`}
            >
              <div className="flex items-center gap-2 text-slate-400">
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="truncate text-[9px] font-bold uppercase tracking-[0.14em]">{label}</span>
              </div>
              <span className={`mt-2 block font-mono text-2xl font-semibold tracking-tighter ${tone}`}>
                {stats[key]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
