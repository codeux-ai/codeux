import type { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { Sparkline } from "./ui/Sparkline.js";
import { StatsCard } from "../pages/stats/components/StatsCard.js";
import { SkeletonCard } from "./layout/SkeletonLoader.js";
import { computeOverviewStats, formatOverviewCost, formatOverviewDuration, formatOverviewTokens } from "../lib/overview-stats.js";
import { useDashboardI18n } from "../i18n/index.js";
import { overviewMessages } from "../i18n/messages/overview.js";

const OverviewCardSparkline: FunctionComponent<{ points: number[]; color: string }> = ({ points, color }) => (
  <div
    className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-14 overflow-hidden rounded-b-[inherit] [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.2)_18%,black_58%)]"
    aria-hidden="true"
  >
    <Sparkline points={points} color={color} className="pointer-events-none absolute -bottom-5 left-0 h-20 w-full" />
  </div>
);

export const HeaderStats: FunctionComponent<{ pageData: ReturnType<typeof import("../hooks/use-overview-page-data.js").useOverviewPageData> }> = ({ pageData }) => {
  const { projects, selectedProject, sprints, tasks, stats: statsSnapshot, isLoading } = pageData;
  const { formatNumber, translate, translatePlural } = useDashboardI18n();

  const stats = useMemo(() => computeOverviewStats(projects, sprints, tasks, statsSnapshot), [projects, sprints, tasks, statsSnapshot]);
  const usage = statsSnapshot?.usage;
  const totalTasks = stats.completedTasks + stats.openTasks;
  const completionRate = totalTasks > 0 ? Math.round((stats.completedTasks / totalTasks) * 100) : 0;
  const completedSprints = Math.max(stats.totalSprints - stats.activeSprints, 0);
  const activeTime = formatOverviewDuration(usage?.activeTimeMs ?? 0, formatNumber);
  const invocationCount = usage?.invocationCount ?? 0;
  const activeSprintLabel = statsSnapshot?.activeSprint
    ? `#${statsSnapshot.activeSprint.sprintNumber == null ? "-" : formatNumber(statsSnapshot.activeSprint.sprintNumber)}`
    : translate(overviewMessages, "none");

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" aria-label={translate(overviewMessages, "loadingOverviewStats")} className="grid w-full grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        <span className="sr-only">{translate(overviewMessages, "loadingOverviewStatsAnnouncement")}</span>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div role="region" aria-label={translate(overviewMessages, "overviewMetricCards")} className="grid w-full grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
      <StatsCard
        title={translate(overviewMessages, "totalTokens")}
        value={formatOverviewTokens(stats.totalTokens, formatNumber)}
        accent="signal"
        className="min-h-[15.5rem] overflow-hidden"
        trend={<div className="h-2 w-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]"><span className="sr-only">{translate(overviewMessages, "tokenTelemetryActive")}</span></div>}
      >
        <OverviewCardSparkline points={stats.tokensTrend} color="#00E0A0" />
        <div className="relative z-10 mt-4 flex flex-col gap-1 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "project")}</span>
            <span className="min-w-0 truncate text-right text-slate-700 dark:text-slate-300">{selectedProject?.name || translate(overviewMessages, "none")}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "cost")}</span>
            <span className="text-signal-700 dark:text-signal-400">{formatOverviewCost(usage?.totalCostUsd ?? 0, formatNumber)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "runs")}</span>
            <span className="text-slate-700 dark:text-slate-300">{formatNumber(invocationCount)}</span>
          </div>
        </div>
      </StatsCard>

      <StatsCard
        title={translate(overviewMessages, "sprints")}
        value={formatNumber(stats.totalSprints)}
        accent="cyan"
        className="min-h-[15.5rem] overflow-hidden"
        trend={<div className="h-2 w-2 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(0,170,255,0.6)]"><span className="sr-only">{translate(overviewMessages, "sprintTelemetryAvailable")}</span></div>}
      >
        <OverviewCardSparkline points={stats.sprintsTrend} color="#00AAFF" />
        <div className="relative z-10 mt-4 flex flex-col gap-1 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "active")}</span>
            <span className="text-slate-700 dark:text-slate-300">{formatNumber(stats.activeSprints)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "complete")}</span>
            <span className="text-slate-700 dark:text-slate-300">{formatNumber(completedSprints)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "current")}</span>
            <span className="text-cyan-700 dark:text-cyan-300">{activeSprintLabel}</span>
          </div>
        </div>
      </StatsCard>

      <StatsCard
        title={translate(overviewMessages, "openTasks")}
        value={formatNumber(stats.openTasks)}
        accent="amber"
        className="min-h-[15.5rem] overflow-hidden"
        trend={<div className="motion-safe:animate-pulse h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(255,184,0,0.6)]"><span className="sr-only">{translatePlural(overviewMessages, "liveTaskCount", stats.runningTasks, { formattedCount: formatNumber(stats.runningTasks) })}</span></div>}
        description={<span className="text-xs font-bold text-ember-600 font-mono dark:text-ember-500">{translate(overviewMessages, "liveCount", { count: formatNumber(stats.runningTasks) })}</span>}
      >
        <OverviewCardSparkline points={stats.openTasksTrend} color="#FFB800" />
        <div className="relative z-10 mt-4 flex flex-col gap-1 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "running")}</span>
            <span className="text-slate-700 dark:text-slate-300">{formatNumber(stats.runningTasks)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "critical")}</span>
            <span className={stats.criticalTasks > 0 ? "text-status-red" : "text-slate-700 dark:text-slate-300"}>{formatNumber(stats.criticalTasks)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "health")}</span>
            <span className={stats.criticalTasks > 0 ? "text-status-red" : "text-signal-700 dark:text-signal-400"}>{translate(overviewMessages, stats.criticalTasks > 0 ? "review" : "clear")}</span>
          </div>
        </div>
      </StatsCard>

      <StatsCard
        title={translate(overviewMessages, "completedTasks")}
        value={formatNumber(stats.completedTasks)}
        accent="signal"
        className="min-h-[15.5rem] overflow-hidden"
        trend={
          <div className="relative h-2 w-2">
            <div className="relative z-10 h-full w-full rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.7)]" />
            <div className="motion-safe:animate-ping absolute inset-0 rounded-full bg-signal-500 opacity-60" />
            <span className="sr-only">{translate(overviewMessages, "completionTelemetryUpdated")}</span>
          </div>
        }
        description={
          <span className="text-xs font-bold text-signal-600 font-mono dark:text-signal-500">
            {formatNumber(completionRate / 100, { style: "percent", maximumFractionDigits: 0 })}
          </span>
        }
      >
        <OverviewCardSparkline points={stats.completedTasksTrend} color="#00E0A0" />
        <div className="relative z-10 mt-4 flex flex-col gap-1 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "open")}</span>
            <span className="text-slate-700 dark:text-slate-300">{formatNumber(stats.openTasks)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "total")}</span>
            <span className="text-slate-700 dark:text-slate-300">{formatNumber(totalTasks)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium font-mono">
            <span className="text-slate-400">{translate(overviewMessages, "activeTime")}</span>
            <span className="text-slate-700 dark:text-slate-300">{activeTime}</span>
          </div>
        </div>
      </StatsCard>
    </div>
  );
};
