import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useMemo } from "preact/hooks";
import gsap from "gsap";
import { MetricCard } from "./ui/MetricCard.js";
import { Sparkline } from "./ui/Sparkline.js";
import { SkeletonCard } from "./ui/ListSkeletons.js";
import { computeOverviewStats } from "../lib/overview-stats.js";
import { formatTokens } from "../pages/stats/stats-utils.js";

export const HeaderStats: FunctionComponent<{ pageData: ReturnType<typeof import("../hooks/use-overview-page-data.js").useOverviewPageData> }> = ({ pageData }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { projects, selectedProject, sprints, tasks, stats: statsSnapshot, isLoading } = pageData;

    useLayoutEffect(() => {
        if (containerRef.current) {
            gsap.fromTo(
                containerRef.current.children,
                { y: 24, opacity: 0, scale: 0.97 },
                { y: 0, opacity: 1, scale: 1, duration: 0.9, stagger: 0.12, ease: "power3.out", delay: 0.15 }
            );
        }
    }, []);

    const stats = useMemo(() => computeOverviewStats(projects, sprints, tasks, statsSnapshot), [projects, sprints, tasks, statsSnapshot]);

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        );
    }

    return (
        <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">

            {/* Card 1: Total Tokens */}
            <MetricCard hoverTint="group-hover:bg-signal-500/[0.025]" accentHex="#00E0A0">
                <Sparkline points={stats.tokensTrend} color="#00E0A0" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-signal-600 dark:group-hover:text-signal-400 transition-colors">Total Tokens</h3>
                    <div className="w-2 h-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />
                </div>
                <div className="relative z-10">
                    <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">
                        {formatTokens(stats.totalTokens)}
                    </span>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">PROJECT</span>
                            <span className="text-slate-700 dark:text-slate-300">{selectedProject?.name || "None"}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 2: Sprints */}
            <MetricCard hoverTint="group-hover:bg-cyan-500/[0.025]" accentHex="#00AAFF">
                <Sparkline points={stats.sprintsTrend} color="#00AAFF" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">Sprints</h3>
                    <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(0,170,255,0.6)]" />
                </div>
                <div className="relative z-10">
                    <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">
                        {stats.totalSprints}
                    </span>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">ACTIVE</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.activeSprints}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">COMPLETE</span>
                            <span className="text-slate-700 dark:text-slate-300">{Math.max(stats.totalSprints - stats.activeSprints, 0)}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 3: Open Tasks */}
            <MetricCard hoverTint="group-hover:bg-amber-500/[0.025]" accentHex="#FFB800">
                <Sparkline points={stats.openTasksTrend} color="#FFB800" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">Open Tasks</h3>
                    <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(255,184,0,0.6)] animate-pulse" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">{stats.openTasks}</span>
                        <span className="text-amber-500 text-xs font-bold font-mono">{stats.runningTasks} live</span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">RUNNING</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.runningTasks}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">CRITICAL</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.criticalTasks}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 4: Completed Tasks */}
            <MetricCard hoverTint="group-hover:bg-signal-500/[0.025]" accentHex="#00E0A0">
                <Sparkline points={stats.completedTasksTrend} color="#00E0A0" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-signal-600 dark:group-hover:text-signal-400 transition-colors">Completed Tasks</h3>
                    <div className="relative w-2 h-2">
                        <div className="w-full h-full rounded-full bg-signal-500 relative z-10 shadow-[0_0_10px_rgba(0,224,160,0.7)]" />
                        <div className="absolute inset-0 bg-signal-500 rounded-full animate-ping opacity-60" />
                    </div>
                </div>
                <div className="relative z-10">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">{stats.completedTasks}</span>
                        <span className="text-signal-500 text-xs font-bold font-mono">
                            {stats.completedTasks + stats.openTasks > 0
                                ? `${Math.round((stats.completedTasks / (stats.completedTasks + stats.openTasks)) * 100)}%`
                                : "0%"}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-status-red/10 pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">OPEN</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.openTasks}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">TOTAL</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.completedTasks + stats.openTasks}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

        </div>
    );
};
