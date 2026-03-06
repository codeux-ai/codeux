import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { FolderGit2, CheckCircle2, Circle, PlayCircle, Clock, Play, Square, Settings, Maximize2 } from "lucide-preact";
import { mockTasks } from "../lib/mockData.js";

type TaskFilter = "All Tasks" | "Running" | "Queued";

export const TasksList: FunctionComponent = () => {
    const listRef = useRef<HTMLDivElement>(null);
    const [activeFilter, setActiveFilter] = useState<TaskFilter>("All Tasks");

    useEffect(() => {
        if (listRef.current) {
            gsap.fromTo(
                listRef.current.children,
                { y: 30, opacity: 0, scale: 0.99 },
                { y: 0, opacity: 1, scale: 1, duration: 0.7, stagger: 0.04, ease: "power3.out", delay: 0.1 }
            );
        }
    }, [activeFilter]);

    const filteredTasks = mockTasks.filter(task => {
        if (activeFilter === "All Tasks") return true;
        if (activeFilter === "Running") return task.status === "in_progress";
        if (activeFilter === "Queued") return task.status === "pending";
        return true;
    });

    return (
        <div className="w-full relative z-10 px-2">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-8">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-display">Active Streams</h2>

                    <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl">
                        {(["All Tasks", "Running", "Queued"] as TaskFilter[]).map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setActiveFilter(filter)}
                                className={`text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200 ${activeFilter === filter
                                    ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                                    : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                {filter}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="text-xs font-semibold text-slate-400 dark:text-slate-600 font-mono">
                    {filteredTasks.length} active
                </div>
            </div>

            {/* Task rows */}
            <div ref={listRef} className="flex flex-col w-full">
                {filteredTasks.map((task) => (
                    <div
                        key={task.id}
                        className="group relative flex items-center justify-between py-5 cursor-pointer border-b border-black/[0.05] dark:border-white/[0.04] last:border-0"
                    >
                        {/* Hover backdrop — no negative x overflow */}
                        <div className="absolute inset-0 bg-gradient-to-r from-signal-500/0 via-signal-500/[0.03] to-signal-500/0 dark:via-signal-500/[0.05] opacity-0 group-hover:opacity-100 transition-opacity duration-400 -z-10 rounded-xl" />
                        <div className="absolute inset-y-1 inset-x-0 bg-white/50 dark:bg-void-700/40 opacity-0 group-hover:opacity-100 transition-all duration-300 -z-10 rounded-xl" />

                        <div className="flex-1 grid grid-cols-12 gap-5 items-center">
                            {/* ID */}
                            <div className="col-span-1 font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition-colors">
                                #{task.id.split('-')[0].substring(0, 4)}
                            </div>

                            {/* Title */}
                            <div className="col-span-5 flex items-center">
                                <span className={`text-lg font-bold tracking-tight text-slate-900 dark:text-white truncate group-hover:translate-x-1.5 transition-transform duration-300 ease-out ${task.status === 'completed' ? 'opacity-40' : ''}`}>
                                    {task.title}
                                </span>
                            </div>

                            {/* Source */}
                            <div className="col-span-2 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-500">
                                <FolderGit2 className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:text-signal-500 transition-colors shrink-0" strokeWidth={2} />
                                <span className="truncate group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors font-mono">{task.source}</span>
                            </div>

                            {/* Status */}
                            <div className="col-span-2 flex items-center gap-2">
                                {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-status-green" strokeWidth={2} />}
                                {task.status === 'in_progress' && (
                                    <div className="relative flex items-center justify-center w-4 h-4">
                                        <div className="absolute inset-0 rounded-full bg-signal-500 animate-[spin_3s_linear_infinite] opacity-30 shadow-[0_0_10px_rgba(0,224,160,0.6)] pointer-events-none" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-2px)' }} />
                                        <PlayCircle className="w-4 h-4 text-signal-500 relative z-10" strokeWidth={2} />
                                    </div>
                                )}
                                {task.status === 'pending' && <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600" strokeWidth={2} />}

                                <span className={`text-[10px] font-bold uppercase tracking-widest ${
                                    task.status === 'completed'  ? 'text-status-green' :
                                    task.status === 'in_progress'? 'text-signal-500' :
                                    'text-slate-400 dark:text-slate-600'
                                }`}>
                                    {task.status.replace('_', ' ')}
                                </span>
                            </div>

                            {/* Time / Actions */}
                            <div className="col-span-2 flex items-center justify-end h-full relative overflow-hidden">
                                <div className="flex items-center gap-2 absolute right-0 transition-all duration-300 opacity-100 group-hover:opacity-0 group-hover:translate-x-3">
                                    <Clock className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" strokeWidth={2} />
                                    <span className="text-xs font-mono text-slate-400 dark:text-slate-600">{task.time}</span>
                                </div>

                                {/* Quick actions */}
                                <div className="flex items-center gap-1 p-1 bg-white/90 dark:bg-void-700/95 backdrop-blur-md rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] border border-black/[0.05] dark:border-white/[0.08] absolute right-0 translate-x-[115%] opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-350 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]">
                                    <button className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-signal-600 dark:hover:text-signal-400 rounded-full transition-colors" title="Play/Stop">
                                        {task.status === 'in_progress' ? <Square className="w-3 h-3" fill="currentColor" /> : <Play className="w-3 h-3" fill="currentColor" />}
                                    </button>
                                    <button className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full transition-colors" title="Configure">
                                        <Settings className="w-3 h-3" />
                                    </button>
                                    <button className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-status-green rounded-full transition-colors" title="Expand">
                                        <Maximize2 className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
