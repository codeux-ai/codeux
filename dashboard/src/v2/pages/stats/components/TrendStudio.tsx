import type { FunctionComponent } from "preact";
import {
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-preact";
import type {
  ExecutionStatsEntitySummary,
  ProjectExecutionStatsSnapshot,
} from "../../../types.js";
import {
  formatTokens,
  formatCost,
  formatStatsDuration,
  formatPercent,
} from "../stats-utils.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import { computeWindowDelta, formatDeltaPercent, type TrendDelta } from "../trend-insights.js";
import {
  CHIP_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  SUBPANEL_CLASS,
} from "./stats-ui-primitives.js";
import { InteractiveUsageChart } from "./InteractiveUsageChart.js";

const TrendKpiTile: FunctionComponent<{
  label: string;
  value: string;
  delta?: TrendDelta;
  detail?: string;
}> = ({ label, value, delta, detail }) => {
  const deltaLabel = delta ? formatDeltaPercent(delta) : null;
  const showDelta = delta && deltaLabel && deltaLabel !== "—";
  const deltaTone = !delta || delta.direction === "flat"
    ? "text-[var(--stats-detail-color)]"
    : delta.direction === "up"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-rose-700 dark:text-rose-300";

  return (
    <div className={`${SUBPANEL_CLASS} flex min-h-[7rem] flex-col justify-between p-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color)]">{label}</div>
        {showDelta ? (
          <div className={`inline-flex items-center gap-1 rounded-full border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${deltaTone}`}>
            {delta!.direction === "up" ? (
              <ArrowUpRight className="h-3 w-3" strokeWidth={2.6} />
            ) : delta!.direction === "down" ? (
              <ArrowDownRight className="h-3 w-3" strokeWidth={2.6} />
            ) : null}
            {deltaLabel}
          </div>
        ) : null}
      </div>
      <div>
        <div className="mt-3 break-words text-xl font-black leading-tight text-[var(--stats-value-color)]">{value}</div>
        {detail ? <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--stats-detail-color)]">{detail}</div> : null}
      </div>
    </div>
  );
};

export const TrendStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  planningUsage: ExecutionStatsEntitySummary | null;
  chartState: UsageChartState;
}> = ({
  stats,
  loading,
  error,
  refresh,
  planningUsage: _planningUsage,
  chartState,
}) => {
  const chartMetrics = chartState.metrics;
  const buckets = stats.buckets || [];
  const tokenDelta = computeWindowDelta(buckets, (bucket) => bucket.usage?.totalTokens || 0);
  const invocationDelta = computeWindowDelta(buckets, (bucket) => bucket.usage?.invocationCount || 0);
  const activeTimeDelta = computeWindowDelta(buckets, (bucket) => bucket.usage?.activeTimeMs || 0);
  const cacheDenominator = stats.usage.inputTokens + stats.usage.cachedInputTokens;
  const statusCounts = stats.statusCounts;
  const finishedCount = statusCounts
    ? statusCounts.completed + statusCounts.failed + statusCounts.cancelled
    : 0;

  const outputVelocity = stats.usage.activeTimeMs > 0
    ? `${Math.round(stats.usage.outputTokens / Math.max(1, stats.usage.activeTimeMs / 1000))} tok/s`
    : "0 tok/s";

  return (
  <section className="space-y-5">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
      <TrendKpiTile
        label="Total Cost"
        value={stats.usage.totalCostUsd > 0 ? formatCost(stats.usage.totalCostUsd) : (stats.usage.totalTokens > 0 ? "No pricing configured" : "$0.00")}
        delta={undefined}
        detail="across all providers"
      />
      <TrendKpiTile
        label="Cost per Invocation"
        value={stats.usage.totalCostUsd > 0 && stats.usage.invocationCount > 0 ? formatCost(stats.usage.totalCostUsd / stats.usage.invocationCount) : "—"}
        detail="per call"
      />
      <TrendKpiTile
        label="Total Tokens"
        value={formatTokens(stats.usage.totalTokens)}
        delta={tokenDelta}
        detail="vs first half of window"
      />
      <TrendKpiTile
        label="Invocations"
        value={stats.usage.invocationCount.toLocaleString()}
        delta={invocationDelta}
        detail="vs first half of window"
      />
      <TrendKpiTile
        label="Active Time"
        value={formatStatsDuration(stats.usage.activeTimeMs)}
        delta={activeTimeDelta}
        detail="vs first half of window"
      />
      <TrendKpiTile
        label="Cache Hit Rate"
        value={cacheDenominator > 0
          ? formatPercent((stats.usage.cachedInputTokens / cacheDenominator) * 100)
          : "—"}
        detail={`${formatTokens(stats.usage.cachedInputTokens)} cached`}
      />
      <TrendKpiTile
        label="Median Latency"
        value={stats.duration && stats.duration.sampleCount > 0 ? formatStatsDuration(stats.duration.p50Ms) : "—"}
        detail={stats.duration && stats.duration.sampleCount > 0 ? `p95 ${formatStatsDuration(stats.duration.p95Ms)}` : "no samples"}
      />
      <TrendKpiTile
        label="Success Rate"
        value={finishedCount > 0 ? formatPercent((statusCounts!.completed / finishedCount) * 100) : "—"}
        detail={finishedCount > 0 ? `${statusCounts!.failed} failed of ${finishedCount}` : "nothing finished yet"}
      />
      <TrendKpiTile
        label="Output Velocity"
        value={outputVelocity}
        detail={chartMetrics && chartMetrics.peakCostUsd > 0 ? `${formatCost(chartMetrics.peakCostUsd)} peak bucket` : "active output rate"}
      />
    </div>
    <div className="flex flex-wrap gap-3">
      <div className={`self-start px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500 bg-amber-500/10 ${CHIP_CLASS}`}>Trend</div>
      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
        {stats.range.label}
      </div>
      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
        {stats.range.resolutionLabel}
      </div>
      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
        {stats.buckets.length} buckets
      </div>
    </div>
    <InteractiveUsageChart
      stats={stats}
      loading={loading}
      error={error}
      refresh={refresh}
      chartState={chartState}
    />
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Purpose Activity</div>
        <div className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
          {stats.purposes.length} purposes
        </div>
      </div>
      <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Token volume and active time by invocation purpose over the selected window.
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {stats.purposes.map((purpose) => (
          <div key={purpose.id} className={`${LEDGER_ROW_MODERN_CLASS} flex items-center justify-between`}>
            <div className="text-sm font-bold capitalize text-slate-900 dark:text-white">
              {purpose.label.replace(/_/g, " ")}
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-500">
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">{(purpose.usage?.invocationCount || 0).toLocaleString()}</span> invocations
              </div>
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">{formatStatsDuration(purpose.usage?.activeTimeMs || 0)}</span> active time
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};
