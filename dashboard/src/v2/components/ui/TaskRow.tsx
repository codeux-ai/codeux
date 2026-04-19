import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { FolderGit2, CheckCircle2, Circle, PlayCircle, Clock, Play, Square, Settings, Maximize2 } from "lucide-preact";
import type { Task } from "../../types.js";

export const TaskRow: FunctionComponent<{ task: Task }> = memo(({ task }) => (
    <div
        className="group relative flex items-center justify-between py-5 cursor-pointer border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 focus-visible:z-10 focus-visible:rounded-2xl transition-all duration-300 active:scale-[0.99]"
        tabIndex={0}
        role="button"
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault();
            }
        }}
    >
        {/* Hover backdrop and shimmer */}
        <div className="absolute inset-0 bg-gradient-to-r from-signal-500/0 via-signal-500/[0.03] to-signal-500/0 dark:via-signal-500/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 rounded-2xl" />
        <div className="absolute inset-y-1.5 inset-x-0 bg-void-50/50 dark:bg-void-800/40 opacity-0 group-hover:opacity-100 group-hover:inset-y-0 transition-all duration-300 ease-out -z-10 rounded-2xl backdrop-blur-sm" />

        <div className="flex-1 grid grid-cols-12 gap-4 md:gap-6 items-center min-w-0 px-2">
            {/* ID */}
            <div className="hidden md:block col-span-1 font-mono text-[10px] font-black tracking-widest text-slate-400 dark:text-void-500 group-hover:text-ember-500 transition-colors">
                {task.id.split('-')[0].substring(0, 4).toUpperCase()}
            </div>

            {/* Title */}
            <div className="col-span-8 md:col-span-5 flex items-center min-w-0">
                <span className={`text-base md:text-lg font-bold tracking-tight text-slate-900 dark:text-white truncate group-hover:translate-x-1 transition-transform duration-300 ease-out ${task.status === 'completed' ? 'opacity-40' : task.status === 'coding_completed' ? 'opacity-70' : ''}`}>
                    {task.title}
                </span>
            </div>

            {/* Source */}
            <div className="hidden lg:flex col-span-2 items-center gap-2.5 text-xs font-bold text-slate-500 dark:text-void-400 min-w-0">
                <FolderGit2 className="w-3.5 h-3.5 text-slate-300 dark:text-void-500 group-hover:text-ember-500 transition-colors shrink-0" strokeWidth={2.5} />
                <span className="truncate group-hover:text-slate-800 dark:group-hover:text-white transition-colors font-mono tracking-tight">{task.source}</span>
            </div>

            {/* Status */}
            <div className="col-span-4 md:col-span-2 flex items-center gap-2.5 min-w-0">
                {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-status-green" strokeWidth={2.5} />}
                {task.status === 'coding_completed' && <CheckCircle2 className="w-4 h-4 text-ember-500" strokeWidth={2.5} />}
                {task.status === 'in_progress' && (
                    <div className="relative flex items-center justify-center w-4 h-4">
                        <div className="absolute inset-0 rounded-full bg-signal-500 animate-[spin_4s_linear_infinite] opacity-20 shadow-[0_0_12px_rgba(0,224,160,0.5)] pointer-events-none" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <PlayCircle className="w-4 h-4 text-signal-500 relative z-10" strokeWidth={2.5} />
                    </div>
                )}
                {task.status === 'pending' && <Circle className="w-4 h-4 text-slate-300 dark:text-void-600" strokeWidth={2.5} />}

                <span className={`text-[9px] md:text-[10px] font-black uppercase tracking-[0.18em] ${
                    task.status === 'completed'   ? 'text-status-green' :
                    task.status === 'coding_completed' ? 'text-ember-500' :
                    task.status === 'in_progress' ? 'text-signal-500' :
                    'text-slate-400 dark:text-void-500'
                }`}>
                    {task.status.replace('_', ' ')}
                </span>
            </div>

            {/* Time / Actions */}
            <div className="hidden sm:flex col-span-2 items-center justify-end h-full relative overflow-hidden">
                <div className="flex items-center gap-2 absolute right-0 transition-all duration-400 opacity-100 group-hover:opacity-0 group-hover:translate-x-4">
                    <Clock className="w-3.5 h-3.5 text-slate-300 dark:text-void-600 group-hover:text-ember-500 transition-colors" strokeWidth={2.5} />
                    <span className="text-[11px] font-black font-mono text-slate-400 dark:text-void-500 group-hover:text-ember-500 transition-colors">{task.time}</span>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1 p-1 bg-white/95 dark:bg-void-900/95 backdrop-blur-2xl rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-black/[0.04] dark:border-white/[0.06] absolute right-0 translate-x-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 transition-all duration-300 ease-out">
                    <button className="touch-target p-2 text-slate-500 dark:text-void-400 hover:text-signal-500 bg-transparent hover:bg-void-50 dark:hover:bg-void-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95" title="Play/Stop">
                        {task.status === 'in_progress' ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5" fill="currentColor" />}
                    </button>
                    <button className="touch-target p-2 text-slate-500 dark:text-void-400 hover:text-ember-500 bg-transparent hover:bg-void-50 dark:hover:bg-void-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95" title="Configure">
                        <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button className="touch-target p-2 text-slate-500 dark:text-void-400 hover:text-signal-500 bg-transparent hover:bg-void-50 dark:hover:bg-void-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95" title="Expand">
                        <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </div>
    </div>
));
