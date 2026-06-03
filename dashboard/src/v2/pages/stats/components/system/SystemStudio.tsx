import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import {
  Activity,
  AlertTriangle,
  Clock,
  Terminal,
  TrendingUp,
  Zap,
} from "lucide-preact";
import { useSystemViewData } from "../../../../pages/stats/hooks/use-system-view-data.js";
import { formatDuration, formatTokens } from "../../stats-utils.js";
import { PANEL_CLASS, SUBPANEL_CLASS, StudioHeader } from "../StatsShared.js";
import { SystemFilterBar } from "./SystemFilterBar.js";
import { InvocationsTable } from "./InvocationsTable.js";

function buildMetricCardTone(kind: "default" | "error" | "running"): {
  circleClassName: string;
  iconClassName: string;
  valueClassName: string;
} {
  switch (kind) {
    case "error":
      return {
        circleClassName: "bg-red-500/10 text-red-400",
        iconClassName: "text-red-400",
        valueClassName: "text-red-300",
      };
    case "running":
      return {
        circleClassName: "bg-blue-500/10 text-blue-400",
        iconClassName: "text-blue-400",
        valueClassName: "text-blue-300",
      };
    default:
      return {
        circleClassName: "bg-signal-500/10 text-signal-400",
        iconClassName: "text-signal-400",
        valueClassName: "text-slate-900 dark:text-white",
      };
  }
}

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
  } = useSystemViewData(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  void refetch;

  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <StudioHeader
          icon={Terminal}
          eyebrow="System Telemetry"
          title="Invocations & System Logs"
          description="Full operational log of every invocation across this project — filterable by status, type, and provider, with token statistics and inline message inspection."
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-2xl ${buildMetricCardTone("default").circleClassName}`}>
            <Activity className={`h-4 w-4 ${buildMetricCardTone("default").iconClassName}`} strokeWidth={2.25} />
          </div>
          <div className={`text-3xl font-black tracking-tight ${buildMetricCardTone("default").valueClassName}`}>
            {summaryMetrics.totalInvocations.toLocaleString()}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Invocations
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
            <Zap className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className={`text-3xl font-black tracking-tight ${buildMetricCardTone("default").valueClassName}`}>
            {formatTokens(summaryMetrics.totalTokens)}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Total Tokens
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400">
            <Clock className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className={`text-3xl font-black tracking-tight ${buildMetricCardTone("default").valueClassName}`}>
            {formatDuration(summaryMetrics.avgDurationMs)}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Avg Duration
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-2xl ${buildMetricCardTone(summaryMetrics.failedCount > 0 ? "error" : "default").circleClassName}`}>
            <AlertTriangle className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className={`text-3xl font-black tracking-tight ${buildMetricCardTone(summaryMetrics.failedCount > 0 ? "error" : "default").valueClassName}`}>
            {summaryMetrics.failedCount.toLocaleString()}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Failed
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} p-4`}>
          <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-2xl ${buildMetricCardTone(summaryMetrics.runningCount > 0 ? "running" : "default").circleClassName}`}>
            <TrendingUp className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className={`text-3xl font-black tracking-tight ${buildMetricCardTone(summaryMetrics.runningCount > 0 ? "running" : "default").valueClassName}`}>
            {summaryMetrics.runningCount.toLocaleString()}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Running
          </div>
        </div>
      </div>

      <SystemFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        search={search}
        onSearchChange={setSearch}
        availablePurposes={availablePurposes}
        availableProviders={availableProviders}
        totalCount={allInvocations.length}
        filteredCount={invocations.length}
      />

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load invocations — {error}
        </div>
      ) : null}

      <InvocationsTable
        invocations={invocations}
        sort={sort}
        onSortChange={setSort}
        expandedId={expandedId}
        onRowExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
        loading={loading}
      />
    </section>
  );
};
