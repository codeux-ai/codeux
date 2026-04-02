import type { FunctionComponent } from "preact";
import { useRef, useCallback } from "preact/hooks";
import gsap from "gsap";
import { FolderGit2, Activity, AlertTriangle, XCircle } from "lucide-preact";
import type { Source } from "../../types.js";
import { CellActions } from "./CellActions.js";

const statusMap = {
    running:      { ring: 'border-status-green/50 shadow-[0_0_28px_rgba(0,171,132,0.35)]', text: 'text-status-green', icon: Activity,       label: "Running"     },
    failed:       { ring: 'border-status-red/60 shadow-[0_0_28px_rgba(227,0,15,0.35)]',   text: 'text-status-red',   icon: XCircle,        label: "Failed"      },
    intervention: { ring: 'border-status-amber/50 shadow-[0_0_28px_rgba(245,158,11,0.3)]', text: 'text-status-amber', icon: AlertTriangle,  label: "Needs Review" },
    idle:         { ring: '',                                                               text: 'text-slate-400 dark:text-slate-500', icon: FolderGit2, label: "Idle" },
} as const;

interface SourceCellProps {
    source: Source;
    isEven: boolean;
    animDelay?: number;
}

export const SourceCell: FunctionComponent<SourceCellProps> = ({ source, isEven, animDelay = 0 }) => {
    const cellRef = useRef<HTMLDivElement>(null);
    const anim = isEven ? 'animate-organic' : 'animate-organic-reverse';
    const state = statusMap[source.status] ?? statusMap.idle;
    const StatusIcon = state.icon;

    const handleHoverEnter = useCallback(() => {
        if (!cellRef.current) return;
        gsap.to(cellRef.current, {
            scale: 1.08,
            rotation: (Math.random() - 0.5) * 8,
            duration: 0.6,
            ease: "back.out(2)",
            overwrite: true,
        });
    }, []);

    const handleHoverLeave = useCallback(() => {
        if (!cellRef.current) return;
        gsap.to(cellRef.current, {
            scale: 1,
            rotation: 0,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: true,
        });
    }, []);

    return (
        <div
            ref={cellRef}
            onMouseEnter={handleHoverEnter}
            onMouseLeave={handleHoverLeave}
            onFocus={handleHoverEnter}
            onBlur={handleHoverLeave}
            role="group"
            tabIndex={0}
            className="relative group cursor-pointer w-56 h-56 flex items-center justify-center shrink-0 perspective-1000 focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-[2rem] focus:outline-none"
            style={{ animationDelay: `${animDelay}s` }}
        >
            {/* Shadow underlay */}
            <div className={`absolute inset-0 shadow-[0_24px_48px_rgba(0,0,0,0.07)] dark:shadow-[0_24px_48px_rgba(0,0,0,0.5)] transition-all duration-700 pointer-events-none ${anim}`} />

            {/* Liquid cell body */}
            <div
                className={`absolute inset-0 bg-white/55 dark:bg-void-800/65 backdrop-blur-3xl border border-white/70 dark:border-white/[0.06] overflow-hidden transition-all duration-700 transform-gpu ${anim}`}
                style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
            >
                <div className={`absolute inset-0 pointer-events-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${anim}`} />
                {state.ring && (
                    <div
                        className={`absolute inset-0 rounded-[50%] bg-transparent border-2 animate-[spin_5s_linear_infinite] scale-105 pointer-events-none mix-blend-screen ${state.ring}`}
                        style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-10px)' }}
                    />
                )}
            </div>

            {/* Content */}
            <div className="relative z-20 flex flex-col items-center justify-center text-center p-5 w-full h-full transform-gpu group-hover:translate-z-12 transition-transform duration-500 ease-out">
                {/* Status label on hover */}
                <div className={`absolute top-5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${state.text}`}>
                    <StatusIcon className={`w-3.5 h-3.5 ${source.status === 'running' ? 'animate-pulse' : ''}`} strokeWidth={2.5} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{state.label}</span>
                </div>

                {/* Main icon */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-400 group-hover:opacity-0 transition-opacity duration-300 mb-2">
                    <FolderGit2 className="w-7 h-7" strokeWidth={1} />
                </div>

                <h4 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate w-full px-3 mt-1 group-hover:-translate-y-3 transition-transform duration-300 font-mono">
                    {source.name}
                </h4>

                <div className="mt-1.5 flex gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400 group-hover:opacity-0 transition-opacity duration-300">
                    <span>{source.openTasks} open</span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span>{source.completedTasks} done</span>
                </div>

                {/* Actions */}
                <CellActions 
                    isRunning={source.status === 'running'} 
                    to={`/projects?id=${source.id}`}
                />
            </div>
        </div>
    );
};
