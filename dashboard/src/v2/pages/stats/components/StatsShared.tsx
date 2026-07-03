import type { FunctionComponent, ComponentType } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  Clock3,
  Database,
  Layers3,
  PieChart,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Workflow,
  Bot,
  Terminal,
} from "lucide-preact";
import { Sparkline } from "../../../components/ui/Sparkline.js";
import { StatsCard, type StatsCardAccent } from "./StatsCard.js";
import { useProjectData } from "../../../context/project-data.js";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
  TokenUsageSource,
} from "../../../types.js";
import {
  formatTokens,
  formatCost,
  formatStatsDuration,
  formatPercent,
  formatDateTime,
  sumUsage,
  createSeries,
  getPurposeConfig,
} from "../stats-utils.js";
import { useStatsPageData } from "../use-stats-page-data.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import { computeWindowDelta, formatDeltaPercent, type TrendDelta } from "../trend-insights.js";

export * from "./stats-geometry.js";
export * from "./stats-formatters.js";
export * from "./stats-ui-primitives.js";

import { PANEL_CLASS, SUBPANEL_CLASS, CHIP_CLASS, LEDGER_ROW_MODERN_CLASS, SignalMetricCard, DonutCard, PurposeRibbon, StudioHeader, TokenChip, TokenFlowBar, ChurnFlowBar, SortButton, ViewToggle, SeriesLegendButton, CHART_SERIES, getProviderIcon, type StatsVisualMode, type ChartSeriesId } from "./stats-ui-primitives.js";
import { formatDay, formatHourTick, formatShortDate, toTimestamp, getAxisLabelStep, formatAxisLabel, getLedgerSortValue } from "./stats-formatters.js";
import { buildPath, buildSmoothPath, buildAreaPath, buildSmoothAreaPath, buildPoints, polarToCartesian, buildDonutArcPath, buildDonutSlices } from "./stats-geometry.js";
import { InteractiveUsageChart } from "./InteractiveUsageChart.js";
import { buildTelemetrySourceSummary } from "../model-insights.js";
export { InteractiveUsageChart };

type ProviderTelemetryUsage = ExecutionStatsEntitySummary["usage"] & {
  reportedInvocationCount?: number;
  estimatedInvocationCount?: number;
};

type ProviderTelemetrySource = {
  label: string;
  tone: string;
  detail: string;
  caveat: string;
};

function getProviderTelemetrySource(
  providerUsage: ProviderTelemetryUsage,
  tokenSources: Array<{ source: TokenUsageSource; count: number }>,
): ProviderTelemetrySource {
  const source = buildTelemetrySourceSummary({
    reportedInvocationCount: providerUsage.reportedInvocationCount ?? 0,
    estimatedInvocationCount: providerUsage.estimatedInvocationCount ?? 0,
    unavailableInvocationCount: providerUsage.unavailableInvocationCount ?? 0,
    unsupportedInvocationCount: providerUsage.unsupportedInvocationCount ?? 0,
  });

  if (source.mix.total > 0) {
    if (source.tone === "strong") {
      return { label: source.label, tone: "text-status-green dark:text-status-green", detail: source.detail, caveat: source.caveat };
    }

    if (source.tone === "warn") {
      return { label: source.label, tone: "text-amber-600 dark:text-amber-400", detail: source.detail, caveat: source.caveat };
    }

    if (source.tone === "critical") {
      return { label: source.label, tone: "text-rose-600 dark:text-rose-400", detail: source.detail, caveat: source.caveat };
    }

    return { label: source.label, tone: "text-slate-500 dark:text-slate-400", detail: source.detail, caveat: source.caveat };
  }

  const aggregateSource = tokenSources.find((entry) => entry.source === "reported" && entry.count > 0)
    ? "reported"
    : tokenSources.find((entry) => entry.source === "estimated" && entry.count > 0)
      ? "estimated"
      : tokenSources.find((entry) => entry.source === "unavailable" && entry.count > 0)
        ? "unavailable"
        : tokenSources.find((entry) => entry.source === "unsupported" && entry.count > 0)
          ? "unsupported"
          : "unknown";

  if (aggregateSource === "reported") {
    return {
      label: "Reported",
      tone: "text-status-green dark:text-status-green",
      detail: "Aggregate token-source fallback",
      caveat: "Provider-specific telemetry is missing, so this provider inherits the reported aggregate mix.",
    };
  }

  if (aggregateSource === "estimated") {
    return {
      label: "Estimated",
      tone: "text-amber-600 dark:text-amber-400",
      detail: "Aggregate token-source fallback",
      caveat: "Provider-specific telemetry is missing, so this provider inherits the estimated aggregate mix.",
    };
  }

  if (aggregateSource === "unavailable") {
    return {
      label: "Unavailable",
      tone: "text-rose-600 dark:text-rose-400",
      detail: "Aggregate token-source fallback",
      caveat: "Provider-specific telemetry is missing and the aggregate mix only reports unavailable counts.",
    };
  }

  return { label: source.label, tone: "text-slate-500 dark:text-slate-400", detail: source.detail, caveat: source.caveat };
}

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

const StudioMetricTile: FunctionComponent<{
  label: string;
  value: string;
  detail: string;
  toneClass?: string;
  icon?: ComponentType<any>;
}> = ({ label, value, detail, toneClass = "text-slate-500 dark:text-slate-400", icon: Icon }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center justify-between gap-3">
      <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${toneClass}`}>{label}</div>
      {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass}`} strokeWidth={2.2} aria-hidden="true" /> : null}
    </div>
    <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div>
  </div>
);

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

export const CompositionStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, tokenSegments }) => {
  const providers = [...stats.providers].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });
  const cacheDenominator = stats.usage.inputTokens + stats.usage.cachedInputTokens;
  const cacheRate = cacheDenominator > 0 ? (stats.usage.cachedInputTokens / cacheDenominator) * 100 : null;
  const activeVsWallRate = stats.usage.wallTimeMs > 0 ? stats.usage.activeTimeMs / stats.usage.wallTimeMs : null;
  const topProvider = providers[0] || null;
  const topPurpose = [...stats.purposes].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  })[0] || null;
  const topProviderShare = stats.usage.totalTokens > 0 && topProvider
    ? (topProvider.usage.totalTokens / stats.usage.totalTokens) * 100
    : null;
  const topPurposeShare = stats.usage.totalTokens > 0 && topPurpose
    ? (topPurpose.usage.totalTokens / stats.usage.totalTokens) * 100
    : null;

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StudioMetricTile
          label="Provider Share"
          value={topProvider ? topProvider.label : "No providers"}
          detail={topProvider && topProviderShare !== null ? `${formatPercent(topProviderShare)} of token volume` : "Nothing reported yet"}
          toneClass="text-signal-500 dark:text-signal-400"
        />
        <StudioMetricTile
          label="Purpose Distribution"
          value={topPurpose ? topPurpose.label.replace(/_/g, " ") : "No purposes"}
          detail={topPurpose && topPurposeShare !== null ? `${formatPercent(topPurposeShare)} of token volume` : "No purpose data"}
          toneClass="text-amber-600 dark:text-amber-400"
        />
        <StudioMetricTile
          label="Cache Efficiency"
          value={cacheRate !== null ? `${cacheRate.toFixed(1)}%` : "—"}
          detail={cacheRate !== null ? `~${formatTokens(stats.usage.cachedInputTokens)} tokens saved` : "No cacheable input yet"}
          toneClass="text-cyan-600 dark:text-cyan-400"
          icon={Database}
        />
        <StudioMetricTile
          label="Active vs Wall Time"
          value={activeVsWallRate !== null ? `${formatPercent(activeVsWallRate * 100)} active` : "No wall time"}
          detail={activeVsWallRate !== null ? `${formatStatsDuration(stats.usage.activeTimeMs)} active / ${formatStatsDuration(stats.usage.wallTimeMs)} wall` : "Wall time was not recorded"}
          toneClass="text-rose-600 dark:text-rose-400"
          icon={TimerReset}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
        <DonutCard
          title="Provider Share"
          eyebrow="Composition"
          description="Provider token split grouped into visible lanes for faster reading at high volume."
          centerValue={String(stats.providers.length)}
          centerLabel={stats.providers.length === 1 ? "provider" : "providers"}
          segments={providerSegments}
        />
        <DonutCard
          title="Token Anatomy"
          eyebrow="Flow Mix"
          description="Input, cached, output, and reasoning balance across the selected telemetry window."
          centerValue={formatTokens(stats.usage.totalTokens)}
          centerLabel="token mix"
          segments={tokenSegments}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Purpose Distribution</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Token volume and active time by invocation purpose over the selected window.
            </div>
          </div>
          <PurposeRibbon purposes={stats.purposes} />
        </div>
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <TimerReset className="h-4 w-4 text-amber-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Token Flight</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <StudioMetricTile
              label="Input"
              value={formatTokens(stats.usage.inputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.inputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-signal-600 dark:text-signal-400"
              icon={ArrowDownRight}
            />
            <StudioMetricTile
              label="Cached"
              value={formatTokens(stats.usage.cachedInputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.cachedInputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-cyan-600 dark:text-cyan-400"
              icon={Database}
            />
            <StudioMetricTile
              label="Output"
              value={formatTokens(stats.usage.outputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.outputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-amber-600 dark:text-amber-400"
              icon={ArrowUpRight}
            />
            <StudioMetricTile
              label="Reasoning"
              value={formatTokens(stats.usage.reasoningOutputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.reasoningOutputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-rose-600 dark:text-rose-400"
              icon={Brain}
            />
            <div className="col-span-2 rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Active Time</div>
                  <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatStatsDuration(stats.usage.activeTimeMs)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Wall Time</div>
                  <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatStatsDuration(stats.usage.wallTimeMs ?? 0)}</div>
                </div>
              </div>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {activeVsWallRate !== null ? `${formatPercent(activeVsWallRate * 100)} active utilization` : "Wall time not tracked"}
              </div>
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} mt-4 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Cache Efficiency</div>
            <div className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{cacheRate !== null ? cacheRate.toFixed(1) : "—"}%</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
              {stats.usage.cachedInputTokens > 0 ? `~${formatTokens(stats.usage.cachedInputTokens)} tokens saved` : "No cache savings recorded"}
            </div>
            <div className="mt-4">
              <TokenFlowBar
                input={stats.usage.inputTokens}
                cached={stats.usage.cachedInputTokens}
                output={stats.usage.outputTokens}
                reasoning={stats.usage.reasoningOutputTokens}
                total={stats.usage.totalTokens}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Provider Activity</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Token output, invocations, active time, and wall-time efficiency per provider over the selected window.
            </div>
          </div>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
            {providers.length} providers
          </div>
        </div>
        {providers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            No provider data for this window.
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const providerCacheDenominator = provider.usage.inputTokens + provider.usage.cachedInputTokens;
              const providerCacheRate = providerCacheDenominator > 0
                ? Math.round((provider.usage.cachedInputTokens / providerCacheDenominator) * 100)
                : null;
              const providerTokensPerCall = provider.usage.invocationCount > 0
                ? Math.round(provider.usage.totalTokens / provider.usage.invocationCount)
                : null;
              const providerModelsCount = (stats.models || []).filter((m) => m.provider === provider.id).length;
              const providerActiveVsWall = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;

              return (
                <div key={provider.id} className={`${PANEL_CLASS} p-5`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className={`rounded-xl p-2 ${bg} ${text}`}>
                        <Icon className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <div className="min-w-0">
                        <div className="break-words text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? "No secondary label"}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                        <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                          {provider.usage.totalCostUsd > 0 ? formatCost(provider.usage.totalCostUsd) : "—"}
                        </span>
                        <span className="text-slate-400">cost</span>
                      </div>
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                        <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                          {formatTokens(provider.usage.totalTokens)}
                        </span>
                        <span className="text-slate-400">tokens</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StudioMetricTile
                      label="Invocations"
                      value={provider.usage.invocationCount.toLocaleString()}
                      detail={provider.usage.invocationCount > 0 ? `${providerModelsCount} linked models` : "No calls yet"}
                      toneClass="text-slate-500 dark:text-slate-400"
                    />
                    <StudioMetricTile
                      label="Active Time"
                      value={formatStatsDuration(provider.usage.activeTimeMs)}
                      detail={provider.usage.wallTimeMs > 0 ? `${formatPercent((provider.usage.activeTimeMs / provider.usage.wallTimeMs) * 100)} active` : "Wall time not tracked"}
                      toneClass="text-amber-600 dark:text-amber-400"
                      icon={TimerReset}
                    />
                    <StudioMetricTile
                      label="Cache Hit Rate"
                      value={providerCacheRate !== null ? `${providerCacheRate}%` : "—"}
                      detail={providerCacheRate !== null ? `${formatTokens(provider.usage.cachedInputTokens)} cached` : "No cache signal"}
                      toneClass="text-cyan-600 dark:text-cyan-400"
                      icon={Database}
                    />
                    <StudioMetricTile
                      label="Tokens / Call"
                      value={providerTokensPerCall !== null ? formatTokens(providerTokensPerCall) : "—"}
                      detail={provider.usage.invocationCount > 0 ? "Average per invocation" : "No calls yet"}
                      toneClass="text-rose-600 dark:text-rose-400"
                    />
                  </div>

                  <div className="mt-4">
                    <TokenFlowBar
                      input={provider.usage.inputTokens}
                      cached={provider.usage.cachedInputTokens}
                      output={provider.usage.outputTokens}
                      reasoning={provider.usage.reasoningOutputTokens}
                      total={provider.usage.totalTokens}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    <span>{provider.usage.activeTimeMs > 0 ? formatStatsDuration(provider.usage.activeTimeMs) : "0s"} active</span>
                    <span>•</span>
                    <span>{provider.usage.wallTimeMs > 0 ? formatStatsDuration(provider.usage.wallTimeMs) : "No wall time"}</span>
                    {providerActiveVsWall !== null ? (
                      <>
                        <span>•</span>
                        <span>{formatPercent(providerActiveVsWall * 100)} utilization</span>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export const ReliabilityStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, sourceSegments }) => {
  const sourceSummary = buildTelemetrySourceSummary(stats.usage);
  const finishedCount = stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled;
  const successRate = finishedCount > 0 ? stats.statusCounts.completed / finishedCount : null;
  const overallDurationSamples = stats.duration.sampleCount;
  const providerRows = [...stats.providers].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
        <DonutCard
          title="Telemetry Source Mix"
          eyebrow="Reliability"
          description="Provider-reported versus estimated, unavailable, and unsupported usage across the selected window."
          centerValue={String(sourceSummary.mix.total)}
          centerLabel="invocations"
          segments={sourceSegments}
        />
        <DonutCard
          title="Provider Share"
          eyebrow="Signal Integrity"
          description="Provider leaders over the selected period, grouped for a cleaner read under high volume."
          centerValue={formatTokens(stats.usage.totalTokens)}
          centerLabel="token volume"
          segments={providerSegments}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StudioMetricTile
          label={`Telemetry ${sourceSummary.label}`}
          value={sourceSummary.detail}
          detail={sourceSummary.caveat}
          toneClass={sourceSummary.tone === "strong"
            ? "text-status-green dark:text-status-green"
            : sourceSummary.tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : sourceSummary.tone === "critical"
                ? "text-rose-600 dark:text-rose-400"
                : "text-slate-500 dark:text-slate-400"}
          icon={ShieldCheck}
        />
        <StudioMetricTile
          label="Status Counts"
          value={`${stats.statusCounts.completed.toLocaleString()} completed`}
          detail={`${stats.statusCounts.failed.toLocaleString()} failed · ${stats.statusCounts.running.toLocaleString()} running · ${stats.statusCounts.cancelled.toLocaleString()} cancelled`}
          toneClass="text-cyan-600 dark:text-cyan-400"
        />
        <StudioMetricTile
          label="Success Rate"
          value={successRate !== null ? formatPercent(successRate * 100) : "—"}
          detail={finishedCount > 0 ? `${finishedCount.toLocaleString()} finished invocations` : "Nothing finished yet"}
          toneClass="text-emerald-600 dark:text-emerald-400"
          icon={ShieldCheck}
        />
        <StudioMetricTile
          label="Duration Samples"
          value={`${overallDurationSamples.toLocaleString()} samples`}
          detail={overallDurationSamples > 0 ? `p50 ${formatStatsDuration(stats.duration.p50Ms)} · p95 ${formatStatsDuration(stats.duration.p95Ms)}` : "No duration data"}
          toneClass="text-amber-600 dark:text-amber-400"
          icon={Clock3}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-4 w-4 text-status-green" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Confidence Board</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-status-green/16 bg-status-green/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-status-green">Reported</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.reportedInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-status-green/20">
                <div className="h-full bg-status-green" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.reportedInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">Estimated</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.estimatedInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-amber-500/20">
                <div className="h-full bg-amber-500" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.estimatedInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">Unavailable</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unavailableInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-rose-500/20">
                <div className="h-full bg-rose-500" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.unavailableInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Unsupported</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unsupportedInvocationCount}</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-500/20">
                <div className="h-full bg-slate-500" style={{ width: `${sourceSummary.mix.total > 0 ? ((stats.usage.unsupportedInvocationCount || 0) / sourceSummary.mix.total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-amber-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Audit Notes</div>
          </div>
          <div className="mt-4 space-y-4">
            <div className={SUBPANEL_CLASS}>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Source mix</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {sourceSummary.caveat}
              </div>
            </div>
            <div className={SUBPANEL_CLASS}>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Duration coverage</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {overallDurationSamples > 0
                  ? `Latency is backed by ${overallDurationSamples.toLocaleString()} samples, so p50 and p95 are decision-ready for this window.`
                  : "No duration samples were recorded, so latency metrics remain unavailable rather than inferred."}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Provider Breakdown</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Per-provider token anatomy, invocation volume, compute time, and telemetry reliability for the selected window.
          </div>
        </div>
        {providerRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            No provider telemetry for this window.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {providerRows.map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const providerUsage = provider.usage as ProviderTelemetryUsage;
              const sourceQuality = getProviderTelemetrySource(providerUsage, stats.tokenSources);
              const providerModels = (stats.models || []).filter((model) => model.provider === provider.id);
              const durationSamples = providerModels.reduce((sum, model) => sum + model.duration.sampleCount, 0);
              const weightedLatencyMs = durationSamples > 0
                ? providerModels.reduce((sum, model) => sum + model.duration.avgMs * model.duration.sampleCount, 0) / durationSamples
                : null;
              const completedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.completed, 0);
              const failedCount = providerModels.reduce((sum, model) => sum + model.statusCounts.failed, 0);
              const cancelledCount = providerModels.reduce((sum, model) => sum + model.statusCounts.cancelled, 0);
              const runningCount = providerModels.reduce((sum, model) => sum + model.statusCounts.running, 0);
              const finishedCountForProvider = completedCount + failedCount + cancelledCount;
              const successRateForProvider = finishedCountForProvider > 0 ? completedCount / finishedCountForProvider : null;
              const providerModelsCount = providerModels.length;
              const providerActiveVsWall = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;

              return (
                <div key={provider.id} className={`${PANEL_CLASS} p-5`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`rounded-xl p-2 ${bg} ${text}`}>
                        <Icon className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <div className="min-w-0">
                        <div className="break-words text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? "No secondary label"}</div>
                        <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${sourceQuality.tone}`}>
                          {sourceQuality.label}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                        <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                          {provider.usage.totalTokens > 0 ? formatTokens(provider.usage.totalTokens) : "—"}
                        </span>
                        <span className="text-slate-400">tokens</span>
                      </div>
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                        <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                          {provider.usage.invocationCount.toLocaleString()}
                        </span>
                        <span className="text-slate-400">calls</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <StudioMetricTile
                      label="Telemetry Quality"
                      value={sourceQuality.label}
                      detail={sourceQuality.detail}
                      toneClass={sourceQuality.tone === "strong"
                        ? "text-status-green dark:text-status-green"
                        : sourceQuality.tone === "warn"
                          ? "text-amber-600 dark:text-amber-400"
                          : sourceQuality.tone === "critical"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-slate-500 dark:text-slate-400"}
                    />
                    <StudioMetricTile
                      label="Success Rate"
                      value={successRateForProvider !== null ? formatPercent(successRateForProvider * 100) : "—"}
                      detail={finishedCountForProvider > 0 ? `${finishedCountForProvider.toLocaleString()} finished from models` : "No finished model runs"}
                      toneClass="text-emerald-600 dark:text-emerald-400"
                      icon={ShieldCheck}
                    />
                    <StudioMetricTile
                      label="Duration Samples"
                      value={`${durationSamples.toLocaleString()} samples`}
                      detail={durationSamples > 0 ? `p50 ${formatStatsDuration(weightedLatencyMs || 0)}` : "No latency samples"}
                      toneClass="text-cyan-600 dark:text-cyan-400"
                      icon={Clock3}
                    />
                    <StudioMetricTile
                      label="Tokens / Call"
                      value={provider.usage.invocationCount > 0 ? `${formatTokens(Math.round(provider.usage.totalTokens / provider.usage.invocationCount))}/call` : "—"}
                      detail={provider.usage.invocationCount > 0 ? "Average per invocation" : "No calls yet"}
                      toneClass="text-rose-600 dark:text-rose-400"
                    />
                    <StudioMetricTile
                      label="Status Counts"
                      value={`${completedCount.toLocaleString()} completed`}
                      detail={`${failedCount.toLocaleString()} failed · ${runningCount.toLocaleString()} running · ${cancelledCount.toLocaleString()} cancelled`}
                      toneClass="text-slate-500 dark:text-slate-400"
                    />
                    <StudioMetricTile
                      label="Active Time"
                      value={formatStatsDuration(provider.usage.activeTimeMs)}
                      detail={providerActiveVsWall !== null ? `${formatPercent(providerActiveVsWall * 100)} active utilization` : "Wall time not tracked"}
                      toneClass="text-amber-600 dark:text-amber-400"
                      icon={TimerReset}
                    />
                  </div>

                  <div className="mt-4">
                    <TokenFlowBar
                      input={provider.usage.inputTokens}
                      cached={provider.usage.cachedInputTokens}
                      output={provider.usage.outputTokens}
                      reasoning={provider.usage.reasoningOutputTokens}
                      total={provider.usage.totalTokens}
                    />
                  </div>

                  <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    {sourceQuality.caveat}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
