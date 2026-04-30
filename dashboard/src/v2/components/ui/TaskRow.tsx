import type { FunctionComponent } from "preact";
import { memo, useCallback } from "preact/compat";
import { FolderGit2, CheckCircle2, Circle, PlayCircle, Clock, Play, Square, Settings, Maximize2, Loader2 } from "lucide-preact";
import type { Task } from "../../types.js";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { InteractionMessages, getErrorMessage } from "../../lib/copy/interaction-messages.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";

export const TaskRow: FunctionComponent<{ task: Task; onPlayStop?: (task: Task) => Promise<void> }> = memo(({ task, onPlayStop }) => {
    const { feedback, setPending, setSuccess, setError, clearFeedback } = useActionFeedback();

    const handlePlayStop = useCallback(async (e: Event) => {
        e.stopPropagation();
        if (!onPlayStop) return;

        const isStarting = task.status !== 'in_progress';
        setPending(isStarting ? InteractionMessages.actionPending : InteractionMessages.actionPending);

        try {
            await onPlayStop(task);
            setSuccess(InteractionMessages.actionSuccess);
        } catch (error) {
            setError(InteractionMessages.actionError(getErrorMessage(error)));
        }
    }, [task, onPlayStop, setPending, setSuccess, setError]);

    return (
    <div className="flex flex-col gap-2">
    <div
        className="group relative flex items-center justify-between py-5 cursor-pointer border-b border-black/[0.06] dark:border-white/[0.06] last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 focus-visible:z-10 focus-visible:rounded-xl transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] active:bg-black/[0.04] dark:active:bg-white/[0.04]"
        tabIndex={0}
        role="button"
        aria-disabled={feedback.status === 'pending'}
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault();
            }
        }}
    >

        <div className="flex-1 grid grid-cols-12 gap-3 md:gap-5 items-center min-w-0">
            {/* ID */}
            <div className="hidden md:block col-span-1 font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors duration-150">
                #{task.id.split('-')[0].substring(0, 4)}
            </div>

            {/* Title */}
            <div className="col-span-8 md:col-span-5 flex items-center min-w-0">
                <span className={`text-base md:text-lg font-bold tracking-tight text-slate-900 dark:text-white truncate group-hover:translate-x-1.5 transition-transform duration-150 ease-out ${task.status === 'completed' ? 'opacity-50' : task.status === 'coding_completed' ? 'opacity-80' : ''}`}>
                    {task.title}
                </span>
            </div>

            {/* Source */}
            <div className="hidden lg:flex col-span-2 items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 min-w-0">
                <FolderGit2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-signal-600 dark:group-hover:text-signal-400 transition-colors duration-150 shrink-0" strokeWidth={2} />
                <span className="truncate group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors duration-150 font-mono">{task.source}</span>
            </div>

            {/* Status */}
            <div className="col-span-4 md:col-span-2 flex items-center gap-2 min-w-0">
                {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-status-green dark:text-status-green" strokeWidth={2} />}
                {task.status === 'coding_completed' && <CheckCircle2 className="w-4 h-4 text-cyan-700 dark:text-cyan-500" strokeWidth={2} />}
                {task.status === 'in_progress' && (
                    <div className="relative flex items-center justify-center w-4 h-4">
                        <div className="absolute inset-0 rounded-full bg-signal-500 animate-[spin_3s_linear_infinite] opacity-30 shadow-[0_0_10px_rgba(0,224,160,0.6)] pointer-events-none" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-2px)' }} />
                        <PlayCircle className="w-4 h-4 text-signal-600 dark:text-signal-500 relative z-10" strokeWidth={2} />
                    </div>
                )}
                {task.status === 'pending' && <Circle className="w-4 h-4 text-slate-500 dark:text-slate-400" strokeWidth={2} />}

                <span className={`text-[9px] md:text-[10px] font-bold uppercase tracking-[0.14em] ${
                    task.status === 'completed'   ? 'text-status-green dark:text-status-green' :
                    task.status === 'coding_completed' ? 'text-cyan-700 dark:text-cyan-500' :
                    task.status === 'in_progress' ? 'text-signal-600 dark:text-signal-500' :
                    'text-slate-600 dark:text-slate-400'
                }`}>
                    {task.status.replace('_', ' ')}
                </span>
            </div>

            {/* Time / Actions */}
            <div className="hidden sm:flex col-span-2 items-center justify-end h-full relative overflow-hidden">
                <div className="flex items-center gap-2 absolute right-0 transition-all duration-150 opacity-100 group-hover:opacity-0 group-hover:translate-x-3">
                    <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" strokeWidth={2} />
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{task.time}</span>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1 p-1 bg-white/90 dark:bg-void-700/95 backdrop-blur-xl rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] border border-black/[0.05] dark:border-white/[0.08] absolute right-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
                    <button
                        className="touch-target p-2 text-slate-600 dark:text-slate-400 hover:text-signal-600 dark:hover:text-signal-400 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-all duration-150 active:scale-95"
                        title="Play/Stop"
                        onClick={handlePlayStop}
                        disabled={feedback.status === 'pending' || !onPlayStop}
                    >
                        {feedback.status === 'pending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                         task.status === 'in_progress' ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5" fill="currentColor" />}
                    </button>
                    <button className="touch-target p-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-all duration-150 active:scale-95" title="Configure">
                        <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button className="touch-target p-2 text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-status-green bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-all duration-150 active:scale-95" title="Expand">
                        <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </div>
    </div>
    {feedback.status !== 'idle' && (
        <div className="px-4 pb-3">
            <ActionFeedbackRegion
                status={feedback.status}
                message={feedback.message}
                onDismiss={() => clearFeedback()}
            />
        </div>
    )}
    </div>
);});
