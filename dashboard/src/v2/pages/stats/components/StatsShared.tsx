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
} from "../../../types.js";
import {
  formatTokens,
  formatDuration,
  formatPercent,
  formatDateTime,
  sumUsage,
  createSeries,
  getPurposeConfig,
} from "../stats-utils.js";
import { useStatsPageData } from "../use-stats-page-data.js";
import type { UsageChartState } from "../use-usage-chart-state.js";

export * from "./stats-geometry.js";
export * from "./stats-formatters.js";
export * from "./stats-ui-primitives.js";

import { PANEL_CLASS, SUBPANEL_CLASS, CHIP_CLASS, LEDGER_ROW_CLASS, LEDGER_ROW_MODERN_CLASS, SignalMetricCard, DonutCard, PurposeRibbon, StudioHeader, TokenChip, TokenFlowBar, ChurnFlowBar, SortButton, ViewToggle, SeriesLegendButton, CHART_SERIES, type StatsVisualMode, type ChartSeriesId } from "./stats-ui-primitives.js";
import { formatDay, formatHourTick, formatShortDate, toTimestamp, getAxisLabelStep, formatAxisLabel, getLedgerSortValue } from "./stats-formatters.js";
import { buildPath, buildSmoothPath, buildAreaPath, buildSmoothAreaPath, buildPoints, polarToCartesian, buildDonutArcPath, buildDonutSlices } from "./stats-geometry.js";
import { InteractiveUsageChart } from "./InteractiveUsageChart.js";
export { InteractiveUsageChart };

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
  planningUsage,
  chartState,
}) => (
  <section className="space-y-6">


    <InteractiveUsageChart
      stats={stats}
      loading={loading}
      error={error}
      refresh={refresh}
      chartState={chartState}
    />
  </section>
);

export const CompositionStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, tokenSegments }) => (
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
          </div>
          <div className="rounded-2xl border border-cyan-500/16 bg-cyan-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600 dark:text-cyan-400">
              <Database className="h-3.5 w-3.5" strokeWidth={2.1} />
              Cached
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.cachedInputTokens)}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.1} />
              Output
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.outputTokens)}</div>
          </div>
          <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">
              <Brain className="h-3.5 w-3.5" strokeWidth={2.1} />
              Reasoning
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.reasoningOutputTokens)}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export const ReliabilityStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, sourceSegments }) => (
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
          </div>
          <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">Estimated</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.estimatedInvocationCount}</div>
          </div>
          <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">Unavailable</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unavailableInvocationCount}</div>
          </div>
          <div className="rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Unsupported</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unsupportedInvocationCount}</div>
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
  </section>
);
