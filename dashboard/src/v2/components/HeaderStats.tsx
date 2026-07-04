import type { ComponentChildren, FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { Sparkline } from "./ui/Sparkline.js";
import { StatsCard } from "../pages/stats/components/StatsCard.js";
import { SkeletonCard } from "./layout/SkeletonLoader.js";
import { computeOverviewStats } from "../lib/overview-stats.js";
import { formatTokens } from "../pages/stats/stats-utils.js";

const METRIC_GRID_CLASS = "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 w-full";

const MetricDetailRow: FunctionComponent<{ label: string; value: string | number }> = ({ label, value }) => (
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs font-mono font-medium">
        <span className="max-w-[8rem] text-balance break-words uppercase tracking-[0.12em] text-slate-400">{label}</span>
        <span className="min-w-0 text-right text-slate-700 dark:text-slate-300 break-words">{value}</span>
    </div>
);

const MetricDetailStack: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => (
    <div className="flex flex-col gap-2 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
        {children}
    </div>
);

export const HeaderStats: FunctionComponent<{ pageData: ReturnType<typeof import("../hooks/use-overview-page-data.js").useOverviewPageData> }> = ({ pageData }) => {
    const { projects, selectedProject, sprints, tasks, stats: statsSnapshot, isLoading } = pageData;

    const stats = useMemo(() => computeOverviewStats(projects, sprints, tasks, statsSnapshot), [projects, sprints, tasks, statsSnapshot]);

    if (isLoading) {
        return (
            <div className={METRIC_GRID_CLASS} role="status" aria-live="polite" aria-label="Loading overview metrics">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        );
    }

    return (
        <div className={METRIC_GRID_CLASS}>

            {/* Card 1: Total Tokens */}
            <StatsCard
                title="Total Tokens"
                value={formatTokens(stats.totalTokens)}
                accent="signal"
                trend={<div className="w-2 h-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />}
                className="min-h-[15rem]"
            >
                <Sparkline points={stats.tokensTrend} color="#00E0A0" />
                <MetricDetailStack>
                    <MetricDetailRow label="Project" value={selectedProject?.name || "None"} />
                </MetricDetailStack>
            </StatsCard>

            {/* Card 2: Sprints */}
            <StatsCard
                title="Sprints"
                value={String(stats.totalSprints)}
                accent="signal"
                trend={<div className="w-2 h-2 rounded-full bg-signal-500/80 shadow-[0_0_10px_rgba(0,224,160,0.36)]" />}
                className="min-h-[15rem]"
            >
                <Sparkline points={stats.sprintsTrend} color="#00E0A0" />
                <MetricDetailStack>
                    <MetricDetailRow label="Active" value={stats.activeSprints} />
                    <MetricDetailRow label="Complete" value={Math.max(stats.totalSprints - stats.activeSprints, 0)} />
                </MetricDetailStack>
            </StatsCard>

            {/* Card 3: Open Tasks */}
            <StatsCard
                title="Open Tasks"
                value={String(stats.openTasks)}
                accent="amber"
                trend={<div className="w-2 h-2 rounded-full bg-ember-500 shadow-[0_0_10px_rgba(255,184,0,0.36)] motion-safe:animate-pulse" />}
                description={<span className="text-ember-600 dark:text-ember-500 text-xs font-bold font-mono">{stats.runningTasks} live</span>}
                className="min-h-[15rem]"
            >
                <Sparkline points={stats.openTasksTrend} color="#FFB800" />
                <MetricDetailStack>
                    <MetricDetailRow label="Running" value={stats.runningTasks} />
                    <MetricDetailRow label="Critical" value={stats.criticalTasks} />
                </MetricDetailStack>
            </StatsCard>

            {/* Card 4: Completed Tasks */}
            <StatsCard
                title="Completed Tasks"
                value={String(stats.completedTasks)}
                accent="signal"
                trend={
                    <div className="relative w-2 h-2">
                        <div className="w-full h-full rounded-full bg-status-green relative z-10 shadow-[0_0_10px_rgba(0,171,132,0.45)]" />
                        <div className="absolute inset-0 bg-status-green rounded-full motion-safe:animate-ping opacity-40" />
                    </div>
                }
                description={
                    <span className="text-status-green text-xs font-bold font-mono">
                        {stats.completedTasks + stats.openTasks > 0
                            ? `${Math.round((stats.completedTasks / (stats.completedTasks + stats.openTasks)) * 100)}%`
                            : "0%"}
                    </span>
                }
                className="min-h-[15rem]"
            >
                <Sparkline points={stats.completedTasksTrend} color="#00E0A0" />
                <MetricDetailStack>
                    <MetricDetailRow label="Open" value={stats.openTasks} />
                    <MetricDetailRow label="Total" value={stats.completedTasks + stats.openTasks} />
                </MetricDetailStack>
            </StatsCard>

        </div>
    );
};
