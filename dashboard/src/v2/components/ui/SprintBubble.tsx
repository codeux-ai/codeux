import type { FunctionComponent } from "preact";
import { useRef } from "preact/hooks";
import gsap from "gsap";
import { Activity, CheckCircle2, Clock, XCircle, CalendarDays, ArrowUpRight } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import type { Sprint, SprintStatus } from "../../types.js";
import { CellActions } from "./CellActions.js";

const statusMap: Record<SprintStatus, {
    ring: string;
    text: string;
    icon: any;
    label: string;
}> = {
    running:   { ring: 'border-status-green/50 shadow-[0_0_28px_rgba(0,171,132,0.35)]',  text: 'text-status-green', icon: Activity,     label: "Running"   },
    completed: { ring: 'border-signal-500/50 shadow-[0_0_28px_rgba(0,224,160,0.35)]',    text: 'text-signal-500',   icon: CheckCircle2, label: "Completed" },
    failed:    { ring: 'border-status-red/60 shadow-[0_0_28px_rgba(227,0,15,0.35)]',     text: 'text-status-red',   icon: XCircle,      label: "Failed"    },
    idle:      { ring: '',                                                                 text: 'text-slate-400 dark:text-slate-500', icon: Clock, label: "Queued" },
};

interface SprintBubbleProps {
    sprint: Sprint;
    isEven: boolean;
    accentColor: string;
}

export const SprintBubble: FunctionComponent<SprintBubbleProps> = ({
    sprint,
    isEven,
    accentColor,
}) => {
    const bubbleRef = useRef<HTMLDivElement>(null);
    const anim = isEven ? 'animate-organic' : 'animate-organic-reverse';
    const state = statusMap[sprint.status];
    const StatusIcon = state.icon;

    const handleHoverEnter = () => {
        if (!bubbleRef.current) return;
        gsap.to(bubbleRef.current, {
            scale: 1.05,
            rotation: (Math.random() - 0.5) * 4,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto",
        });
    };

    const handleHoverLeave = () => {
        if (!bubbleRef.current) return;
        gsap.to(bubbleRef.current, {
            scale: 1,
            rotation: 0,
            duration: 1,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto",
        });
    };

    return (
        <div
            ref={bubbleRef}
            onMouseEnter={handleHoverEnter}
            onMouseLeave={handleHoverLeave}
            className="relative group cursor-pointer perspective-1000 flex items-center justify-center shrink-0 w-72 h-72 lg:w-80 lg:h-80"
        >
            {/* Shadow underlay */}
            <div className={`absolute inset-0 shadow-[0_24px_64px_rgba(0,0,0,0.07)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.4)] transition-all duration-700 pointer-events-none ${anim}`} />

            {/* Liquid container */}
            <div
                className={`absolute inset-0 bg-white/50 dark:bg-void-800/60 backdrop-blur-3xl transition-all duration-700 overflow-hidden transform-gpu border border-white/60 dark:border-white/[0.05] ${anim}`}
                style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
            >
                <div className={`absolute inset-0 pointer-events-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${anim}`} />
                {/* Status ring — matches SourceCell pattern */}
                {state.ring && (
                    <div
                        className={`absolute inset-0 rounded-[50%] bg-transparent border-2 animate-[spin_5s_linear_infinite] scale-105 pointer-events-none mix-blend-screen ${state.ring}`}
                        style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-10px)' }}
                    />
                )}
            </div>

            {/* Content */}
            <div className="relative z-20 flex flex-col items-center justify-center text-center p-8 w-full h-full">
                {/* Status label — shows on hover, same position as SourceCell */}
                <div className={`absolute top-5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${state.text}`}>
                    <StatusIcon className={`w-3.5 h-3.5 ${sprint.status === 'running' ? 'animate-pulse' : ''}`} strokeWidth={2.5} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{state.label}</span>
                </div>

                {/* Sprint ID — hides on hover */}
                <div className={`font-mono font-bold text-xs tracking-[0.15em] mb-3 group-hover:opacity-0 transition-opacity duration-300 ${accentColor}`}>
                    {sprint.id.toUpperCase()}
                </div>

                <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mb-2 px-4 group-hover:scale-105 transition-transform duration-500 font-display">
                    {sprint.name}
                </h3>

                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-500 mt-1.5 mb-7">
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span>{sprint.date}</span>
                </div>

                <div className="flex gap-7 text-center group-hover:-translate-y-3 transition-transform duration-500">
                    <div className="flex flex-col items-center">
                        <div className={`text-2xl font-mono font-bold text-slate-900 dark:text-white group-hover:${accentColor} transition-colors`}>{sprint.tasksCount}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-0.5">Tasks</div>
                    </div>
                    <div className="w-px h-10 bg-black/[0.08] dark:bg-white/[0.08]" />
                    <div className="flex flex-col items-center">
                        <div className={`text-2xl font-mono font-bold text-slate-900 dark:text-white group-hover:${accentColor} transition-colors`}>{sprint.completion}%</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-0.5">Done</div>
                    </div>
                </div>

                <CellActions 
                    isRunning={sprint.status === 'running'} 
                    label="View Tasks" 
                    to={`/tasks?sprint=${sprint.id}`} 
                />
            </div>
        </div>
    );
};
