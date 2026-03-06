import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { FolderGit2, Activity, Play, Square, Settings, Maximize2, CheckCircle2, AlertTriangle, XCircle } from "lucide-preact";
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
                    duration: 1.2,
                    stagger: { amount: 0.8, from: "center" },
                    ease: "elastic.out(1, 0.7)",
                    delay: 0.1
                }
            );
        }
    }, []);

    const handleHoverEnter = (index: number) => {
        if (!cellsRef.current[index]) return;
        gsap.to(cellsRef.current[index], {
            scale: 1.1,
            rotation: (Math.random() - 0.5) * 10,
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

    // Get the most recent 6 sources
    const recentSources = [...mockSources].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ).slice(0, 6);

    // Removed basic gradients, using semantic Pantone colors based on status in render

    return (
        <div className="w-full relative z-10">
            {/* Minimal Cinematic Header */}
            <div className="flex items-end justify-between mb-20 px-4">
                <div className="relative">
                    <h2 className="text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 dark:from-white dark:via-slate-200 dark:to-slate-600 opacity-20 absolute -top-8 -left-4 pointer-events-none select-none">DATA</h2>
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white relative z-10 flex items-center gap-3">
                        <Activity className="w-6 h-6 text-aura-500" strokeWidth={2.5} />
                        Projects &amp; Sources
                    </h3>
                </div>
            </div>

            <div
                ref={containerRef}
                className="flex flex-wrap justify-center gap-12 md:gap-16 lg:gap-24"
            >
                {recentSources.map((source, index) => {
                    const isEven = index % 2 === 0;

                    return (
                        <div
                            key={source.id}
                            ref={el => { if (el) cellsRef.current[index] = el; }}
                            onMouseEnter={() => handleHoverEnter(index)}
                            onMouseLeave={() => handleHoverLeave(index)}
                            className="relative group cursor-pointer w-64 h-64 flex items-center justify-center shrink-0 perspective-1000"
                            style={{ animationDelay: `${index * 0.5}s` }}
                        >
                            {/* Status-Driven Pantone Color Map */}
                            {(() => {
                                const statusColors: Record<string, { ring: string, text: string, icon: any, label: string }> = {
                                    'running': { ring: 'border-pantone-green/50 shadow-[0_0_30px_rgba(0,171,132,0.4)]', text: 'text-pantone-green', icon: Activity, label: "Running" },
                                    'failed': { ring: 'border-pantone-red/60 shadow-[0_0_30px_rgba(227,0,15,0.4)]', text: 'text-pantone-red', icon: XCircle, label: "Failed" },
                                    'intervention': { ring: 'border-pantone-violet/60 shadow-[0_0_30px_rgba(163,0,214,0.4)]', text: 'text-pantone-violet', icon: AlertTriangle, label: "Needs Intervention" },
                                    'idle': { ring: '', text: 'text-slate-500', icon: FolderGit2, label: "Idle" }
                                };
                                const state = statusColors[(source as any).status || 'idle'];
                                const StatusIcon = state.icon;

                                return (
                                    <>
                                        {/* Shadow Underlay (Unmasked) */}
                                        <div className={`absolute inset-0 shadow-[0_30px_60px_rgba(0,0,0,0.1)] dark:shadow-[0_30px_60px_rgba(0,0,0,0.6)] transition-all duration-700 pointer-events-none ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`} />

                                        {/* The Liquid Droplet / Cell Body */}
                                        <div
                                            className={`absolute inset-0 bg-white/50 dark:bg-obsidian-900/60 backdrop-blur-3xl border border-white/60 dark:border-white/5 overflow-hidden transition-all duration-700 transform-gpu ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`}
                                            style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
                                        >

                                            {/* Inner stroke to highlight liquid shape */}
                                            <div className={`absolute inset-0 pointer-events-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`} />

                                            {/* AAA Running Status Aura (Semantic Color) */}
                                            {state.ring && (
                                                <div className={`absolute inset-0 rounded-[50%] bg-transparent border-2 animate-[spin_4s_linear_infinite] scale-105 pointer-events-none mix-blend-screen ${state.ring}`} style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-10px)' }} />
                                            )}
                                        </div>

                                        {/* Floating Content inside the Cell */}
                                        <div className="relative z-20 flex flex-col items-center justify-center text-center p-6 w-full h-full transform-gpu group-hover:translate-z-12 transition-transform duration-500 ease-out">

                                            {/* Status Explanation (Hover State) */}
                                            <div className={`absolute top-6 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${state.text}`}>
                                                <StatusIcon className={`w-4 h-4 ${(source as any).status === 'running' ? 'animate-pulse' : ''}`} strokeWidth={2.5} />
                                                <span className="text-xs font-bold uppercase tracking-widest">{state.label}</span>
                                            </div>

                                            {/* Main Icon (Fades on hover) */}
                                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-slate-700 dark:text-slate-300 group-hover:opacity-0 transition-opacity duration-300 mb-2">
                                                <FolderGit2 className="w-8 h-8" strokeWidth={1} />
                                            </div>

                                            <h4 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate w-full px-2 mt-2 group-hover:-translate-y-4 transition-transform duration-300">
                                                {source.name}
                                            </h4>

                                            <div className="mt-2 flex gap-4 text-sm font-semibold text-slate-500 dark:text-slate-400 group-hover:opacity-0 transition-opacity duration-300">
                                                <span>Open {source.openTasks}</span>
                                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                                <span>Done {source.completedTasks}</span>
                                            </div>

                                            {/* Integrated Clean Actions */}
                                            <div className="absolute bottom-6 flex items-center justify-center gap-4 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 w-full">
                                                <button className="flex items-center justify-center w-10 h-10 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full text-slate-900 dark:text-white transition-colors" title={source.isRunning ? "Stop" : "Play"}>
                                                    {source.isRunning ? <Square className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" />}
                                                </button>
                                                <button className="flex items-center gap-2 px-4 h-10 bg-slate-900 dark:bg-white hover:opacity-90 rounded-full text-white dark:text-obsidian-900 font-bold text-sm tracking-wide transition-colors">
                                                    Open <Maximize2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button className="flex items-center justify-center w-10 h-10 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full text-slate-900 dark:text-white transition-colors" title="Settings">
                                                    <Settings className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
