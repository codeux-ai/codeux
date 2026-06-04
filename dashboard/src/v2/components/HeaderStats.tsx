import type { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { Sparkline } from "./ui/Sparkline.js";
import { StatsCard } from "../pages/stats/components/StatsCard.js";
import { SkeletonCard } from "./layout/SkeletonLoader.js";
import { computeOverviewStats } from "../lib/overview-stats.js";
import { formatTokens } from "../pages/stats/stats-utils.js";

export const HeaderStats: FunctionComponent<{ pageData: ReturnType<typeof import("../hooks/use-overview-page-data.js").useOverviewPageData> }> = ({ pageData }) => {
    const { projects, selectedProject, sprints, tasks, stats: statsSnapshot, isLoading } = pageData;

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">

            {/* Card 1: Total Tokens */}
            <StatsCard
                title="Total Tokens"
                value={formatTokens(stats.totalTokens)}
                accent="signal"
                trend={<div className="w-2 h-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />}
            >
                <Sparkline points={stats.tokensTrend} color="#00E0A0" />
                <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                    <div className="flex justify-between items-center text-xs font-mono font-medium">
                        <span className="text-slate-400">PROJECT</span>
                        <span className="text-slate-700 dark:text-slate-300 truncate ml-4">{selectedProject?.name || "None"}</span>
                    </div>
                </div>
            </StatsCard>

            {/* Card 2: Sprints */}
            <StatsCard
                title="Sprints"
                value={String(stats.totalSprints)}
                accent="cyan"
                trend={<div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(0,170,255,0.6)]" />}
            >
                <Sparkline points={stats.sprintsTrend} color="#00AAFF" />
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
            </StatsCard>

            {/* Card 3: Open Tasks */}
            <StatsCard
                title="Open Tasks"
                value={String(stats.openTasks)}
                accent="amber"
                trend={<div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(255,184,0,0.6)] animate-pulse" />}
                description={<span className="text-ember-600 dark:text-ember-500 text-xs font-bold font-mono">{stats.runningTasks} live</span>}
            >
                <Sparkline points={stats.openTasksTrend} color="#FFB800" />
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
            </StatsCard>

            {/* Card 4: Completed Tasks */}
            <StatsCard
                title="Completed Tasks"
                value={String(stats.completedTasks)}
                accent="signal"
                trend={
                    <div className="relative w-2 h-2">
                        <div className="w-full h-full rounded-full bg-signal-500 relative z-10 shadow-[0_0_10px_rgba(0,224,160,0.7)]" />
                        <div className="absolute inset-0 bg-signal-500 rounded-full animate-ping opacity-60" />
                    </div>
                }
                description={
                    <span className="text-signal-600 dark:text-signal-500 text-xs font-bold font-mono">
                        {stats.completedTasks + stats.openTasks > 0
                            ? `${Math.round((stats.completedTasks / (stats.completedTasks + stats.openTasks)) * 100)}%`
                            : "0%"}
                    </span>
                }
            >
                <Sparkline points={stats.completedTasksTrend} color="#00E0A0" />
                <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                    <div className="flex justify-between items-center text-xs font-mono font-medium">
                        <span className="text-slate-400">OPEN</span>
                        <span className="text-slate-700 dark:text-slate-300">{stats.openTasks}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs font-mono font-medium">
                        <span className="text-slate-400">TOTAL</span>
                        <span className="text-slate-700 dark:text-slate-300">{stats.completedTasks + stats.openTasks}</span>
                    </div>
                </div>
            </StatsCard>

        </div>
    );
};
