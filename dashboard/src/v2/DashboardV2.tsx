import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { HeaderStats } from "./components/HeaderStats.js";
import { SourcesGrid } from "./components/SourcesGrid.js";
import { TasksList } from "./components/TasksList.js";

export const DashboardV2: FunctionComponent = () => {
    const mainContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (mainContentRef.current) {
            gsap.fromTo(
                mainContentRef.current.children,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, duration: 1, stagger: 0.12, ease: "power4.out", delay: 0.05 }
            );
        }
    }, []);

    return (
        <div ref={mainContentRef} className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-24">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between w-full gap-6">
                <div>
                    <h2 className="text-5xl md:text-6xl font-black tracking-tighter text-slate-900 dark:text-white mb-4 font-display leading-[0.95]">
                        Overview.
                    </h2>
                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl leading-relaxed">
                        Real-time metrics and operational intelligence across your cluster.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full bg-signal-500/8 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border border-signal-500/15 dark:border-signal-500/20 flex items-center gap-2.5 shadow-[0_0_20px_rgba(0,224,160,0.08)] backdrop-blur-md">
                        <span className="w-2 h-2 rounded-full bg-signal-500 relative">
                            <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />
                        </span>
                        Cluster Optimal
                    </div>
                </div>
            </div>

            {/* Metrics Section */}
            <section className="w-full relative z-20">
                <HeaderStats />
            </section>

            {/* Section Divider */}
            <div className="w-full flex items-center justify-center py-4 relative z-10 overflow-hidden">
                <div className="absolute inset-y-1/2 inset-x-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
                <div className="bg-[#F9F8F4] dark:bg-void-900 px-6 py-1.5 border border-black/[0.06] dark:border-white/[0.06] rounded-full shadow-sm relative z-10 text-[9px] font-bold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-600">
                    Data Streams
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-20 flex-grow relative z-20">
                {/* Sources and Tasks */}
                <div className="xl:col-span-8 flex flex-col gap-24">
                    <section className="w-full relative">
                        {/* Subtle signal glow — very restrained */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-signal-500/3 dark:bg-signal-500/5 rounded-full blur-[100px] pointer-events-none -z-10" />
                        <SourcesGrid />
                    </section>

                    <section className="w-full relative">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[130%] bg-ember-500/3 dark:bg-ember-500/4 rounded-full blur-[80px] pointer-events-none -z-10" />
                        <TasksList />
                    </section>
                </div>

                {/* Live Telemetry */}
                <div className="xl:col-span-4 h-full relative">
                    <aside className="sticky top-24 flex flex-col h-[760px] overflow-hidden group">
                        <h3 className="text-3xl font-black tracking-tighter text-slate-900 dark:text-white mb-12 flex items-center gap-4 font-display">
                            <div className="relative flex items-center justify-center">
                                <div className="absolute inset-0 bg-status-red rounded-full blur-[10px] animate-[pulse_2s_ease-in-out_infinite] opacity-70" />
                                <div className="w-3.5 h-3.5 rounded-full bg-status-red relative z-10" />
                            </div>
                            Telemetry.
                        </h3>

                        {/* Holographic Radar */}
                        <div className="flex-grow flex items-center justify-center relative overflow-hidden">
                            {/* Radar rings */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-48 h-48 rounded-full border border-black/[0.07] dark:border-white/[0.08] animate-[ping_4s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
                                <div className="w-72 h-72 rounded-full border border-black/[0.04] dark:border-white/[0.05] absolute animate-[ping_7s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
                                <div className="w-[22rem] h-[22rem] rounded-full border border-black/[0.02] dark:border-white/[0.03] absolute animate-[ping_10s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
                            </div>
                            {/* Floating content — no box, no background */}
                            <div className="text-center relative z-10">
                                <div className="w-14 h-14 rounded-[1.25rem] border border-black/[0.07] dark:border-white/[0.07] shadow-[0_0_28px_rgba(227,0,15,0.12)] mx-auto mb-5 flex items-center justify-center group-hover:rotate-[180deg] group-hover:scale-110 transition-all duration-1000 ease-out">
                                    <svg className="w-7 h-7 text-status-red opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <span className="text-slate-500 dark:text-slate-500 font-semibold text-sm tracking-widest block uppercase font-display">Awaiting Stream</span>
                                <span className="text-xs text-status-red/60 font-mono mt-2 block animate-pulse">Socket offline</span>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};
