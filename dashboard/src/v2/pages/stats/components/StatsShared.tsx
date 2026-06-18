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
  formatDuration,
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
export { InteractiveUsageChart };

type ProviderTelemetryUsage = ExecutionStatsEntitySummary["usage"] & {
  reportedInvocationCount?: number;
  estimatedInvocationCount?: number;
};

type ProviderTelemetrySource = {
  label: string;
  tone: string;
};

function getProviderTelemetrySource(
  providerUsage: ProviderTelemetryUsage,
  tokenSources: Array<{ source: TokenUsageSource; count: number }>,
): ProviderTelemetrySource {
  const hasPerProviderQualitySignal =
    typeof providerUsage.reportedInvocationCount === "number" ||
    typeof providerUsage.estimatedInvocationCount === "number";

  const aggregateSource = tokenSources.find((entry) => entry.source === "reported" && entry.count > 0)
    ? "reported"
    : tokenSources.find((entry) => entry.source === "estimated" && entry.count > 0)
      ? "estimated"
      : "unknown";

  const source = hasPerProviderQualitySignal
    ? providerUsage.reportedInvocationCount && providerUsage.reportedInvocationCount > 0
      ? "reported"
      : providerUsage.estimatedInvocationCount && providerUsage.estimatedInvocationCount > 0
        ? "estimated"
        : "unknown"
    : aggregateSource;

  if (source === "reported") {
    return { label: "Reported", tone: "text-status-green dark:text-status-green" };
  }

  if (source === "estimated") {
    return { label: "Estimated", tone: "text-amber-600 dark:text-amber-400" };
  }

  return { label: "Unknown", tone: "text-slate-500 dark:text-slate-400" };
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
    ? "text-slate-400 dark:text-slate-500"
    : delta.direction === "up"
      ? "text-status-green"
      : "text-rose-500 dark:text-rose-400";

  return (
    <div className={`${SUBPANEL_CLASS} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{label}</div>
        {showDelta ? (
          <div className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] ${deltaTone}`}>
            {delta!.direction === "up" ? (
              <ArrowUpRight className="h-3 w-3" strokeWidth={2.6} />
            ) : delta!.direction === "down" ? (
              <ArrowDownRight className="h-3 w-3" strokeWidth={2.6} />
            ) : null}
            {deltaLabel}
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{value}</div>
      {detail ? <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{detail}</div> : null}
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
  const buckets = stats.buckets || [];
  const tokenDelta = computeWindowDelta(buckets, (bucket) => bucket.usage?.totalTokens || 0);
  const invocationDelta = computeWindowDelta(buckets, (bucket) => bucket.usage?.invocationCount || 0);
  const activeTimeDelta = computeWindowDelta(buckets, (bucket) => bucket.usage?.activeTimeMs || 0);
  const cacheDenominator = stats.usage.inputTokens + stats.usage.cachedInputTokens;
  const statusCounts = stats.statusCounts;
  const finishedCount = statusCounts
    ? statusCounts.completed + statusCounts.failed + statusCounts.cancelled
    : 0;

  return (
  <section className="space-y-6">
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-8">
      <TrendKpiTile
        label="Total Cost"
        value={stats.usage.totalCostUsd > 0 ? formatCost(stats.usage.totalCostUsd) : (stats.usage.totalTokens > 0 ? "No pricing configured" : "$0.00")}
        delta={undefined}
        detail="across all providers"
      />
      <TrendKpiTile
        label="Cost per Invocation"
        value={stats.usage.totalCostUsd > 0 && stats.usage.invocationCount > 0 ? formatCost(stats.usage.totalCostUsd / stats.usage.invocationCount) : "—"}
      />
      <TrendKpiTile
        label="Cost per Active Hour"
        value={stats.usage.totalCostUsd > 0 && stats.usage.activeTimeMs > 0 ? formatCost(stats.usage.totalCostUsd / (stats.usage.activeTimeMs / 3600000)) : "—"}
      />
      <TrendKpiTile
        label="Peak Bucket Cost"
        value={(chartState as any)?.metrics?.peakCostUsd > 0 ? formatCost((chartState as any)?.metrics?.peakCostUsd) : "—"}
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
        value={formatDuration(stats.usage.activeTimeMs)}
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
        value={stats.duration && stats.duration.sampleCount > 0 ? formatDuration(stats.duration.p50Ms) : "—"}
        detail={stats.duration && stats.duration.sampleCount > 0 ? `p95 ${formatDuration(stats.duration.p95Ms)}` : "no samples"}
      />
      <TrendKpiTile
        label="Success Rate"
        value={finishedCount > 0 ? formatPercent((statusCounts!.completed / finishedCount) * 100) : "—"}
        detail={finishedCount > 0 ? `${statusCounts!.failed} failed of ${finishedCount}` : "nothing finished yet"}
      />
      <TrendKpiTile
        label="Output Velocity"
        value={stats.usage.activeTimeMs > 0 ? `${Math.round(stats.usage.outputTokens / Math.max(1, stats.usage.activeTimeMs / 1000))} tok/s` : "0 tok/s"}
      />
      <TrendKpiTile
        label="Reasoning Share"
        value={stats.usage.reasoningOutputTokens > 0 ? formatPercent((stats.usage.reasoningOutputTokens / stats.usage.outputTokens) * 100) : "—"}
        detail="of output tokens"
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
                <span className="font-medium text-slate-700 dark:text-slate-300">{formatDuration(purpose.usage?.activeTimeMs || 0)}</span> active time
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
  const cacheRate = stats.usage.inputTokens + stats.usage.cachedInputTokens > 0
    ? (stats.usage.cachedInputTokens / (stats.usage.inputTokens + stats.usage.cachedInputTokens)) * 100
    : 0;
  const providers = [...stats.providers].sort((left, right) => right.usage.totalTokens - left.usage.totalTokens);

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
        <DonutCard
          title="Provider Share"
          eyebrow="Composition"
          description="Provider token split grouped into visible lanes for faster reading at high volume."
          centerValue={String(stats.providers.length)}
          centerLabel="providers"
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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <PurposeRibbon purposes={stats.purposes} />
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <TimerReset className="h-4 w-4 text-amber-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Token Flight</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-signal-500/16 bg-signal-500/10 p-4">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">
                <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2.1} />
                Input
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.inputTokens)}</div>
          <div className="mt-1 text-[10px] text-slate-400">{stats.usage.totalTokens > 0 ? Math.round((stats.usage.inputTokens / stats.usage.totalTokens) * 100) : 0}% of total</div>
            </div>
            <div className="rounded-2xl border border-cyan-500/16 bg-cyan-500/10 p-4">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600 dark:text-cyan-400">
                <Database className="h-3.5 w-3.5" strokeWidth={2.1} />
                Cached
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.cachedInputTokens)}</div>
          <div className="mt-1 text-[10px] text-slate-400">{stats.usage.totalTokens > 0 ? Math.round((stats.usage.cachedInputTokens / stats.usage.totalTokens) * 100) : 0}% of total</div>
            </div>
            <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.1} />
                Output
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.outputTokens)}</div>
          <div className="mt-1 text-[10px] text-slate-400">{stats.usage.totalTokens > 0 ? Math.round((stats.usage.outputTokens / stats.usage.totalTokens) * 100) : 0}% of total</div>
            </div>
            <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">
                <Brain className="h-3.5 w-3.5" strokeWidth={2.1} />
                Reasoning
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.reasoningOutputTokens)}</div>
          <div className="mt-1 text-[10px] text-slate-400">{stats.usage.totalTokens > 0 ? Math.round((stats.usage.reasoningOutputTokens / stats.usage.totalTokens) * 100) : 0}% of total</div>
            </div>
            <div className="col-span-2 rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Active Time</div>
                  <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatDuration(stats.usage.activeTimeMs)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Wall Time</div>
                  <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatDuration(stats.usage.wallTimeMs ?? 0)}</div>
                </div>
              </div>
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} mt-4 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Cache Efficiency</div>
            <div className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{cacheRate.toFixed(1)}%</div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
          ~{formatTokens(stats.usage.cachedInputTokens)} tokens saved
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
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Provider Activity</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Token output, invocations, and active time per provider over the selected window.
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
          const providerModelsCount = (stats.models || []).filter(m => m.provider === provider.id).length;

              return (
                <div key={provider.id} className={LEDGER_ROW_MODERN_CLASS}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(0,auto))] lg:items-start">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className={`rounded-xl p-2 ${bg} ${text}`}>
                        <Icon className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? ""}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{provider.usage.totalCostUsd > 0 ? formatCost(provider.usage.totalCostUsd) : "—"}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">cost</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{formatTokens(provider.usage.totalTokens)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">tokens</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{provider.usage.invocationCount.toLocaleString()}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">calls</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{formatDuration(provider.usage.activeTimeMs)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">active</div>
                    </div>
                <div className="text-right">
                  <div className="text-lg font-black text-slate-900 dark:text-white">{providerModelsCount}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">model count</div>
                </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{providerCacheRate !== null ? `${providerCacheRate}%` : "—"}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">cache hit</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{providerTokensPerCall !== null ? formatTokens(providerTokensPerCall) : "—"}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">tok / call</div>
                    </div>
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
  const totalConfidence = (stats.usage.reportedInvocationCount || 0) + (stats.usage.estimatedInvocationCount || 0) + (stats.usage.unavailableInvocationCount || 0) + (stats.usage.unsupportedInvocationCount || 0);

  return (
  <section className="space-y-6">
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
      <DonutCard
        title="Telemetry Source Mix"
        eyebrow="Reliability"
        description="Provider-reported versus estimated, unavailable, and unsupported usage across the selected window."
        centerValue={String(stats.tokenSources.reduce((sum, entry) => sum + entry.count, 0))}
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
            <div className="h-full bg-status-green" style={{ width: `${totalConfidence > 0 ? ((stats.usage.reportedInvocationCount || 0) / totalConfidence) * 100 : 0}%` }} />
          </div>
          </div>
          <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">Estimated</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.estimatedInvocationCount}</div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-amber-500/20">
            <div className="h-full bg-amber-500" style={{ width: `${totalConfidence > 0 ? ((stats.usage.estimatedInvocationCount || 0) / totalConfidence) * 100 : 0}%` }} />
          </div>
          </div>
          <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">Unavailable</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unavailableInvocationCount}</div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-rose-500/20">
            <div className="h-full bg-rose-500" style={{ width: `${totalConfidence > 0 ? ((stats.usage.unavailableInvocationCount || 0) / totalConfidence) * 100 : 0}%` }} />
          </div>
          </div>
          <div className="rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Unsupported</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unsupportedInvocationCount}</div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-500/20">
            <div className="h-full bg-slate-500" style={{ width: `${totalConfidence > 0 ? ((stats.usage.unsupportedInvocationCount || 0) / totalConfidence) * 100 : 0}%` }} />
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
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Fallback policy</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Codex and Claude stay visible even when they cannot report authoritative token counts, but the dashboard explicitly keeps those invocations marked as estimated rather than pretending they are exact.
            </div>
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Reliability signal</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Reliability mode is tuned for operational trust: how much of the window is exact, how much came from fallback, and where unsupported providers still participate in time tracking without token precision.
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
      {stats.providers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
          No provider telemetry for this window.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {stats.providers
            .slice()
            .sort((a, b) => b.usage.totalTokens - a.usage.totalTokens)
            .map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const providerUsage = provider.usage as ProviderTelemetryUsage;
              const sourceQuality = getProviderTelemetrySource(providerUsage, stats.tokenSources);
              const providerModels = (stats.models || []).filter((model) => model.provider === provider.id);
              const latencySamples = providerModels.reduce((sum, model) => sum + model.duration.sampleCount, 0);
              const avgLatencyMs = latencySamples > 0
                ? providerModels.reduce((sum, model) => sum + model.duration.avgMs * model.duration.sampleCount, 0) / latencySamples
                : null;
          const failedCount = providerModels.reduce((sum, model) => sum + (model.statusCounts?.failed ?? 0), 0);
          const reliabilityScore = provider.usage.invocationCount > 0 ? 1 - (failedCount / provider.usage.invocationCount) : 1;
          const successTone = reliabilityScore >= 0.95
            ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
            : reliabilityScore >= 0.8
              ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20"
              : "text-red-500 dark:text-red-400 bg-red-500/10 border border-red-500/20";

              return (
                <div key={provider.id} className={`${PANEL_CLASS} p-5`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`rounded-xl p-2 ${bg} ${text}`}>
                        <Icon className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? ""}</div>
                      </div>
                    </div>
                <div className="flex flex-wrap items-center gap-2 self-start">
                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.18em] ${successTone}`}>
                    {formatPercent(reliabilityScore * 100)}
                  </div>
                  <div className={`inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                    <span className="truncate text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                      {formatTokens(provider.usage.totalTokens)}
                    </span>
                    <span className="text-slate-400">tokens</span>
                  </div>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className={`${SUBPANEL_CLASS} p-4`}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Invocations</div>
                      <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{provider.usage.invocationCount.toLocaleString()}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">calls</div>
                    </div>
                    <div className={`${SUBPANEL_CLASS} p-4`}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active Time</div>
                      <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatDuration(provider.usage.activeTimeMs)}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">active</div>
                    </div>
                    <div className={`${SUBPANEL_CLASS} p-4`}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Efficiency</div>
                      <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">
                        {provider.usage.invocationCount > 0
                          ? `${formatTokens(Math.round(provider.usage.totalTokens / provider.usage.invocationCount))}/call`
                          : "—"}
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">avg tokens/call</div>
                    </div>
                    <div className={`${SUBPANEL_CLASS} p-4`}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Avg Latency</div>
                      <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">
                        {avgLatencyMs !== null ? formatDuration(avgLatencyMs) : "—"}
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        {latencySamples > 0 ? `${latencySamples.toLocaleString()} samples` : "no samples"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-5">
                    <TokenFlowBar
                      input={provider.usage.inputTokens}
                      cached={provider.usage.cachedInputTokens}
                      output={provider.usage.outputTokens}
                      reasoning={provider.usage.reasoningOutputTokens}
                      total={provider.usage.totalTokens}
                    />
                  </div>
                  <div className="mt-4 flex justify-end">
                    <div className={`inline-flex items-center rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS} ${sourceQuality.tone}`}>
                      {sourceQuality.label}
                    </div>
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
