import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { FolderGit2, Activity, Play, Square, Settings, Maximize2, AlertTriangle, XCircle } from "lucide-preact";
import { mockSources } from "../lib/mockData.js";

export const SourcesGrid: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cellsRef = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        if (containerRef.current) {
            gsap.fromTo(
                containerRef.current.children,
                { y: 50, opacity: 0, scale: 0.9 },
                {
                    y: 0,
                    opacity: 1,
                    scale: 1,
                    duration: 1.1,
                    stagger: { amount: 0.7, from: "center" },
                    ease: "elastic.out(1, 0.7)",
                    delay: 0.1
                }
            );
        }
    }, []);

    const handleHoverEnter = (index: number) => {
        if (!cellsRef.current[index]) return;
        gsap.to(cellsRef.current[index], {
            scale: 1.08,
            rotation: (Math.random() - 0.5) * 8,
            duration: 0.6,
            ease: "back.out(2)",
            overwrite: true
        });
    };

    const handleHoverLeave = (index: number) => {
        if (!cellsRef.current[index]) return;
        gsap.to(cellsRef.current[index], {
            scale: 1,
            rotation: 0,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: true
        });
    };

    const recentSources = [...mockSources].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ).slice(0, 6);

    return (
        <div className="w-full relative z-10">
            {/* Section Header */}
            <div className="flex items-end justify-between mb-16 px-2 overflow-hidden">
                <div className="relative">
                    <h2 className="text-[6rem] font-black tracking-tighter text-black/[0.04] dark:text-white/[0.04] absolute -top-8 -left-3 pointer-events-none select-none font-display leading-none overflow-hidden">DATA</h2>
                    <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white relative z-10 flex items-center gap-2.5">
                        <Activity className="w-5 h-5 text-signal-500" strokeWidth={2.5} />
                        Projects &amp; Sources
                    </h3>
                </div>
            </div>

            <div
                ref={containerRef}
                className="flex flex-wrap justify-center gap-10 md:gap-14 lg:gap-20"
            >
                {recentSources.map((source, index) => {
                    const isEven = index % 2 === 0;

                    // Status-driven semantic colors
                    const statusMap: Record<string, { ring: string, text: string, icon: any, label: string }> = {
                        running:      { ring: 'border-status-green/50 shadow-[0_0_28px_rgba(0,171,132,0.35)]', text: 'text-status-green', icon: Activity, label: "Running" },
                        failed:       { ring: 'border-status-red/60 shadow-[0_0_28px_rgba(227,0,15,0.35)]',   text: 'text-status-red',   icon: XCircle,   label: "Failed" },
                        intervention: { ring: 'border-status-amber/50 shadow-[0_0_28px_rgba(245,158,11,0.3)]',text: 'text-status-amber', icon: AlertTriangle, label: "Needs Review" },
                        idle:         { ring: '', text: 'text-slate-400 dark:text-slate-500', icon: FolderGit2, label: "Idle" }
                    };
                    const state = statusMap[(source as any).status] || statusMap.idle;
                    const StatusIcon = state.icon;

                    return (
                        <div
                            key={source.id}
                            ref={el => { if (el) cellsRef.current[index] = el; }}
                            onMouseEnter={() => handleHoverEnter(index)}
                            onMouseLeave={() => handleHoverLeave(index)}
                            className="relative group cursor-pointer w-56 h-56 flex items-center justify-center shrink-0 perspective-1000"
                            style={{ animationDelay: `${index * 0.5}s` }}
                        >
                            {/* Shadow underlay */}
                            <div className={`absolute inset-0 shadow-[0_24px_48px_rgba(0,0,0,0.07)] dark:shadow-[0_24px_48px_rgba(0,0,0,0.5)] transition-all duration-700 pointer-events-none ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`} />

                            {/* Liquid cell body */}
                            <div
                                className={`absolute inset-0 bg-white/55 dark:bg-void-800/65 backdrop-blur-3xl border border-white/70 dark:border-white/[0.06] overflow-hidden transition-all duration-700 transform-gpu ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`}
                                style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
                            >
                                <div className={`absolute inset-0 pointer-events-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`} />

                                {/* Status ring */}
                                {state.ring && (
                                    <div className={`absolute inset-0 rounded-[50%] bg-transparent border-2 animate-[spin_5s_linear_infinite] scale-105 pointer-events-none mix-blend-screen ${state.ring}`} style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-10px)' }} />
                                )}
                            </div>

                            {/* Content */}
                            <div className="relative z-20 flex flex-col items-center justify-center text-center p-5 w-full h-full transform-gpu group-hover:translate-z-12 transition-transform duration-500 ease-out">
                                {/* Status label on hover */}
                                <div className={`absolute top-5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${state.text}`}>
                                    <StatusIcon className={`w-3.5 h-3.5 ${(source as any).status === 'running' ? 'animate-pulse' : ''}`} strokeWidth={2.5} />
                                    <span className="text-[10px] font-bold uppercase tracking-widest">{state.label}</span>
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
                                <div className="absolute bottom-5 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 w-full">
                                    <button className="flex items-center justify-center w-9 h-9 bg-black/[0.06] dark:bg-white/[0.07] hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-slate-800 dark:text-white transition-colors" title={source.isRunning ? "Stop" : "Play"}>
                                        {source.isRunning ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5" fill="currentColor" />}
                                    </button>
                                    <button className="flex items-center gap-1.5 px-4 h-9 bg-slate-900 dark:bg-white hover:opacity-85 rounded-full text-white dark:text-void-900 font-bold text-xs tracking-wide transition-all shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
                                        Open <Maximize2 className="w-3 h-3" />
                                    </button>
                                    <button className="flex items-center justify-center w-9 h-9 bg-black/[0.06] dark:bg-white/[0.07] hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-slate-800 dark:text-white transition-colors" title="Settings">
                                        <Settings className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
