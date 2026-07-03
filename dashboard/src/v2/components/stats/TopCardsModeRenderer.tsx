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
import {
  buildModelHighlights,
  buildTelemetrySourceSummary,
  computeUsageEfficiency,
  formatSuccessRate,
} from "../../pages/stats/model-insights.js";
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

function formatMaybeCount(value: number | null | undefined, hasData: boolean): string {
  return hasData ? formatCount(value) : "—";
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatShare(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatTokenVelocity(tokens: number, activeTimeMs: number): string {
  if (tokens <= 0 || activeTimeMs <= 0) return "—";
  const tokensPerMinute = tokens / Math.max(1, activeTimeMs / 60000);
  if (tokensPerMinute >= 1000) {
    return `${(tokensPerMinute / 1000).toFixed(1)}k/min`;
  }
  return `${Math.round(tokensPerMinute).toLocaleString()}/min`;
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
  const unavailable = stats.usage.unavailableInvocationCount || 0;
  const unsupported = stats.usage.unsupportedInvocationCount || 0;
  const measured = reported + estimated + unavailable + unsupported;
  return measured > 0 ? (reported / measured) * 100 : null;
}

function getTopPurpose(stats: ProjectExecutionStatsSnapshot) {
  return [...(stats.purposes || [])].sort((left, right) => right.usage.totalTokens - left.usage.totalTokens)[0] || null;
}

function getSegmentShare(segment: SegmentDefinition | null, total: number): number | null {
  if (!segment || total <= 0) return null;
  return (segment.value / total) * 100;
}

function getDataQualityHint(usage: ProjectExecutionStatsSnapshot["usage"]): string {
  const degraded = (usage.estimatedInvocationCount || 0) + (usage.unavailableInvocationCount || 0) + (usage.unsupportedInvocationCount || 0);
  if ((usage.reportedInvocationCount || 0) === 0 && degraded === 0) return "No telemetry";
  if (degraded === 0) return "Reported";
  if ((usage.unavailableInvocationCount || 0) > 0 || (usage.unsupportedInvocationCount || 0) > 0) return "Partial";
  return "Estimated mix";
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
  const hasInvocationData = usage.invocationCount > 0 || finishedCount > 0;
  const hasTokenData = usage.totalTokens > 0;
  const hasCostData = usage.totalCostUsd > 0;
  const tokenVelocity = formatTokenVelocity(usage.totalTokens, usage.activeTimeMs);
  const qualityHint = getDataQualityHint(usage);
  const telemetrySummary = buildTelemetrySourceSummary(usage);

  const renderTrendMode = () => {
    return (
      <>
        <StatsMetricCard
          label="Total Tokens"
          value={hasTokenData ? formatTokens(usage.totalTokens) : "No tokens"}
          detail={hasTokenData ? `Input ${formatTokens(usage.inputTokens)} · output ${formatTokens(usage.outputTokens)}` : "No token telemetry in this window"}
          secondaryDetail={hasTokenData ? `${formatTokens(usage.reasoningOutputTokens)} reasoning · ${formatTokens(usage.cachedInputTokens)} cached` : stats.range.label}
          qualityHint={qualityHint}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel="Throughput"
        />
        <StatsMetricCard
          label="Active Time"
          value={hasInvocationData ? formatStatsDuration(usage.activeTimeMs) : "No runs"}
          detail={hasInvocationData ? `Wall ${formatStatsDuration(usage.wallTimeMs)} across the selected window` : "No invocation runtime samples yet"}
          secondaryDetail={duration.sampleCount > 0 ? `Median ${formatStatsDuration(duration.p50Ms)} · p95 ${formatStatsDuration(duration.p95Ms)}` : "Latency samples unavailable"}
          qualityHint={duration.sampleCount > 0 ? `${formatCount(duration.sampleCount)} samples` : "Low data"}
          accentHex={STATS_COLORS.ember}
          sparkline={metricSeries.activeTime}
          signalLabel="Runtime"
        />
        <StatsMetricCard
          label="Cost"
          value={hasCostData ? formatCost(usage.totalCostUsd) : "No cost"}
          detail={hasCostData ? `Input ${formatCost(usage.inputCostUsd)} · output ${formatCost(usage.outputCostUsd)}` : "Pricing telemetry has not produced spend"}
          secondaryDetail={`Cached input ${formatCost(usage.cachedInputCostUsd)}`}
          qualityHint={hasCostData ? "Priced" : "Unpriced"}
          accentHex={STATS_COLORS.clay}
          sparkline={metricSeries.totalCost}
          signalLabel="Spend"
        />
        <StatsMetricCard
          label="Invocations"
          value={formatMaybeCount(usage.invocationCount, hasInvocationData)}
          detail={hasInvocationData ? `${formatCount(finishedCount)} finished · ${formatCount(statusCounts.running)} running` : "No provider invocations recorded"}
          secondaryDetail={`${formatCount(statusCounts.completed)} completed · ${formatCount(statusCounts.failed)} failed`}
          qualityHint={successRate === null ? "No outcome" : `${formatShare(successRate)} success`}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.invocations}
          signalLabel="Volume"
        />
        <StatsMetricCard
          label="Cache Rate"
          value={hasTokenData ? formatRate(cacheRate) : "—"}
          detail={hasTokenData ? `${formatTokens(usage.cachedInputTokens)} cached input tokens` : "Prompt-token cache telemetry unavailable"}
          secondaryDetail={tokenVelocity !== "—" ? `${tokenVelocity} token velocity` : "Token velocity unavailable"}
          qualityHint={cacheRate > 0 ? "Efficiency" : "Low data"}
          accentHex={STATS_COLORS.amber}
          sparkline={hasTokenData ? metricSeries.cacheRate : []}
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
    const topProviderShare = getSegmentShare(topProvider, usage.totalTokens);
    const topTokenSegment = tokenSegments.length > 0 ? tokenSegments[0]! : null;
    const topSourceSegment = sourceSegments.length > 0 ? sourceSegments[0]! : null;
    const topSourceTotal = sourceSegments.reduce((total, segment) => total + segment.value, 0);
    const topPurpose = getTopPurpose(stats);

    return (
      <>
        <StatsMetricCard
          label="Provider Share"
          value={topProvider ? formatShare(topProviderShare) : "No data"}
          detail={topProvider ? `${topProvider.label} leads ${providerCount} provider rows` : "No provider rows in this window"}
          secondaryDetail={topProviderRecord ? `${formatCount(topProviderRecord.usage.invocationCount)} calls · ${formatCost(topProviderRecord.usage.totalCostUsd)}` : "Provider telemetry unavailable"}
          qualityHint={providerCount > 1 ? "Mixed" : providerCount === 1 ? "Single provider" : "Empty"}
          accentHex={STATS_COLORS.clay}
          sparkline={topProviderRecord ? extractProviderSeries(stats, topProviderRecord.id) : []}
          signalLabel="Mix"
        />
        <StatsMetricCard
          label="Token Anatomy"
          value={hasTokenData ? formatTokens(usage.totalTokens) : "No tokens"}
          detail={topTokenSegment ? `${topTokenSegment.label} leads at ${formatShare(getSegmentShare(topTokenSegment, usage.totalTokens))}` : "No token anatomy available"}
          secondaryDetail={`Input ${formatTokens(usage.inputTokens)} · cached ${formatTokens(usage.cachedInputTokens)} · output ${formatTokens(usage.outputTokens)}`}
          qualityHint={tokenSegments.length > 0 ? `${tokenSegments.length} segments` : "Empty"}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel="Tokens"
        />
        <StatsMetricCard
          label="Source Mix"
          value={topSourceSegment ? formatShare(getSegmentShare(topSourceSegment, topSourceTotal)) : "No data"}
          detail={topSourceSegment ? `${topSourceSegment.label} is the dominant telemetry source` : "No source-count telemetry recorded"}
          secondaryDetail={telemetrySummary.detail}
          qualityHint={telemetrySummary.label}
          accentHex={STATS_COLORS.cyanMuted}
          sparkline={[]}
          signalLabel="Sources"
        />
        <StatsMetricCard
          label="Purpose Activity"
          value={topPurpose ? topPurpose.label : "No data"}
          detail={topPurpose ? `${formatCount(topPurpose.usage.invocationCount)} calls · ${formatTokens(topPurpose.usage.totalTokens)} tokens` : "No purpose activity recorded"}
          secondaryDetail={topPurpose ? `${formatStatsDuration(topPurpose.usage.activeTimeMs)} active · ${formatCost(topPurpose.usage.totalCostUsd)}` : "Purpose split unavailable"}
          qualityHint={stats.purposes.length > 1 ? `${stats.purposes.length} purposes` : "Low data"}
          accentHex={STATS_COLORS.moss}
          sparkline={topPurpose ? extractPurposeInvocationSeries(stats, topPurpose.id) : []}
          signalLabel="Purpose"
        />
        <StatsMetricCard
          label="Merge Conflicts"
          value={formatMaybeCount(stats.mergeConflictCount || stats.git?.totals?.mergeConflictCount, Boolean(stats.git?.totals))}
          detail={`${formatCount(stats.git?.totals?.filesChanged)} files changed in git telemetry`}
          secondaryDetail={`${formatCount(stats.git?.totals?.prCount)} PRs · ${formatCount(stats.git?.totals?.mergedCount)} merged`}
          qualityHint={(stats.mergeConflictCount || stats.git?.totals?.mergeConflictCount || 0) > 0 ? "Review" : "Clear"}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Git"
        />
      </>
    );
  };

  const renderReliabilityMode = () => {
    const degradedTelemetry = usage.unavailableInvocationCount + usage.unsupportedInvocationCount;
    const measuredFallback = usage.estimatedInvocationCount + degradedTelemetry;
    const fallbackQuality = usage.invocationCount > 0 ? (measuredFallback / usage.invocationCount) * 100 : null;

    return (
      <>
        <StatsMetricCard
          label="Provider Health"
          value={formatRate(successRate)}
          detail={finishedCount > 0 ? `${formatCount(statusCounts.completed)} completed of ${formatCount(finishedCount)} finished` : "No finished invocations to score"}
          secondaryDetail={`${formatCount(statusCounts.running)} running · ${formatCount(statusCounts.paused)} paused`}
          qualityHint={successRate === null ? "No outcome" : successRate >= 95 ? "Strong" : successRate >= 80 ? "Watch" : "At risk"}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.invocations}
          signalLabel="Health"
        />
        <StatsMetricCard
          label="Telemetry Mix"
          value={formatRate(reportedRate)}
          detail={telemetrySummary.detail}
          secondaryDetail={telemetrySummary.caveat}
          qualityHint={telemetrySummary.label}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel="Confidence"
        />
        <StatsMetricCard
          label="Failures"
          value={formatMaybeCount(statusCounts.failed, finishedCount > 0)}
          detail={finishedCount > 0 ? `${formatCount(statusCounts.cancelled)} cancelled in this window` : "No terminal failures recorded yet"}
          secondaryDetail={`${formatCount(finishedCount)} finished outcomes in range`}
          qualityHint={statusCounts.failed > 0 || statusCounts.cancelled > 0 ? "Investigate" : "Clear"}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Errors"
        />
        <StatsMetricCard
          label="Retry Signals"
          value={formatMaybeCount(statusCounts.paused + statusCounts.running, hasInvocationData)}
          detail={`${formatCount(statusCounts.running)} running · ${formatCount(statusCounts.paused)} paused`}
          secondaryDetail={duration.sampleCount > 0 ? `p95 latency ${formatStatsDuration(duration.p95Ms)}` : "Runtime distribution unavailable"}
          qualityHint={statusCounts.paused + statusCounts.running > 0 ? "Active" : "Idle"}
          accentHex={STATS_COLORS.amber}
          sparkline={[]}
          signalLabel="Queue"
        />
        <StatsMetricCard
          label="Telemetry Gaps"
          value={formatMaybeCount(degradedTelemetry, usage.invocationCount > 0 || degradedTelemetry > 0)}
          detail={`${formatCount(usage.unavailableInvocationCount)} unavailable · ${formatCount(usage.unsupportedInvocationCount)} unsupported`}
          secondaryDetail={fallbackQuality !== null ? `${formatRate(fallbackQuality)} fallback or missing source` : "No invocation-source denominator"}
          qualityHint={degradedTelemetry > 0 ? "Partial" : usage.estimatedInvocationCount > 0 ? "Estimated" : "Reported"}
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
    const topModelEfficiency = topModel ? computeUsageEfficiency(topModel.usage) : null;

    return (
      <>
        <StatsMetricCard
          label="Active Models"
          value={formatMaybeCount(models.length, models.length > 0)}
          detail={models.length > 0 ? "Distinct model rows with usage telemetry" : "No model telemetry in this window"}
          secondaryDetail={highlights.busiest ? `Busiest: ${highlights.busiest.model.label}` : "Need at least one model row"}
          qualityHint={models.length > 1 ? "Portfolio" : models.length === 1 ? "Single model" : "Empty"}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel="Models"
        />
        <StatsMetricCard
          label="Top Model"
          value={topModel ? topModel.label : "No data"}
          detail={topModel ? `${formatTokens(topModel.usage.totalTokens)} tokens · ${formatCount(topModel.usage.invocationCount)} calls` : "No model telemetry yet"}
          secondaryDetail={topModel && topModelEfficiency?.tokensPerCall !== null && topModelEfficiency?.tokensPerCall !== undefined ? `${Math.round(topModelEfficiency.tokensPerCall).toLocaleString()} tokens/call · ${topModel.provider}` : "Model mix unavailable"}
          qualityHint={topModel?.successRate !== null && topModel?.successRate !== undefined ? `${formatSuccessRate(topModel.successRate)} success` : "Low data"}
          accentHex={STATS_COLORS.signal}
          sparkline={topModel ? extractModelSeries(stats, topModel.id) : []}
          signalLabel="Models"
        />
        <StatsMetricCard
          label="Median Latency"
          value={duration.sampleCount > 0 ? formatStatsDuration(duration.p50Ms) : "—"}
          detail={duration.sampleCount > 0 ? `p95 ${formatStatsDuration(duration.p95Ms)} across ${formatCount(duration.sampleCount)} calls` : "No finished invocation samples"}
          secondaryDetail={highlights.fastest ? `Fastest: ${highlights.fastest.model.label} · ${highlights.fastest.value}` : "Latency ranking unavailable"}
          qualityHint={duration.sampleCount > 0 ? "Measured" : "Low data"}
          accentHex={STATS_COLORS.ember}
          sparkline={[]}
          signalLabel="Latency"
        />
        <StatsMetricCard
          label="Success Rate"
          value={formatSuccessRate(modelSuccessRate)}
          detail={`${formatCount(statusCounts.completed)} completed · ${formatCount(statusCounts.failed)} failed`}
          secondaryDetail={highlights.mostReliable ? `Best: ${highlights.mostReliable.model.label} · ${highlights.mostReliable.value}` : "Need completed model outcomes"}
          qualityHint={modelSuccessRate === null ? "No outcome" : modelSuccessRate >= 0.95 ? "Strong" : "Watch"}
          accentHex={STATS_COLORS.moss}
          sparkline={[]}
          signalLabel="Reliability"
        />
        <StatsMetricCard
          label="Cache Hit Rate"
          value={hasTokenData ? formatRate(cacheRate) : "—"}
          detail={highlights.bestCache ? `Best: ${highlights.bestCache.model.label} at ${highlights.bestCache.value}` : "Cached input share of all prompt tokens"}
          secondaryDetail={highlights.highestVelocity ? `Velocity: ${highlights.highestVelocity.model.label} · ${highlights.highestVelocity.value}` : "Velocity ranking unavailable"}
          qualityHint={highlights.bestCache ? "Optimized" : "Low data"}
          accentHex={STATS_COLORS.amber}
          sparkline={hasTokenData ? metricSeries.cacheRate : []}
          signalLabel="Efficiency"
        />
      </>
    );
  };

  const renderLedgersMode = () => {
    const taskTokens = tasks.reduce((total, task) => total + (task.usage.totalTokens || 0), 0);
    const sprintTokens = sprints.reduce((total, sprint) => total + (sprint.usage.totalTokens || 0), 0);
    const gitTotals = stats.git?.totals;

    return (
      <>
        <StatsMetricCard
          label="Task Rows"
          value={formatMaybeCount(tasks.length, tasks.length > 0)}
          detail={tasks.length > 0 ? `${formatTokens(taskTokens)} tokens across task ledgers` : "No task ledger rows in this window"}
          secondaryDetail={tasks[0] ? `Top task: ${tasks[0].label}` : "Task scope unavailable"}
          qualityHint={tasks.length > 0 ? "Scoped" : "Empty"}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel="Tasks"
        />
        <StatsMetricCard
          label="Sprint Rows"
          value={formatMaybeCount(sprints.length, sprints.length > 0)}
          detail={stats.activeSprint ? `Sprint ${stats.activeSprint.sprintNumber ?? "?"} active` : "Historical window"}
          secondaryDetail={sprints.length > 0 ? `${formatTokens(sprintTokens)} sprint-scoped tokens` : "No sprint ledger rows in range"}
          qualityHint={stats.activeSprint ? "Active" : "Archive"}
          accentHex={STATS_COLORS.clay}
          sparkline={metricSeries.invocations}
          signalLabel="Sprints"
        />
        <StatsMetricCard
          label="Pull Requests"
          value={formatMaybeCount(gitTotals?.prCount, Boolean(gitTotals) && (gitTotals?.prCount || 0) > 0)}
          detail={gitTotals && gitTotals.prCount > 0 ? `${formatCount(gitTotals.mergedCount)} merged PRs recorded` : "No pull request telemetry in range"}
          secondaryDetail={gitTotals ? `${formatCount(gitTotals.mergeConflictCount)} conflict signals` : "Git totals unavailable"}
          qualityHint={gitTotals?.prCount ? "Git" : "Low data"}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.gitPrs}
          signalLabel="Git"
        />
        <StatsMetricCard
          label="Files Changed"
          value={formatMaybeCount(gitTotals?.filesChanged, Boolean(gitTotals) && (gitTotals?.filesChanged || 0) > 0)}
          detail={gitTotals && gitTotals.filesChanged > 0 ? `${formatCount(gitTotals.insertions)} added · ${formatCount(gitTotals.deletions)} removed` : "No file-change telemetry in range"}
          secondaryDetail={gitTotals ? `${formatCount(gitTotals.prCount)} PRs · ${formatCount(gitTotals.mergedCount)} merged` : "Diff scope unavailable"}
          qualityHint={gitTotals?.filesChanged ? "Diff" : "Empty"}
          accentHex={STATS_COLORS.ember}
          sparkline={metricSeries.gitFilesChanged}
          signalLabel="Diff"
        />
        <StatsMetricCard
          label="Merge Conflicts"
          value={formatMaybeCount(gitTotals?.mergeConflictCount || stats.mergeConflictCount, Boolean(gitTotals) && ((gitTotals?.mergeConflictCount || stats.mergeConflictCount || 0) > 0))}
          detail={(gitTotals?.mergeConflictCount || stats.mergeConflictCount || 0) > 0 ? "Operational blockers found in git ledgers" : "No merge-conflict blockers recorded"}
          secondaryDetail={gitTotals ? `${formatCount(gitTotals.filesChanged)} files touched` : "Git conflict scope unavailable"}
          qualityHint={(gitTotals?.mergeConflictCount || stats.mergeConflictCount || 0) > 0 ? "Blocked" : "Clear"}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel="Blocks"
        />
      </>
    );
  };

  const renderSystemMode = () => {
    const sourceRows = sourceSegments.length || (stats.tokenSources || []).length;
    const toolCallCount = usage.toolCallCount || 0;

    return (
      <>
        <StatsMetricCard
          label="Invocation Rows"
          value={formatMaybeCount(usage.invocationCount, hasInvocationData)}
          detail={duration.sampleCount > 0 ? `${formatCount(duration.sampleCount)} duration samples available` : "No invocation duration samples yet"}
          secondaryDetail={toolCallCount > 0 ? `${formatCount(toolCallCount)} tool calls captured` : "Tool-call telemetry unavailable"}
          qualityHint={usage.invocationCount > 0 ? "Indexed" : "Empty"}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.invocations}
          signalLabel="Rows"
        />
        <StatsMetricCard
          label="Provider Rows"
          value={formatMaybeCount(providers.length, providers.length > 0)}
          detail={providers.length > 0 ? `${formatCount(providerSegments.length)} provider segments in the deck` : "No provider rows in the system view"}
          secondaryDetail={providers[0] ? `Lead provider: ${providers[0].label}` : "Provider health unavailable"}
          qualityHint={providers.length > 1 ? "Mixed" : providers.length === 1 ? "Single" : "Empty"}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel="Providers"
        />
        <StatsMetricCard
          label="Model Rows"
          value={formatMaybeCount(models.length, models.length > 0)}
          detail={models[0] ? `${models[0].label} leads the current window` : "No top model in the current window"}
          secondaryDetail={models[0] ? `${formatStatsDuration(models[0].duration.p50Ms)} model p50 · ${formatCount(models[0].usage.invocationCount)} calls` : "Model latency unavailable"}
          qualityHint={models[0]?.successRate !== null && models[0]?.successRate !== undefined ? `${formatSuccessRate(models[0].successRate)} success` : "Low data"}
          accentHex={STATS_COLORS.ember}
          sparkline={models[0] ? extractModelSeries(stats, models[0].id) : []}
          signalLabel="Models"
        />
        <StatsMetricCard
          label="Source Rows"
          value={formatMaybeCount(sourceRows, sourceRows > 0)}
          detail={sourceRows > 0 ? `${formatCount(tokenSegments.length)} token anatomy segments` : "No source rows for telemetry quality"}
          secondaryDetail={telemetrySummary.detail}
          qualityHint={telemetrySummary.label}
          accentHex={STATS_COLORS.moss}
          sparkline={[]}
          signalLabel="Sources"
        />
        <StatsMetricCard
          label="System Health"
          value={formatRate(successRate)}
          detail={hasInvocationData ? `${formatCount(statusCounts.failed)} failed · ${formatCount(statusCounts.paused)} paused` : "No invocation outcomes to score"}
          secondaryDetail={`${formatCount(statusCounts.running)} running · ${formatCount(statusCounts.cancelled)} cancelled`}
          qualityHint={successRate === null ? "No outcome" : successRate >= 95 ? "Healthy" : "Watch"}
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
