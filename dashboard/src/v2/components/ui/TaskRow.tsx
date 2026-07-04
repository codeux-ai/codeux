import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { FolderGit2, CheckCircle2, Circle, PlayCircle, Clock, Play, Square, Settings, Maximize2, Loader2 } from "lucide-preact";
import type { Task } from "../../types.js";
import type { TaskStreamState } from "../../hooks/use-overview-stream-actions.js";
import { SprintReviewBadge } from "../sprints/SprintReviewBadge.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

interface TaskRowProps {
    task: Task;
    state?: TaskStreamState;
    onPlayStop?: () => void;
}

export const TaskRow: FunctionComponent<TaskRowProps> = memo(({ task, state, onPlayStop }) => {
    const isRunning = state?.isRunning ?? task.status === "in_progress";
    const busy = state?.busy ?? false;
    const tokens = useInteractionTokens();
    return (
    <div
        className="group relative flex items-center justify-between py-5 border-b border-black/[0.06] dark:border-white/[0.06] last:border-0 focus-within:ring-2 focus-within:ring-signal-500/30 focus-within:ring-offset-2 focus-within:z-10 focus-within:rounded-xl"
        style={{ "--task-row-control-duration": tokens.controlFeedback.duration, "--task-row-control-ease": tokens.controlFeedback.ease }}
    >
        {/* Hover backdrop */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-signal-500/0 via-signal-500/[0.03] to-signal-500/0 dark:via-signal-500/[0.05] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--task-row-control-duration)] ease-[var(--task-row-control-ease)] -z-10 rounded-xl" />
        <div aria-hidden="true" className="absolute inset-y-1 inset-x-0 bg-white/50 dark:bg-void-700/40 opacity-0 group-hover:opacity-100 transition-all duration-[var(--task-row-control-duration)] ease-[var(--task-row-control-ease)] -z-10 rounded-xl" />

        <div className="flex-1 flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-5 items-start md:items-center min-w-0">
            {/* ID */}
            <div className="hidden md:block col-span-1 font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
                #{task.id.split('-')[0].substring(0, 4)}
            </div>

            {/* Title */}
            <div className="col-span-8 md:col-span-5 flex items-center min-w-0">
                <span className={`text-base md:text-lg font-bold tracking-tight text-slate-900 dark:text-white truncate group-hover:translate-x-1.5 transition-transform duration-[var(--task-row-control-duration)] ease-[var(--task-row-control-ease)] ${task.status === 'completed' ? 'opacity-50' : task.status === 'coding_completed' ? 'opacity-80' : ''}`}>
                    {task.title}
                </span>
                {task.latestReview && (
                    <div className="ml-3 shrink-0">
                        <SprintReviewBadge summary={task.latestReview} compact showCompactLabel align="right" />
                    </div>
                )}
            </div>

            {/* Source */}
            <div className="hidden lg:flex col-span-2 items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 min-w-0">
                <FolderGit2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-signal-600 dark:group-hover:text-signal-400 transition-colors shrink-0" strokeWidth={2} />
                <span className="sr-only">Source: </span><span className="truncate group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors font-mono">{task.source}</span>
            </div>

            {/* Status */}
            <div className={`col-span-4 md:col-span-2 flex items-center gap-2 min-w-0 px-2.5 py-1 rounded-full transition-colors duration-300 w-fit ${
                task.status === 'completed' ? 'bg-status-green/10' :
                task.status === 'coding_completed' ? 'bg-cyan-500/10' :
                task.status === 'in_progress' ? 'bg-signal-500/10' :
                'bg-slate-500/5 dark:bg-slate-500/10'
            }`}>
                {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-status-green dark:text-status-green" strokeWidth={2} aria-hidden="true" />}
                {task.status === 'coding_completed' && <CheckCircle2 className="w-4 h-4 text-cyan-700 dark:text-cyan-500" strokeWidth={2} aria-hidden="true" />}
                {task.status === 'in_progress' && (
                    <div className="relative flex items-center justify-center w-4 h-4">
                        <div className="absolute inset-0 rounded-full bg-signal-500 animate-[spin_3s_linear_infinite] opacity-30 shadow-[0_0_10px_rgba(0,224,160,0.6)] pointer-events-none" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-2px)' }} />
                        <PlayCircle className="w-4 h-4 text-signal-600 dark:text-signal-500 relative z-10" strokeWidth={2} aria-hidden="true" />
                    </div>
                )}
                {task.status === 'pending' && <Circle className="w-4 h-4 text-slate-500 dark:text-slate-400" strokeWidth={2} aria-hidden="true" />}

                <div aria-live="polite" className="sr-only">Task {task.id} status is now {task.status.replace('_', ' ')}</div>
                <span className={`text-[9px] md:text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-300 ease-in-out ${
                    task.status === 'completed'   ? 'text-status-green dark:text-status-green' :
                    task.status === 'coding_completed' ? 'text-cyan-700 dark:text-cyan-500' :
                    task.status === 'in_progress' ? 'text-signal-600 dark:text-signal-500' :
                    'text-slate-600 dark:text-slate-400'
                }`}>
                    {task.status.replace('_', ' ')}
                </span>
            </div>

            {/* Time / Actions */}
            <div className="flex md:col-span-2 flex-wrap items-center justify-start md:justify-end gap-2 h-full w-full md:w-auto mt-2 md:mt-0">
                <div className="flex items-center gap-2 rounded-full border border-black/[0.05] bg-black/[0.02] px-2 py-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only">Duration: </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{task.time}</span>
                </div>

                {/* Quick actions */}
                <div className="flex flex-wrap items-center gap-1 p-1 bg-white/90 dark:bg-void-700/95 backdrop-blur-xl rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] border border-black/[0.05] dark:border-white/[0.08] transition-[opacity,transform] duration-[var(--task-row-control-duration)] ease-[var(--task-row-control-ease)] origin-right">
                    <button
                        type="button"
                        className="touch-target inline-flex items-center gap-1.5 rounded-full bg-transparent px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors active:scale-95 hover:bg-slate-100 hover:text-signal-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-slate-400 dark:hover:bg-void-600 dark:hover:text-signal-400"
                        title={isRunning ? "Stop task" : "Rerun task"}
                        aria-label={`${isRunning ? "Stop" : "Rerun"} task ${task.id}: ${task.title}`}
                        aria-busy={busy}
                        disabled={busy || !onPlayStop}
                        onClick={(event) => {
                            event.stopPropagation();
                            onPlayStop?.();
                        }}
                    >
                        {busy ? <><Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /><span className="sr-only">Loading</span></> : isRunning ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5" fill="currentColor" />}
                        <span>{isRunning ? "Stop" : "Rerun"}</span>
                    </button>
                    <a
                        href={`/tasks?sprintId=${encodeURIComponent(task.sprintId)}`}
                        className="touch-target inline-flex items-center gap-1.5 rounded-full bg-transparent px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors active:scale-95 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-slate-400 dark:hover:bg-void-600 dark:hover:text-slate-200"
                        title="Configure task"
                        aria-label={`Configure task ${task.id}: ${task.title}`}
                        onClick={(event: MouseEvent) => event.stopPropagation()}
                    >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Configure</span>
                    </a>
                    <a
                        href="/live"
                        className="touch-target inline-flex items-center gap-1.5 rounded-full bg-transparent px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors active:scale-95 hover:bg-slate-100 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-slate-400 dark:hover:bg-void-600 dark:hover:text-status-green"
                        title="Open live session"
                        aria-label={`Open live session for task ${task.id}: ${task.title}`}
                        onClick={(event: MouseEvent) => event.stopPropagation()}
                    >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Live</span>
                    </a>
                </div>
            </div>
        </div>
    </div>
    );
});
