import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Target, ArrowRight, Activity, CalendarDays, Play, Square, Settings, Maximize2 } from "lucide-preact";
import { mockSprints } from "./lib/mockData.js";

export const SprintsPage: FunctionComponent = () => {
    const mainRef = useRef<HTMLDivElement>(null);
    const bubblesRef = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        if (mainRef.current) {
            gsap.fromTo(mainRef.current.children,
                { opacity: 0, y: 50 },
                { opacity: 1, y: 0, stagger: 0.15, duration: 1.2, ease: "power4.out", delay: 0.2 }
            );
        }
    }, []);

    const handleHoverEnter = (index: number) => {
        if (!bubblesRef.current[index]) return;
        gsap.to(bubblesRef.current[index], {
            scale: 1.05,
            rotation: (Math.random() - 0.5) * 5,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto"
        });
    };

    const handleHoverLeave = (index: number) => {
        if (!bubblesRef.current[index]) return;
        gsap.to(bubblesRef.current[index], {
            scale: 1,
            rotation: 0,
            duration: 1,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto"
        });
    };

    return (
        <div ref={mainRef} className="max-w-[1920px] mx-auto px-6 md:px-12 py-32 flex flex-col gap-24 relative z-10 font-outfit">

            {/* Cinematic Typography Header */}
            <div className="flex flex-col gap-6 max-w-4xl">
                <div className="flex items-center gap-3 text-fuchsia-500 font-bold tracking-widest uppercase text-sm">
                    <Target className="w-5 h-5" strokeWidth={2.5} />
                    Iteration Cycles
                </div>
                <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.9]">
                    Active <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 to-indigo-500 inline-block mt-2">Sprints.</span>
                </h1>
                <p className="text-xl text-slate-500 dark:text-slate-400 font-medium max-w-2xl mt-4 leading-relaxed">
                    Watch your orchestrations evolve. Liquid execution streams mapping out your source integrations in real-time.
                </p>
            </div>

            {/* Organic Sprint Bubbles */}
            <div className="flex flex-wrap gap-16 justify-center lg:justify-start">
                {mockSprints?.map((sprint, index) => {
                    const isEven = index % 2 === 0;
                    return (
                        <div
                            key={sprint.id}
                            ref={el => { if (el) bubblesRef.current[index] = el; }}
                            onMouseEnter={() => handleHoverEnter(index)}
                            onMouseLeave={() => handleHoverLeave(index)}
                            className="relative group cursor-pointer perspective-1000 flex items-center justify-center shrink-0 w-80 h-80 lg:w-96 lg:h-96"
                            style={{ animationDelay: `${index * 0.3}s` }}
                        >
                            {/* Shadow Underlay (Unmasked) */}
                            <div className={`absolute inset-0 shadow-[0_30px_80px_rgba(0,0,0,0.08)] dark:shadow-[0_30px_80px_rgba(0,0,0,0.4)] transition-all duration-700 pointer-events-none ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`} />

                            {/* The Liquid Container */}
                            <div
                                className={`absolute inset-0 bg-white/40 dark:bg-black/40 backdrop-blur-3xl transition-all duration-700 overflow-hidden transform-gpu ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`}
                                style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
                            >
                                <div className={`absolute inset-0 pointer-events-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] ${isEven ? 'animate-organic' : 'animate-organic-reverse'}`} />
                            </div>

                            {/* Internal Content */}
                            <div className="relative z-20 flex flex-col items-center justify-center text-center p-8 w-full h-full transform-gpu group-hover:translate-z-12 transition-transform duration-700 ease-out">
                                <div className="text-fuchsia-500 font-mono font-bold text-sm tracking-widest mb-4 opacity-80 group-hover:opacity-100 transition-opacity">
                                    {sprint.id.toUpperCase()}
                                </div>
                                <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mb-2 px-4 group-hover:scale-105 transition-transform duration-500">
                                    {sprint.name}
                                </h3>

                                <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 mt-2 mb-8">
                                    <CalendarDays className="w-4 h-4" />
                                    <span>{sprint.date}</span>
                                </div>

                                <div className="flex gap-8 text-center group-hover:-translate-y-4 transition-transform duration-500">
                                    <div className="flex flex-col items-center">
                                        <div className="text-3xl font-mono font-bold text-slate-900 dark:text-white group-hover:text-indigo-400 transition-colors">{sprint.tasksCount}</div>
                                        <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Tasks</div>
                                    </div>
                                    <div className="w-px h-12 bg-slate-200 dark:bg-white/10" />
                                    <div className="flex flex-col items-center">
                                        <div className="text-3xl font-mono font-bold text-slate-900 dark:text-white group-hover:text-fuchsia-400 transition-colors">{sprint.completion}%</div>
                                        <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Done</div>
                                    </div>
                                </div>

                                {/* AAA Quick Actions Bar */}
                                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-slate-900/80 dark:bg-white/90 backdrop-blur-md rounded-full opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 delay-150 ease-out shadow-2xl scale-95 group-hover:scale-100">
                                    <button className="p-2.5 text-white dark:text-obsidian-900 hover:bg-white/20 dark:hover:bg-black/10 rounded-full transition-colors" title="Play/Stop Sprint">
                                        {index % 2 === 0 ? <Play className="w-3.5 h-3.5" fill="currentColor" /> : <Square className="w-3.5 h-3.5" fill="currentColor" />}
                                    </button>
                                    <button className="p-2.5 text-white dark:text-obsidian-900 hover:bg-white/20 dark:hover:bg-black/10 rounded-full transition-colors" title="Edit Configuration">
                                        <Settings className="w-4 h-4" />
                                    </button>
                                    <button className="pr-4 pl-2 text-xs font-bold text-white dark:text-obsidian-900 hover:text-fuchsia-400 dark:hover:text-aura-600 transition-colors flex items-center gap-1 uppercase tracking-widest" title="Open Dashboard">
                                        Open <Maximize2 className="w-3 h-3" />
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
