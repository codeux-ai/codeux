import type { FunctionComponent } from "preact";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Hash,
  TimerReset,
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

const TrendDeltaPill: FunctionComponent<{
  label: string;
  delta: TrendDelta;
}> = ({ label, delta }) => {
  const deltaLabel = formatDeltaPercent(delta);
  const Icon = delta.direction === "down" ? ArrowDownRight : ArrowUpRight;
  const tone = delta.direction === "flat"
    ? "text-[var(--stats-detail-color)]"
    : delta.direction === "up"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-rose-700 dark:text-rose-300";

  return (
    <div className={`${CHIP_CLASS} inline-flex min-w-0 items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] ${tone}`}>
      {delta.direction !== "flat" ? <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} /> : null}
      <span className="truncate">{label}</span>
      <span className="text-[var(--stats-value-color)]">{deltaLabel}</span>
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
    ? `${Math.round((stats.usage.outputTokens || 0) / Math.max(1, stats.usage.activeTimeMs / 1000))} tok/s`
    : "0 tok/s";

  const purposeRows = [...stats.purposes]
    .sort((a, b) => (b.usage?.totalTokens || 0) - (a.usage?.totalTokens || 0));

  return (
  <section className="space-y-5">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        label="Total Cost"
        value={stats.usage.totalCostUsd > 0 ? formatCost(stats.usage.totalCostUsd) : (stats.usage.totalTokens > 0 ? "No pricing configured" : "$0.00")}
        detail={stats.usage.totalCostUsd > 0 && stats.usage.invocationCount > 0 ? `${formatCost(stats.usage.totalCostUsd / stats.usage.invocationCount)} per call` : "across all providers"}
      />
      <TrendKpiTile
        label="Cache Hit Rate"
        value={cacheDenominator > 0
          ? formatPercent((stats.usage.cachedInputTokens / cacheDenominator) * 100)
          : "—"}
        detail={`${formatTokens(stats.usage.cachedInputTokens)} cached`}
      />
    </div>
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex flex-wrap gap-2" aria-label="Trend deltas">
        <TrendDeltaPill label="Token trend" delta={tokenDelta} />
        <TrendDeltaPill label="Invocation trend" delta={invocationDelta} />
        <TrendDeltaPill label="Active time trend" delta={activeTimeDelta} />
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <div className={`${CHIP_CLASS} inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
          <TimerReset className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
          {stats.duration && stats.duration.sampleCount > 0 ? `Median ${formatStatsDuration(stats.duration.p50Ms)}` : "No latency samples"}
        </div>
        <div className={`${CHIP_CLASS} inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
          <Hash className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
          {outputVelocity}
        </div>
        <div className={`${CHIP_CLASS} inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
          <Clock3 className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
          {finishedCount > 0 ? `${formatPercent((statusCounts!.completed / finishedCount) * 100)} success` : "No finished runs"}
        </div>
      </div>
    </div>
    <InteractiveUsageChart
      stats={stats}
      loading={loading}
      error={error}
      refresh={refresh}
      chartState={chartState}
    />
    <div className={`${SUBPANEL_CLASS} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">Purpose Activity</div>
          <div className="mt-2 text-sm leading-relaxed text-[var(--stats-detail-color)]">
            Token volume, invocation count, and active time by purpose over the selected window.
          </div>
        </div>
        <div className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)] ${CHIP_CLASS}`}>
          {stats.purposes.length} purposes
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {purposeRows.length > 0 ? purposeRows.map((purpose) => (
          <div key={purpose.id} className={`${LEDGER_ROW_MODERN_CLASS} grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center`}>
            <div className="min-w-0">
              <div className="break-words text-sm font-bold capitalize text-slate-900 dark:text-white">
                {purpose.label.replace(/_/g, " ")}
              </div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">
                {formatTokens(purpose.usage?.totalTokens || 0)} tokens
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-slate-500 sm:min-w-[18rem]">
              <div>
                <span className="block font-medium text-slate-700 dark:text-slate-300">{(purpose.usage?.invocationCount || 0).toLocaleString()}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]">invocations</span>
              </div>
              <div>
                <span className="block font-medium text-slate-700 dark:text-slate-300">{formatStatsDuration(purpose.usage?.activeTimeMs || 0)}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]">active time</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="rounded-[1.05rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/50 px-4 py-6 text-sm leading-relaxed text-[var(--stats-detail-color)]">
            No purpose activity is available for this range.
          </div>
        )}
      </div>
    </div>
    <div className="flex flex-wrap gap-3" aria-label="Trend range metadata">
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
      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
        Peak bucket cost {chartMetrics && chartMetrics.peakCostUsd > 0 ? formatCost(chartMetrics.peakCostUsd) : "—"}
      </div>
    </div>
  </section>
  );
};
