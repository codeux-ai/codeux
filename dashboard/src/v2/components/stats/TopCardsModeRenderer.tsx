import type { FunctionComponent } from "preact";
import type {
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../types.js";
import { formatCost, formatTokens, formatStatsDuration } from "../../pages/stats/stats-utils.js";
import { StatsMetricCard } from "./StatsMetricCard.js";
import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import type { StatsVisualMode } from "../../pages/stats/components/stats-ui-primitives.js";
import {
  buildMetricSeries,
  extractModelSeries,
  extractProviderSeries,
  extractPurposeInvocationSeries,
} from "../../lib/stats/series-builders.js";
import { buildModelHighlights, formatSuccessRate } from "../../pages/stats/model-insights.js";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

export interface TopCardsModeRendererProps {
  mode: StatsVisualMode;
  stats: ProjectExecutionStatsSnapshot | null;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}

function formatCount(value: number | null | undefined): string {
  return (value || 0).toLocaleString();
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function calculateCacheRate(stats: ProjectExecutionStatsSnapshot): number {
  const inputTokens = stats.usage.inputTokens || 0;
  const cachedInputTokens = stats.usage.cachedInputTokens || 0;
  const promptTokens = inputTokens + cachedInputTokens;
  return promptTokens > 0 ? (cachedInputTokens / promptTokens) * 100 : 0;
}

function calculateSuccessRate(stats: ProjectExecutionStatsSnapshot): number | null {
  const statusCounts = stats.statusCounts || { completed: 0, failed: 0, cancelled: 0, running: 0, paused: 0 };
  const finished = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;
  return finished > 0 ? (statusCounts.completed / finished) * 100 : null;
}

function calculateReportedRate(stats: ProjectExecutionStatsSnapshot): number | null {
  const reported = stats.usage.reportedInvocationCount || 0;
  const estimated = stats.usage.estimatedInvocationCount || 0;
  const measured = reported + estimated;
  return measured > 0 ? (reported / measured) * 100 : null;
}

function getTopPurpose(stats: ProjectExecutionStatsSnapshot) {
  return [...(stats.purposes || [])].sort((left, right) => right.usage.totalTokens - left.usage.totalTokens)[0] || null;
}

export const TopCardsModeRenderer: FunctionComponent<TopCardsModeRendererProps> = ({
  mode,
  stats,
  providerSegments,
  tokenSegments,
  sourceSegments,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const prevMode = useRef(mode);

  useLayoutEffect(() => {
    if (!containerRef.current || prevMode.current === mode) return;

    if (reducedMotion) {
      prevMode.current = mode;
      return;
    }

    gsap.killTweensOf(containerRef.current.children);
    gsap.fromTo(
      containerRef.current.children,
      { opacity: 0, y: MODAL_MOTION.fieldStagger.yStart },
      {
        opacity: 1,
        y: 0,
        duration: MODAL_MOTION.fieldStagger.duration,
        stagger: MODAL_MOTION.fieldStagger.stagger,
        ease: MODAL_MOTION.fieldStagger.ease,
        clearProps: "all"
      }
    );
    prevMode.current = mode;
  }, [mode, reducedMotion]);

  if (!stats) return null;

  const metricSeries = buildMetricSeries(stats);
  const statusCounts = stats.statusCounts || { completed: 0, failed: 0, cancelled: 0, running: 0, paused: 0 };
  const usage = {
    ...stats.usage,
    invocationCount: stats.usage.invocationCount || 0,
    activeTimeMs: stats.usage.activeTimeMs || 0,
    wallTimeMs: stats.usage.wallTimeMs || 0,
    inputTokens: stats.usage.inputTokens || 0,
    cachedInputTokens: stats.usage.cachedInputTokens || 0,
    outputTokens: stats.usage.outputTokens || 0,
    reasoningOutputTokens: stats.usage.reasoningOutputTokens || 0,
    totalTokens: stats.usage.totalTokens
      || (stats.usage.inputTokens || 0) + (stats.usage.cachedInputTokens || 0) + (stats.usage.outputTokens || 0) + (stats.usage.reasoningOutputTokens || 0),
    reportedInvocationCount: stats.usage.reportedInvocationCount || 0,
    estimatedInvocationCount: stats.usage.estimatedInvocationCount || 0,
    unavailableInvocationCount: stats.usage.unavailableInvocationCount || 0,
    unsupportedInvocationCount: stats.usage.unsupportedInvocationCount || 0,
    totalCostUsd: stats.usage.totalCostUsd || 0,
    cachedInputCostUsd: stats.usage.cachedInputCostUsd || 0,
  };
  const providers = stats.providers || [];
  const models = stats.models || [];
  const tasks = stats.tasks || [];
  const sprints = stats.sprints || [];
  const duration = stats.duration || { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const cacheRate = calculateCacheRate(stats);
  const successRate = calculateSuccessRate(stats);
  const reportedRate = calculateReportedRate(stats);
  const finishedCount = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;

  const renderTrendMode = () => {
    return (
      <>
        <StatsMetricCard
          label="Total Tokens"
          value={formatTokens(usage.totalTokens)}
          detail={`Input ${formatTokens(usage.inputTokens)} · output ${formatTokens(usage.outputTokens)}`}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel="Throughput"
        />
        <StatsMetricCard
          label="Active Time"
          value={formatStatsDuration(usage.activeTimeMs)}
          detail={`Wall ${formatStatsDuration(usage.wallTimeMs)} across the selected window`}
          accentHex={STATS_COLORS.ember}
          sparkline={metricSeries.activeTime}
          signalLabel="Runtime"
        />
        <StatsMetricCard
          label="Cost"
          value={formatCost(usage.totalCostUsd)}
          detail={`Cached input cost ${formatCost(usage.cachedInputCostUsd)}`}
          accentHex={STATS_COLORS.clay}
          sparkline={metricSeries.totalCost}
          signalLabel="Spend"
        />
        <StatsMetricCard
          label="Invocations"
          value={formatCount(usage.invocationCount)}
          detail={`${formatCount(finishedCount)} finished · ${formatCount(statusCounts.running)} running`}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.invocations}
          signalLabel="Volume"
        />
        <StatsMetricCard
          label="Cache Rate"
          value={formatRate(cacheRate)}
          detail={`${formatTokens(usage.cachedInputTokens)} cached input tokens`}
          accentHex={STATS_COLORS.amber}
          sparkline={metricSeries.cacheRate}
          signalLabel="Efficiency"
        />
      </>
    );
  };

  const renderCompositionMode = () => {
    const providerCount = providerSegments.length;
    const topProvider = providerSegments.length > 0 ? providerSegments[0] : null;
    const topProviderRecord = topProvider
      ? providers.find((provider) => provider.label === topProvider.label || provider.id === topProvider.label) || null
      : null;
    const topProviderShare = topProvider && usage.totalTokens > 0
      ? (topProvider.value / usage.totalTokens) * 100
      : null;
    const topPurpose = getTopPurpose(stats);

    return (
      <>
        <StatsMetricCard
          label="Provider Share"
          value={topProvider ? formatRate(topProviderShare) : "None"}
          detail={topProvider ? `${topProvider.label} leads ${providerCount} provider rows` : "No provider rows in this window"}
          accentHex={STATS_COLORS.clay}
          sparkline={topProviderRecord ? extractProviderSeries(stats, topProviderRecord.id) : []}
          signalLabel="Mix"
        />
        <StatsMetricCard
          label="Token Anatomy"
          value={formatTokens(usage.totalTokens)}
          detail={`Input ${formatTokens(usage.inputTokens)} · cached ${formatTokens(usage.cachedInputTokens)} · output ${formatTokens(usage.outputTokens)}`}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel="Tokens"
        />
        <StatsMetricCard
          label="Purpose Activity"
          value={topPurpose ? topPurpose.label : "None"}
          detail={topPurpose ? `${formatCount(topPurpose.usage.invocationCount)} calls · ${formatTokens(topPurpose.usage.totalTokens)} tokens` : "No purpose activity recorded"}
          accentHex={STATS_COLORS.moss}
          sparkline={topPurpose ? extractPurposeInvocationSeries(stats, topPurpose.id) : []}
          signalLabel="Purpose"
        />
        <StatsMetricCard
          label="Merge Conflicts"
          value={formatCount(stats.mergeConflictCount || stats.git?.totals?.mergeConflictCount)}
          detail={`${formatCount(stats.git?.totals?.filesChanged)} files changed in git telemetry`}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Git"
        />
      </>
    );
  };

  const renderReliabilityMode = () => {
    const degradedTelemetry = usage.unavailableInvocationCount + usage.unsupportedInvocationCount;

    return (
      <>
        <StatsMetricCard
          label="Provider Health"
          value={formatRate(successRate)}
          detail={`${formatCount(statusCounts.completed)} completed of ${formatCount(finishedCount)} finished`}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.invocations}
          signalLabel="Health"
        />
        <StatsMetricCard
          label="Telemetry Mix"
          value={formatRate(reportedRate)}
          detail={`${formatCount(usage.reportedInvocationCount)} reported · ${formatCount(usage.estimatedInvocationCount)} estimated`}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel="Confidence"
        />
        <StatsMetricCard
          label="Failures"
          value={formatCount(statusCounts.failed)}
          detail={`${formatCount(statusCounts.cancelled)} cancelled in this window`}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Errors"
        />
        <StatsMetricCard
          label="Retry Signals"
          value={formatCount(statusCounts.paused + statusCounts.running)}
          detail={`${formatCount(statusCounts.running)} running · ${formatCount(statusCounts.paused)} paused`}
          accentHex={STATS_COLORS.amber}
          sparkline={[]}
          signalLabel="Queue"
        />
        <StatsMetricCard
          label="Telemetry Gaps"
          value={formatCount(degradedTelemetry)}
          detail={`${formatCount(usage.unavailableInvocationCount)} unavailable · ${formatCount(usage.unsupportedInvocationCount)} unsupported`}
          accentHex={STATS_COLORS.wallRuntime}
          sparkline={[]}
          signalLabel="Sources"
        />
      </>
    );
  };

  const renderModelsMode = () => {
    const topModel = models.length > 0 ? models[0]! : null;
    const highlights = buildModelHighlights(models);
    const totalFinished = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;
    const modelSuccessRate = totalFinished > 0 ? (statusCounts.completed / totalFinished) : null;

    return (
      <>
        <StatsMetricCard
          label="Active Models"
          value={formatCount(models.length)}
          detail="Distinct model rows with usage telemetry"
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel="Models"
        />
        <StatsMetricCard
          label="Top Model"
          value={topModel ? topModel.label : "None"}
          detail={topModel ? `${formatTokens(topModel.usage.totalTokens)} tokens · ${formatCount(topModel.usage.invocationCount)} calls` : "No model telemetry yet"}
          accentHex={STATS_COLORS.signal}
          sparkline={topModel ? extractModelSeries(stats, topModel.id) : []}
          signalLabel="Models"
        />
        <StatsMetricCard
          label="Median Latency"
          value={duration.sampleCount > 0 ? formatStatsDuration(duration.p50Ms) : "—"}
          detail={duration.sampleCount > 0 ? `p95 ${formatStatsDuration(duration.p95Ms)} across ${formatCount(duration.sampleCount)} calls` : "No finished invocation samples"}
          accentHex={STATS_COLORS.ember}
          sparkline={[]}
          signalLabel="Latency"
        />
        <StatsMetricCard
          label="Success Rate"
          value={formatSuccessRate(modelSuccessRate)}
          detail={`${formatCount(statusCounts.completed)} completed · ${formatCount(statusCounts.failed)} failed`}
          accentHex={STATS_COLORS.moss}
          sparkline={[]}
          signalLabel="Reliability"
        />
        <StatsMetricCard
          label="Cache Hit Rate"
          value={formatRate(cacheRate)}
          detail={highlights.bestCache ? `Best: ${highlights.bestCache.model.label} at ${highlights.bestCache.value}` : "Cached input share of all prompt tokens"}
          accentHex={STATS_COLORS.amber}
          sparkline={metricSeries.cacheRate}
          signalLabel="Efficiency"
        />
      </>
    );
  };

  const renderLedgersMode = () => {
    return (
      <>
        <StatsMetricCard
          label="Task Rows"
          value={formatCount(tasks.length)}
          detail={`${formatTokens(tasks.reduce((total, task) => total + (task.usage.totalTokens || 0), 0))} tokens across task ledgers`}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel="Tasks"
        />
        <StatsMetricCard
          label="Sprint Rows"
          value={formatCount(sprints.length)}
          detail={`${stats.activeSprint ? `Sprint ${stats.activeSprint.sprintNumber ?? "?"} active` : "Historical window"}`}
          accentHex={STATS_COLORS.clay}
          sparkline={metricSeries.invocations}
          signalLabel="Sprints"
        />
        <StatsMetricCard
          label="Pull Requests"
          value={formatCount(stats.git?.totals?.prCount)}
          detail={`${formatCount(stats.git?.totals?.mergedCount)} merged commits recorded`}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.gitPrs}
          signalLabel="Git"
        />
        <StatsMetricCard
          label="Files Changed"
          value={formatCount(stats.git?.totals?.filesChanged)}
          detail={`${formatCount(stats.git?.totals?.insertions)} added · ${formatCount(stats.git?.totals?.deletions)} removed`}
          accentHex={STATS_COLORS.ember}
          sparkline={metricSeries.gitFilesChanged}
          signalLabel="Diff"
        />
        <StatsMetricCard
          label="Merge Conflicts"
          value={formatCount(stats.git?.totals?.mergeConflictCount || stats.mergeConflictCount)}
          detail="Operational blockers found in git ledgers"
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Blocks"
        />
      </>
    );
  };

  const renderSystemMode = () => {
    return (
      <>
        <StatsMetricCard
          label="Invocation Rows"
          value={formatCount(usage.invocationCount)}
          detail={`${formatCount(duration.sampleCount)} duration samples available`}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.invocations}
          signalLabel="Rows"
        />
        <StatsMetricCard
          label="Provider Rows"
          value={formatCount(providers.length)}
          detail={`${formatCount(providerSegments.length)} provider segments in the deck`}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel="Providers"
        />
        <StatsMetricCard
          label="Model Rows"
          value={formatCount(models.length)}
          detail={`${models[0]?.label || "No top model"} in the current window`}
          accentHex={STATS_COLORS.ember}
          sparkline={models[0] ? extractModelSeries(stats, models[0].id) : []}
          signalLabel="Models"
        />
        <StatsMetricCard
          label="Source Rows"
          value={formatCount(sourceSegments.length || (stats.tokenSources || []).length)}
          detail={`${formatCount(tokenSegments.length)} token anatomy segments`}
          accentHex={STATS_COLORS.moss}
          sparkline={[]}
          signalLabel="Sources"
        />
        <StatsMetricCard
          label="System Health"
          value={formatRate(successRate)}
          detail={`${formatCount(statusCounts.failed)} failed · ${formatCount(statusCounts.paused)} paused`}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Ops"
        />
      </>
    );
  };

  let cardsContent = null;
  if (mode === "trend") {
    cardsContent = renderTrendMode();
  } else if (mode === "composition") {
    cardsContent = renderCompositionMode();
  } else if (mode === "models") {
    cardsContent = renderModelsMode();
  } else if (mode === "reliability") {
    cardsContent = renderReliabilityMode();
  } else if (mode === "ledgers") {
    cardsContent = renderLedgersMode();
  } else if (mode === "system") {
    cardsContent = renderSystemMode();
  }

  return (
    <section
      ref={containerRef}
      className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 [&>*]:min-w-0"
      data-testid="top-cards-renderer"
    >
      {cardsContent}
    </section>
  );
};
