import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { Activity, Clock, Maximize2, Play, Square } from "lucide-preact";
import type { Sprint } from "../../types.js";

interface SprintRowProps {
  sprint: Sprint;
  isRunning: boolean;
  onStartStop?: () => void;
  startStopBusy?: boolean;
}

export const SprintRow: FunctionComponent<SprintRowProps> = memo(({ sprint, isRunning, onStartStop, startStopBusy }) => {
    const sprintNumber = sprint.number || 0;
    const taskCount = sprint.taskCount || 0;
    const completionPercentage = sprint.completionPercentage || 0;

    return (
        <div
            className={`group relative flex items-center justify-between py-5 cursor-pointer border-b border-black/[0.06] dark:border-white/[0.06] last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 focus-visible:z-10 focus-visible:rounded-xl border-l-[3px] ${
                isRunning ? 'border-l-signal-500' : 'border-l-status-amber'
            }`}
            tabIndex={0}
            role="button"
        >
            {/* Hover backdrop */}
            <div className="absolute inset-0 bg-gradient-to-r from-signal-500/0 via-signal-500/[0.03] to-signal-500/0 dark:via-signal-500/[0.05] opacity-0 group-hover:opacity-100 transition-opacity duration-400 -z-10 rounded-xl" />
            <div className="absolute inset-y-1 inset-x-0 bg-white/50 dark:bg-void-700/40 opacity-0 group-hover:opacity-100 transition-all duration-300 -z-10 rounded-xl" />

            <div className="flex-1 grid grid-cols-12 gap-3 md:gap-5 items-center min-w-0 px-4">
                {/* Col 1 (hidden md): Sprint key badge */}
                <div className={`hidden md:block col-span-1 font-mono text-[10px] font-bold transition-colors ${
                    isRunning ? 'text-signal-500' : 'text-status-amber'
                }`}>
                    SPR-{sprintNumber}
                </div>

                {/* Col 5-6: Sprint name + status dot */}
                <div className="col-span-8 md:col-span-5 flex items-center min-w-0">
                    <div className="relative flex items-center justify-center mr-3 shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-signal-500 animate-pulse' : 'bg-status-amber'}`} />
                        {isRunning && (
                            <div className="absolute inset-0 rounded-full bg-signal-500 animate-ping opacity-20" />
                        )}
                    </div>
                    <span className="text-base md:text-lg font-black font-display tracking-tight text-slate-900 dark:text-white truncate">
                        {sprint.name}
                    </span>
                </div>

                {/* Col 2 (hidden lg): Task count + % */}
                <div className="hidden lg:flex col-span-2 items-center gap-2 text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">
                    <span>{taskCount} tasks</span>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span>{completionPercentage}%</span>
                </div>

                {/* Col 2: Status badge */}
                <div className={`col-span-4 md:col-span-2 flex items-center gap-2 min-w-0 px-2.5 py-1 rounded-full transition-colors duration-300 w-fit ${
                    isRunning ? 'bg-status-green/10 text-status-green' : 'bg-status-amber/10 text-status-amber'
                }`}>
                    {isRunning ? (
                        <Activity className="w-3.5 h-3.5" strokeWidth={2.5} />
                    ) : (
                        <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                        {isRunning ? 'Running' : 'Paused'}
                    </span>
                </div>

                {/* Col 2 right: Hover actions pill */}
                <div className="hidden sm:flex col-span-2 items-center justify-end h-full relative overflow-hidden">
                    <div className="flex items-center gap-1 p-1 bg-white/90 dark:bg-void-700/95 backdrop-blur-xl rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] border border-black/[0.05] dark:border-white/[0.08] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-[opacity,transform] duration-200 origin-right motion-safe:scale-95 motion-safe:group-hover:scale-100 motion-safe:group-focus-within:scale-100">
                        <a 
                            href={`/tasks?sprint=${sprint.id}`}
                            className="touch-target p-2 text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-status-green bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 rounded-full transition-colors active:scale-95" 
                            title="View Tasks"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Maximize2 className="w-3.5 h-3.5" />
                        </a>
                        <button 
                            className="touch-target p-2 text-slate-600 dark:text-slate-400 hover:text-signal-600 dark:hover:text-signal-400 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors active:scale-95" 
                            title={isRunning ? "Stop Sprint" : "Start Sprint"}
                            disabled={startStopBusy}
                            onClick={(e) => {
                                e.stopPropagation();
                                onStartStop?.();
                            }}
                        >
                            {isRunning ? (
                                <Square className="w-3.5 h-3.5" fill="currentColor" />
                            ) : (
                                <Play className="w-3.5 h-3.5" fill="currentColor" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
