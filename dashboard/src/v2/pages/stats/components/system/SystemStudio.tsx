import type { FunctionComponent, ComponentType } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  Activity,
  Clock,
  Database,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Zap,
} from "lucide-preact";
import { useSystemViewData, type SystemSummaryMetrics } from "../../../../pages/stats/hooks/use-system-view-data.js";
import { formatDuration, formatTokens } from "../../stats-utils.js";
import { PANEL_CLASS, SUBPANEL_CLASS, CHIP_CLASS, StudioHeader } from "../StatsShared.js";
import { SystemFilterBar } from "./SystemFilterBar.js";
import { InvocationsTable } from "./InvocationsTable.js";

type SystemTab = "all" | "errors" | "system";

const SystemMetricCard: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: import("preact").ComponentChild;
  circleClassName: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, detail, circleClassName, valueClassName }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-2xl ${circleClassName}`}>
      <Icon className="h-4 w-4" strokeWidth={2.25} />
    </div>
    <div className={`text-3xl font-black tracking-tight ${valueClassName || "text-slate-900 dark:text-white"}`}>
      {value}
    </div>
    <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
      {label}
    </div>
    <div className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
      {detail}
    </div>
  </div>
);

const STATUS_BAR_SEGMENTS: Array<{
  key: keyof Pick<SystemSummaryMetrics, "completedCount" | "runningCount" | "failedCount" | "cancelledCount" | "pausedCount">;
  label: string;
  barClassName: string;
  dotClassName: string;
}> = [
  { key: "completedCount", label: "Completed", barClassName: "bg-emerald-500", dotClassName: "bg-emerald-500" },
  { key: "runningCount", label: "Running", barClassName: "bg-blue-500", dotClassName: "bg-blue-500" },
  { key: "failedCount", label: "Failed", barClassName: "bg-red-500", dotClassName: "bg-red-500" },
  { key: "cancelledCount", label: "Cancelled", barClassName: "bg-slate-400", dotClassName: "bg-slate-400" },
  { key: "pausedCount", label: "Paused", barClassName: "bg-amber-500", dotClassName: "bg-amber-500" },
];

const StatusDistributionBar: FunctionComponent<{ metrics: SystemSummaryMetrics }> = ({ metrics }) => {
  const total = STATUS_BAR_SEGMENTS.reduce((sum, segment) => sum + metrics[segment.key], 0);
  if (total === 0) {
    return null;
  }

  return (
    <div className={`${SUBPANEL_CLASS} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status Distribution</div>
        <div className="flex flex-wrap items-center gap-3">
          {STATUS_BAR_SEGMENTS.filter((segment) => metrics[segment.key] > 0).map((segment) => (
            <div key={segment.key} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              <span className={`h-2 w-2 rounded-full ${segment.dotClassName}`} />
              {segment.label} · {metrics[segment.key]}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.05]">
        {STATUS_BAR_SEGMENTS.map((segment) => {
          const count = metrics[segment.key];
          if (count === 0) return null;
          return (
            <div
              key={segment.key}
              className={`h-full ${segment.barClassName} transition-all duration-500`}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${segment.label}: ${count}`}
            />
          );
        })}
      </div>
    </div>
  );
};

export const SystemStudio: FunctionComponent<{ projectId: string }> = ({ projectId }) => {
  const {
    invocations,
    allInvocations,
    summaryMetrics,
    availablePurposes,
    availableProviders,
    filters,
    setFilters,
    search,
    setSearch,
    sort,
    setSort,
    loading,
    error,
    refetch,
    externalApiMetrics,
    sprintStateSummary,
    errorsByCategory,
    page,
    setPage,
    hasMore,
    totalCount,
  } = useSystemViewData(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SystemTab>("all");

  void refetch;

  const tabbedInvocations = useMemo(() => {
    if (activeTab === "errors") {
      return invocations.filter((invocation) => invocation.status === "failed" || invocation.status === "cancelled");
    }

    if (activeTab === "system") {
      const systemMatches = invocations.filter((invocation) => {
        const type = (invocation.type || "").toLowerCase();
        return type.includes("system") || type.includes("message");
      });

      if (systemMatches.length > 0) {
        return systemMatches;
      }

      return invocations.filter((invocation) => Boolean(invocation.lastErrorMessage));
    }

    return invocations;
  }, [activeTab, invocations]);

  const successRateLabel = summaryMetrics.successRate !== null
    ? `${Math.round(summaryMetrics.successRate * 100)}%`
    : "—";
  const successTone = summaryMetrics.successRate === null
    ? "text-slate-900 dark:text-white"
    : summaryMetrics.successRate >= 0.95
      ? "text-emerald-600 dark:text-emerald-400"
      : summaryMetrics.successRate >= 0.8
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";

  const sprintData = sprintStateSummary || {
    totalSprints: 0, activeSprints: 0, completedSprints: 0, failedSprints: 0,
    totalTasks: 0, runningTasks: 0, blockedTasks: 0
  };
  const apiData = externalApiMetrics || {
    git: { calls: 0, avgDurationMs: 0 },
    jules: { calls: 0, avgDurationMs: 0 },
    jira: { calls: 0, avgDurationMs: 0 },
    other: { calls: 0, avgDurationMs: 0 },
  };
  const errorData = errorsByCategory || {
    timeout: 0, rateLimit: 0, apiError: 0, modelError: 0, cancelled: 0, other: 0
  };
  const errorEntries = Object.entries(errorData).filter(([_, count]) => count > 0);
  const totalErrors = errorEntries.reduce((sum, [_, count]) => sum + count, 0);

  return (
    <div className="space-y-8">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7 mb-8`}>
        <StudioHeader
          icon={Terminal}
          eyebrow="System Telemetry"
          title="Invocations & System Logs"
          description="Full operational log of every invocation across this project — filterable by status, type, and provider, with reliability and latency metrics computed live over the filtered set."
        />
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500 ${CHIP_CLASS}`}>
            Sprint Overview
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">Active State</div>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SystemMetricCard
            icon={Activity}
            label="Total Sprints"
            value={sprintData.totalSprints.toLocaleString()}
            detail="recorded across logs"
            circleClassName="bg-slate-500/10 text-slate-500 dark:text-slate-400"
          />
          <SystemMetricCard
            icon={TrendingUp}
            label="Active Sprints"
            value={sprintData.activeSprints > 0 ? sprintData.activeSprints.toLocaleString() : "0"}
            detail={sprintData.activeSprints > 0 ? `${sprintData.runningTasks} tasks live` : <span className="inline-flex items-center rounded-full bg-signal-500 px-2 py-0.5 text-[9px] font-bold text-white">All settled</span>}
            circleClassName="bg-blue-500/10 text-blue-500 dark:text-blue-400"
          />
          <SystemMetricCard
            icon={ShieldCheck}
            label="Completed Sprints"
            value={sprintData.completedSprints.toLocaleString()}
            detail={`${sprintData.failedSprints} failed`}
            circleClassName="bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
          />
          <SystemMetricCard
            icon={Database}
            label="Total Tasks"
            value={sprintData.totalTasks.toLocaleString()}
            detail={`${sprintData.blockedTasks} blocked`}
            circleClassName="bg-cyan-500/10 text-cyan-500 dark:text-cyan-400"
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500 ${CHIP_CLASS}`}>
            Status Distribution
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xl font-black text-slate-900 dark:text-white">Invocations</div>
            {summaryMetrics.runningCount > 0 && (
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 mb-4">
          <SystemMetricCard
            icon={Activity}
            label="Invocations"
            value={summaryMetrics.totalInvocations.toLocaleString()}
            detail={`${summaryMetrics.completedCount.toLocaleString()} completed`}
            circleClassName="bg-signal-500/10 text-signal-500 dark:text-signal-400"
          />
          <SystemMetricCard
            icon={Zap}
            label="Total Tokens"
            value={formatTokens(summaryMetrics.totalTokens)}
            detail={`${formatTokens(summaryMetrics.totalOutputTokens)} output`}
            circleClassName="bg-amber-500/10 text-amber-500 dark:text-amber-400"
          />
          <SystemMetricCard
            icon={ShieldCheck}
            label="Success Rate"
            value={successRateLabel}
            detail={summaryMetrics.failedCount > 0 ? `${summaryMetrics.failedCount} failed` : "no failures"}
            circleClassName="bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
            valueClassName={successTone}
          />
          <SystemMetricCard
            icon={Clock}
            label="Avg Duration"
            value={formatDuration(summaryMetrics.avgDurationMs)}
            detail={summaryMetrics.p95DurationMs > 0 ? `p95 ${formatDuration(summaryMetrics.p95DurationMs)}` : "no finished calls"}
            circleClassName="bg-cyan-500/10 text-cyan-500 dark:text-cyan-400"
          />
          <SystemMetricCard
            icon={Database}
            label="Cache Hits"
            value={summaryMetrics.cacheHitRate !== null ? `${Math.round(summaryMetrics.cacheHitRate * 100)}%` : "—"}
            detail={`${formatTokens(summaryMetrics.totalCachedTokens)} cached tokens`}
            circleClassName="bg-violet-500/10 text-violet-500 dark:text-violet-400"
          />
          <SystemMetricCard
            icon={TrendingUp}
            label="Running"
            value={summaryMetrics.runningCount.toLocaleString()}
            detail={summaryMetrics.runningCount > 0 ? "live right now" : "all settled"}
            circleClassName={summaryMetrics.runningCount > 0 ? "bg-blue-500/10 text-blue-500 dark:text-blue-400" : "bg-slate-500/10 text-slate-500 dark:text-slate-400"}
            valueClassName={summaryMetrics.runningCount > 0 ? "text-blue-600 dark:text-blue-300" : undefined}
          />
        </div>
        <StatusDistributionBar metrics={summaryMetrics} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500 ${CHIP_CLASS}`}>
              Error Log
            </div>
            <div className="text-xl font-black text-slate-900 dark:text-white">Failure Analysis</div>
          </div>
          {totalErrors > 0 && (
            <div className="flex h-8 items-center justify-center rounded-full border-2 border-amber-500/30 bg-amber-500/10 px-3 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              {totalErrors} total failures
            </div>
          )}
        </div>
        {errorEntries.length === 0 ? (
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center py-12 text-center`}>
            <ShieldCheck className="mb-3 h-8 w-8 text-emerald-500/50" />
            <div className="text-sm font-bold text-slate-900 dark:text-white">No Errors Recorded</div>
            <div className="mt-1 text-sm text-slate-500">All invocations completed successfully.</div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {errorEntries.map(([category, count]) => {
              const label = category === "rateLimit" ? "Rate Limit" : category === "apiError" ? "API Error" : category === "modelError" ? "Model Error" : category.charAt(0).toUpperCase() + category.slice(1);
              const tone = category === "timeout" ? "bg-amber-500" : category === "rateLimit" ? "bg-orange-500" : category === "cancelled" ? "bg-slate-400" : "bg-red-500";
              return (
                <div key={category} className={`${SUBPANEL_CLASS} flex items-center justify-between p-4`}>
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${tone}`} />
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{label}</div>
                  </div>
                  <div className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{count}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500 ${CHIP_CLASS}`}>
              Invocations
            </div>
            <div className="text-xl font-black text-slate-900 dark:text-white">Detailed Log</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(apiData) as [keyof typeof apiData, any][]).filter(([_, metrics]) => metrics.calls > 0).map(([key, metrics]) => (
              <div key={key} className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
                {key.charAt(0).toUpperCase() + key.slice(1)} · {metrics.calls} calls
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-1 rounded-2xl border border-black/[0.05] bg-white/68 p-1 dark:border-white/[0.05] dark:bg-void-900/35 self-start">
            {(["all", "errors", "system"] as SystemTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-all ${
                  activeTab === tab
                    ? "bg-amber-500 text-white shadow-sm ring-2 ring-amber-500/30"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {tab === "all" ? "All" : tab === "errors" ? "Errors" : "System Msgs"}
              </button>
            ))}
          </div>

          <SystemFilterBar
            filters={filters}
            onFiltersChange={setFilters}
            search={search}
            onSearchChange={setSearch}
            availablePurposes={availablePurposes}
            availableProviders={availableProviders}
            totalCount={totalCount}
            filteredCount={tabbedInvocations.length}
            page={page}
            onPageChange={setPage}
            hasMore={hasMore}
          />

          {error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">
              Failed to load invocations — {error}
            </div>
          ) : null}

          <InvocationsTable
            invocations={tabbedInvocations}
            sort={sort}
            onSortChange={setSort}
            expandedId={expandedId}
            onRowExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
            loading={loading}
          />
        </div>
      </section>
    </div>
  );
};
