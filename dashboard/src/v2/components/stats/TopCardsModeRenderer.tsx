import type { FunctionComponent } from "preact";
import type {
  ExecutionModelStatsSummary,
  ExecutionStatsEntitySummary,
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
import { useStatsI18n } from "../../pages/stats/stats-i18n.js";
import type { DashboardLocale } from "../../i18n/index.js";

export interface TopCardsModeRendererProps {
  mode: StatsVisualMode;
  stats: ProjectExecutionStatsSnapshot | null;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}

function formatCount(value: number | null | undefined, locale: DashboardLocale): string {
  return new Intl.NumberFormat(locale).format(value || 0);
}

function formatMaybeCount(value: number | null | undefined, hasData: boolean, locale: DashboardLocale): string {
  return hasData ? formatCount(value, locale) : "—";
}

function formatRate(value: number | null, locale: DashboardLocale): string {
  return value === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100);
}

function formatShare(value: number | null, locale: DashboardLocale): string {
  return value === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value / 100);
}

function formatTokenVelocity(tokens: number, activeTimeMs: number, locale: DashboardLocale): string {
  if (tokens <= 0 || activeTimeMs <= 0) return "—";
  const tokensPerMinute = tokens / Math.max(1, activeTimeMs / 60000);
  if (tokensPerMinute >= 1000) {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tokensPerMinute / 1000)}k/min`;
  }
  return `${new Intl.NumberFormat(locale).format(Math.round(tokensPerMinute))}/min`;
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

function getTopUsageEntity(items: ExecutionStatsEntitySummary[]): ExecutionStatsEntitySummary | null {
  return [...items].sort((left, right) => {
    const tokenDelta = (right.usage.totalTokens || 0) - (left.usage.totalTokens || 0);
    if (tokenDelta !== 0) return tokenDelta;
    return (right.usage.invocationCount || 0) - (left.usage.invocationCount || 0);
  })[0] || null;
}

function getTopModel(models: ExecutionModelStatsSummary[]): ExecutionModelStatsSummary | null {
  return [...models].sort((left, right) => {
    const tokenDelta = (right.usage.totalTokens || 0) - (left.usage.totalTokens || 0);
    if (tokenDelta !== 0) return tokenDelta;
    return (right.usage.invocationCount || 0) - (left.usage.invocationCount || 0);
  })[0] || null;
}

function sortSegmentsByValue(segments: SegmentDefinition[]): SegmentDefinition[] {
  return [...segments].sort((left, right) => right.value - left.value);
}

function getSegmentShare(segment: SegmentDefinition | null, total: number): number | null {
  if (!segment || total <= 0) return null;
  return (segment.value / total) * 100;
}

export const TopCardsModeRenderer: FunctionComponent<TopCardsModeRendererProps> = ({
  mode,
  stats,
  providerSegments,
  tokenSegments,
  sourceSegments,
}) => {
  const { locale, text, plural } = useStatsI18n();
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
  const sortedProviderSegments = sortSegmentsByValue(providerSegments);
  const sortedTokenSegments = sortSegmentsByValue(tokenSegments);
  const sortedSourceSegments = sortSegmentsByValue(sourceSegments);
  const topProviderEntity = getTopUsageEntity(providers);
  const topModelEntity = getTopModel(models);
  const topTask = getTopUsageEntity(tasks);
  const topSprint = getTopUsageEntity(sprints);
  const duration = stats.duration || { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const cacheRate = calculateCacheRate(stats);
  const successRate = calculateSuccessRate(stats);
  const reportedRate = calculateReportedRate(stats);
  const finishedCount = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;
  const hasInvocationData = usage.invocationCount > 0 || finishedCount > 0;
  const hasTokenData = usage.totalTokens > 0;
  const hasCostData = usage.totalCostUsd > 0;
  const tokenVelocity = formatTokenVelocity(usage.totalTokens, usage.activeTimeMs, locale);
  const qualityHint = (() => {
    const degraded = usage.estimatedInvocationCount + usage.unavailableInvocationCount + usage.unsupportedInvocationCount;
    if (usage.reportedInvocationCount === 0 && degraded === 0) return text("noTelemetry");
    if (degraded === 0) return text("reported");
    if (usage.unavailableInvocationCount > 0 || usage.unsupportedInvocationCount > 0) return text("partial");
    return locale === "de" ? "Geschätzter Mix" : "Estimated mix";
  })();
  const telemetrySummary = buildTelemetrySourceSummary(usage, locale);

  const renderTrendMode = () => {
    return (
      <>
        <StatsMetricCard
          label={text("invocations")}
          value={formatMaybeCount(usage.invocationCount, hasInvocationData, locale)}
          detail={hasInvocationData ? text("finishedRunning", { finished: formatCount(finishedCount, locale), running: formatCount(statusCounts.running, locale) }) : text("noProviderInvocations")}
          secondaryDetail={text("completedFailed", { completed: formatCount(statusCounts.completed, locale), failed: formatCount(statusCounts.failed, locale) })}
          qualityHint={successRate === null ? text("noOutcome") : text("successValue", { value: formatShare(successRate, locale) })}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.invocations}
          signalLabel={text("work")}
        />
        <StatsMetricCard
          label={text("cost")}
          value={hasCostData ? formatCost(usage.totalCostUsd, locale) : text("noCost")}
          detail={hasCostData ? text("inputOutputCost", { input: formatCost(usage.inputCostUsd, locale), output: formatCost(usage.outputCostUsd, locale) }) : text("noSpend")}
          secondaryDetail={text("cachedInputQuality", { cost: formatCost(usage.cachedInputCostUsd, locale), quality: qualityHint })}
          qualityHint={hasCostData ? text("priced") : text("unpriced")}
          accentHex={STATS_COLORS.clay}
          sparkline={metricSeries.totalCost}
          signalLabel={text("spend")}
        />
        <StatsMetricCard
          label={text("totalTokens")}
          value={hasTokenData ? formatTokens(usage.totalTokens, locale) : text("noTokens")}
          detail={hasTokenData ? text("inputOutputTokens", { input: formatTokens(usage.inputTokens, locale), output: formatTokens(usage.outputTokens, locale) }) : text("noTokenTelemetry")}
          secondaryDetail={hasTokenData ? text("reasoningCached", { reasoning: formatTokens(usage.reasoningOutputTokens, locale), cached: formatTokens(usage.cachedInputTokens, locale) }) : stats.range.label}
          qualityHint={qualityHint}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel={text("throughput")}
        />
        <StatsMetricCard
          label={text("activeTime")}
          value={hasInvocationData ? formatStatsDuration(usage.activeTimeMs, locale) : text("noRuns")}
          detail={hasInvocationData ? text("wallAcrossWindow", { duration: formatStatsDuration(usage.wallTimeMs, locale) }) : text("noRuntimeSamples")}
          secondaryDetail={duration.sampleCount > 0 ? text("latencySamples", { p50: formatStatsDuration(duration.p50Ms, locale), p95: formatStatsDuration(duration.p95Ms, locale) }) : text("latencyUnavailable")}
          qualityHint={duration.sampleCount > 0 ? plural("samples", duration.sampleCount, { count: formatCount(duration.sampleCount, locale) }) : text("lowData")}
          accentHex={STATS_COLORS.ember}
          sparkline={metricSeries.activeTime}
          signalLabel={text("runtime")}
        />
        <StatsMetricCard
          label={text("cacheRate")}
          value={hasTokenData ? formatRate(cacheRate, locale) : "—"}
          detail={hasTokenData ? text("cachedInputTokens", { tokens: formatTokens(usage.cachedInputTokens, locale) }) : text("cacheUnavailable")}
          secondaryDetail={tokenVelocity !== "—" ? text("tokenVelocity", { velocity: tokenVelocity }) : text("tokenVelocityUnavailable")}
          qualityHint={cacheRate > 0 ? text("efficiency") : text("lowData")}
          accentHex={STATS_COLORS.amber}
          sparkline={hasTokenData ? metricSeries.cacheRate : []}
          signalLabel={text("efficiency")}
        />
      </>
    );
  };

  const renderCompositionMode = () => {
    const providerCount = sortedProviderSegments.length;
    const topProvider = sortedProviderSegments.length > 0 ? sortedProviderSegments[0]! : null;
    const topProviderRecord = topProvider
      ? providers.find((provider) => provider.label === topProvider.label || provider.id === topProvider.label) || null
      : null;
    const topProviderShare = getSegmentShare(topProvider, usage.totalTokens);
    const topTokenSegment = sortedTokenSegments.length > 0 ? sortedTokenSegments[0]! : null;
    const topSourceSegment = sortedSourceSegments.length > 0 ? sortedSourceSegments[0]! : null;
    const topSourceTotal = sortedSourceSegments.reduce((total, segment) => total + segment.value, 0);
    const topPurpose = getTopPurpose(stats);

    return (
      <>
        <StatsMetricCard
          label={text("providerShare")}
          value={topProvider ? formatShare(topProviderShare, locale) : text("noData")}
          detail={topProvider ? text("providerLeads", { provider: topProvider.label, count: formatCount(providerCount, locale) }) : text("noProviderRows")}
          secondaryDetail={topProviderRecord ? text("providerCallsCostShare", { calls: formatCount(topProviderRecord.usage.invocationCount, locale), cost: formatCost(topProviderRecord.usage.totalCostUsd, locale), share: formatShare(topProviderShare, locale) }) : text("providerTelemetryUnavailable")}
          qualityHint={providerCount > 1 ? text("mixed") : providerCount === 1 ? text("singleProvider") : text("empty")}
          accentHex={STATS_COLORS.clay}
          sparkline={topProviderRecord ? extractProviderSeries(stats, topProviderRecord.id) : []}
          signalLabel={text("mix")}
        />
        <StatsMetricCard
          label={text("tokenAnatomy")}
          value={hasTokenData ? formatTokens(usage.totalTokens, locale) : text("noTokens")}
          detail={topTokenSegment ? text("segmentLeads", { segment: topTokenSegment.label, share: formatShare(getSegmentShare(topTokenSegment, usage.totalTokens), locale) }) : text("noTokenAnatomy")}
          secondaryDetail={text("tokenBreakdown", { input: formatTokens(usage.inputTokens, locale), cached: formatTokens(usage.cachedInputTokens, locale), output: formatTokens(usage.outputTokens, locale) })}
          qualityHint={sortedTokenSegments.length > 0 ? plural("segments", sortedTokenSegments.length, { count: formatCount(sortedTokenSegments.length, locale) }) : text("empty")}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel={text("tokens")}
        />
        <StatsMetricCard
          label={text("sourceMix")}
          value={topSourceSegment ? formatShare(getSegmentShare(topSourceSegment, topSourceTotal), locale) : text("noData")}
          detail={topSourceSegment ? text("dominantSource", { source: topSourceSegment.label }) : text("noSourceCounts")}
          secondaryDetail={telemetrySummary.detail}
          qualityHint={telemetrySummary.label}
          accentHex={STATS_COLORS.cyanMuted}
          sparkline={[]}
          signalLabel={text("sources")}
        />
        <StatsMetricCard
          label={text("purposeActivity")}
          value={topPurpose ? topPurpose.label : text("noData")}
          detail={topPurpose ? text("purposeCallsTokens", { calls: formatCount(topPurpose.usage.invocationCount, locale), tokens: formatTokens(topPurpose.usage.totalTokens, locale) }) : text("noPurposeActivity")}
          secondaryDetail={topPurpose ? text("purposeActiveCost", { duration: formatStatsDuration(topPurpose.usage.activeTimeMs, locale), cost: formatCost(topPurpose.usage.totalCostUsd, locale) }) : text("purposeSplitUnavailable")}
          qualityHint={stats.purposes.length > 1 ? plural("purposesCount", stats.purposes.length, { count: formatCount(stats.purposes.length, locale) }) : text("lowData")}
          accentHex={STATS_COLORS.moss}
          sparkline={topPurpose ? extractPurposeInvocationSeries(stats, topPurpose.id) : []}
          signalLabel={text("purpose")}
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
          label={text("telemetryMix")}
          value={formatRate(reportedRate, locale)}
          detail={telemetrySummary.detail}
          secondaryDetail={telemetrySummary.caveat}
          qualityHint={telemetrySummary.label}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel={text("confidence")}
        />
        <StatsMetricCard
          label={text("telemetryGaps")}
          value={formatMaybeCount(degradedTelemetry, usage.invocationCount > 0 || degradedTelemetry > 0, locale)}
          detail={text("unavailableUnsupported", { unavailable: formatCount(usage.unavailableInvocationCount, locale), unsupported: formatCount(usage.unsupportedInvocationCount, locale) })}
          secondaryDetail={fallbackQuality !== null ? text("fallbackMissingSource", { rate: formatRate(fallbackQuality, locale) }) : text("noSourceDenominator")}
          qualityHint={degradedTelemetry > 0 ? text("partial") : usage.estimatedInvocationCount > 0 ? text("estimated") : text("reported")}
          accentHex={STATS_COLORS.wallRuntime}
          sparkline={[]}
          signalLabel={text("sources")}
        />
        <StatsMetricCard
          label={text("providerHealth")}
          value={formatRate(successRate, locale)}
          detail={finishedCount > 0 ? text("completedOfFinished", { completed: formatCount(statusCounts.completed, locale), finished: formatCount(finishedCount, locale) }) : text("noFinishedToScore")}
          secondaryDetail={topProviderEntity ? text("topProviderCalls", { provider: topProviderEntity.label, calls: formatCount(topProviderEntity.usage.invocationCount, locale) }) : text("runningPaused", { running: formatCount(statusCounts.running, locale), paused: formatCount(statusCounts.paused, locale) })}
          qualityHint={successRate === null ? text("noOutcome") : successRate >= 95 ? text("strong") : successRate >= 80 ? text("watch") : text("atRisk")}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.invocations}
          signalLabel={text("health")}
        />
        <StatsMetricCard
          label={text("failures")}
          value={formatMaybeCount(statusCounts.failed, finishedCount > 0, locale)}
          detail={finishedCount > 0 ? text("cancelledWindow", { count: formatCount(statusCounts.cancelled, locale) }) : text("noTerminalFailures")}
          secondaryDetail={text("finishedOutcomes", { count: formatCount(finishedCount, locale) })}
          qualityHint={statusCounts.failed > 0 || statusCounts.cancelled > 0 ? text("investigate") : text("clear")}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel={text("errors")}
        />
        <StatsMetricCard
          label={text("retrySignals")}
          value={formatMaybeCount(statusCounts.paused + statusCounts.running, hasInvocationData, locale)}
          detail={text("runningPaused", { running: formatCount(statusCounts.running, locale), paused: formatCount(statusCounts.paused, locale) })}
          secondaryDetail={duration.sampleCount > 0 ? text("p95Latency", { duration: formatStatsDuration(duration.p95Ms, locale) }) : text("runtimeDistributionUnavailable")}
          qualityHint={statusCounts.paused + statusCounts.running > 0 ? text("active") : text("idle")}
          accentHex={STATS_COLORS.amber}
          sparkline={[]}
          signalLabel={text("queue")}
        />
      </>
    );
  };

  const renderModelsMode = () => {
    const topModel = topModelEntity;
    const highlights = buildModelHighlights(models, locale);
    const totalFinished = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;
    const modelSuccessRate = totalFinished > 0 ? (statusCounts.completed / totalFinished) : null;
    const topModelEfficiency = topModel ? computeUsageEfficiency(topModel.usage) : null;

    return (
      <>
        <StatsMetricCard
          label={text("topModel")}
          value={topModel ? topModel.label : text("noData")}
          detail={topModel ? text("tokenCalls", { tokens: formatTokens(topModel.usage.totalTokens, locale), calls: formatCount(topModel.usage.invocationCount, locale) }) : text("noModelTelemetry")}
          secondaryDetail={topModel && topModelEfficiency?.tokensPerCall !== null && topModelEfficiency?.tokensPerCall !== undefined ? text("tokensPerCallCost", { tokens: formatCount(Math.round(topModelEfficiency.tokensPerCall), locale), cost: formatCost(topModel.usage.totalCostUsd, locale) }) : text("modelMixUnavailable")}
          qualityHint={topModel?.successRate !== null && topModel?.successRate !== undefined ? text("successValue", { value: formatSuccessRate(topModel.successRate, locale) }) : text("lowData")}
          accentHex={STATS_COLORS.signal}
          sparkline={topModel ? extractModelSeries(stats, topModel.id) : []}
          signalLabel={text("models")}
        />
        <StatsMetricCard
          label={text("successRate")}
          value={formatSuccessRate(modelSuccessRate, locale)}
          detail={text("completedFailed", { completed: formatCount(statusCounts.completed, locale), failed: formatCount(statusCounts.failed, locale) })}
          secondaryDetail={highlights.mostReliable ? text("bestModel", { model: highlights.mostReliable.model.label, value: highlights.mostReliable.value }) : text("needCompletedOutcomes")}
          qualityHint={modelSuccessRate === null ? text("noOutcome") : modelSuccessRate >= 0.95 ? text("strong") : text("watch")}
          accentHex={STATS_COLORS.moss}
          sparkline={[]}
          signalLabel={text("reliability")}
        />
        <StatsMetricCard
          label={text("activeModels")}
          value={formatMaybeCount(models.length, models.length > 0, locale)}
          detail={models.length > 0 ? text("distinctModelRows") : text("noModelWindow")}
          secondaryDetail={highlights.busiest ? text("busiestModel", { model: highlights.busiest.model.label }) : text("needModelRow")}
          qualityHint={models.length > 1 ? text("portfolio") : models.length === 1 ? text("singleModel") : text("empty")}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel={text("active")}
        />
        <StatsMetricCard
          label={text("medianLatency")}
          value={duration.sampleCount > 0 ? formatStatsDuration(duration.p50Ms, locale) : "—"}
          detail={duration.sampleCount > 0 ? text("p95AcrossCalls", { duration: formatStatsDuration(duration.p95Ms, locale), calls: formatCount(duration.sampleCount, locale) }) : text("noFinishedSamples")}
          secondaryDetail={highlights.fastest ? text("fastestModel", { model: highlights.fastest.model.label, value: highlights.fastest.value }) : text("latencyRankingUnavailable")}
          qualityHint={duration.sampleCount > 0 ? text("measured") : text("lowData")}
          accentHex={STATS_COLORS.ember}
          sparkline={[]}
          signalLabel={locale === "de" ? "Latenz" : "Latency"}
        />
        <StatsMetricCard
          label={text("cacheHitRate")}
          value={hasTokenData ? formatRate(cacheRate, locale) : "—"}
          detail={highlights.bestCache ? text("bestModelAt", { model: highlights.bestCache.model.label, value: highlights.bestCache.value }) : text("cachedPromptShare")}
          secondaryDetail={highlights.highestVelocity ? text("velocityModel", { model: highlights.highestVelocity.model.label, value: highlights.highestVelocity.value }) : text("velocityRankingUnavailable")}
          qualityHint={highlights.bestCache ? text("optimized") : text("lowData")}
          accentHex={STATS_COLORS.amber}
          sparkline={hasTokenData ? metricSeries.cacheRate : []}
          signalLabel={text("efficiency")}
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
          label={text("taskRows")}
          value={formatMaybeCount(tasks.length, tasks.length > 0, locale)}
          detail={tasks.length > 0 ? text("tokensAcrossTasks", { tokens: formatTokens(taskTokens, locale) }) : text("noTaskRows")}
          secondaryDetail={topTask ? text("topTask", { task: topTask.label, cost: formatCost(topTask.usage.totalCostUsd, locale) }) : text("taskScopeUnavailable")}
          qualityHint={tasks.length > 0 ? text("scoped") : text("empty")}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.totalTokens}
          signalLabel={text("tasks")}
        />
        <StatsMetricCard
          label={text("sprintRows")}
          value={formatMaybeCount(sprints.length, sprints.length > 0, locale)}
          detail={stats.activeSprint ? text("sprintActive", { sprint: stats.activeSprint.sprintNumber ?? "?" }) : text("historicalWindow")}
          secondaryDetail={topSprint ? text("topSprint", { sprint: topSprint.label, tokens: formatTokens(sprintTokens, locale) }) : text("noSprintRows")}
          qualityHint={stats.activeSprint ? text("active") : text("archive")}
          accentHex={STATS_COLORS.clay}
          sparkline={metricSeries.invocations}
          signalLabel={text("sprints")}
        />
        <StatsMetricCard
          label={text("filesChanged")}
          value={formatMaybeCount(gitTotals?.filesChanged, Boolean(gitTotals) && (gitTotals?.filesChanged || 0) > 0, locale)}
          detail={gitTotals && gitTotals.filesChanged > 0 ? text("addedRemoved", { added: formatCount(gitTotals.insertions, locale), removed: formatCount(gitTotals.deletions, locale) }) : text("noFileChanges")}
          secondaryDetail={gitTotals ? text("prsMerged", { prs: formatCount(gitTotals.prCount, locale), merged: formatCount(gitTotals.mergedCount, locale) }) : text("diffUnavailable")}
          qualityHint={gitTotals?.filesChanged ? text("diff") : text("empty")}
          accentHex={STATS_COLORS.ember}
          sparkline={metricSeries.gitFilesChanged}
          signalLabel={text("diff")}
        />
        <StatsMetricCard
          label={text("pullRequests")}
          value={formatMaybeCount(gitTotals?.prCount, Boolean(gitTotals) && (gitTotals?.prCount || 0) > 0, locale)}
          detail={gitTotals && gitTotals.prCount > 0 ? text("mergedPrs", { count: formatCount(gitTotals.mergedCount, locale) }) : text("noPullRequests")}
          secondaryDetail={gitTotals ? text("conflictSignals", { count: formatCount(gitTotals.mergeConflictCount, locale) }) : text("gitTotalsUnavailable")}
          qualityHint={gitTotals?.prCount ? text("git") : text("lowData")}
          accentHex={STATS_COLORS.moss}
          sparkline={metricSeries.gitPrs}
          signalLabel="PRs"
        />
        <StatsMetricCard
          label={text("mergeConflicts")}
          value={formatMaybeCount(gitTotals?.mergeConflictCount || stats.mergeConflictCount, Boolean(gitTotals) && ((gitTotals?.mergeConflictCount || stats.mergeConflictCount || 0) > 0), locale)}
          detail={(gitTotals?.mergeConflictCount || stats.mergeConflictCount || 0) > 0 ? text("blockersFound") : text("noMergeBlockers")}
          secondaryDetail={gitTotals ? text("filesTouched", { count: formatCount(gitTotals.filesChanged, locale) }) : text("gitConflictUnavailable")}
          qualityHint={(gitTotals?.mergeConflictCount || stats.mergeConflictCount || 0) > 0 ? text("blocked") : text("clear")}
          accentHex={STATS_COLORS.rose}
          sparkline={metricSeries.gitMergeConflicts}
          signalLabel={text("blocks")}
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
          label={text("systemHealth")}
          value={formatRate(successRate, locale)}
          detail={hasInvocationData ? text("failedPaused", { failed: formatCount(statusCounts.failed, locale), paused: formatCount(statusCounts.paused, locale) }) : text("noOutcomesScore")}
          secondaryDetail={text("runningCancelled", { running: formatCount(statusCounts.running, locale), cancelled: formatCount(statusCounts.cancelled, locale) })}
          qualityHint={successRate === null ? text("noOutcome") : successRate >= 95 ? text("healthy") : text("watch")}
          accentHex={STATS_COLORS.rose}
          sparkline={[]}
          signalLabel={text("live")}
        />
        <StatsMetricCard
          label={text("invocationRows")}
          value={formatMaybeCount(usage.invocationCount, hasInvocationData, locale)}
          detail={duration.sampleCount > 0 ? text("durationSamplesAvailable", { count: formatCount(duration.sampleCount, locale) }) : text("noDurationSamples")}
          secondaryDetail={toolCallCount > 0 ? text("toolCallsCaptured", { count: formatCount(toolCallCount, locale) }) : text("toolCallsUnavailable")}
          qualityHint={usage.invocationCount > 0 ? text("indexed") : text("empty")}
          accentHex={STATS_COLORS.signal}
          sparkline={metricSeries.invocations}
          signalLabel={text("rows")}
        />
        <StatsMetricCard
          label={text("providerRows")}
          value={formatMaybeCount(providers.length, providers.length > 0, locale)}
          detail={providers.length > 0 ? text("providerSegmentsDeck", { count: formatCount(sortedProviderSegments.length, locale) }) : text("noProviderSystemRows")}
          secondaryDetail={topProviderEntity ? text("leadProvider", { provider: topProviderEntity.label, calls: formatCount(topProviderEntity.usage.invocationCount, locale) }) : text("providerHealthUnavailable")}
          qualityHint={providers.length > 1 ? text("mixed") : providers.length === 1 ? text("single") : text("empty")}
          accentHex={STATS_COLORS.clay}
          sparkline={[]}
          signalLabel={text("providers")}
        />
        <StatsMetricCard
          label={text("modelRows")}
          value={formatMaybeCount(models.length, models.length > 0, locale)}
          detail={topModelEntity ? text("modelLeadsWindow", { model: topModelEntity.label }) : text("noTopModel")}
          secondaryDetail={topModelEntity ? text("modelP50Calls", { duration: formatStatsDuration(topModelEntity.duration.p50Ms, locale), calls: formatCount(topModelEntity.usage.invocationCount, locale) }) : text("modelLatencyUnavailable")}
          qualityHint={topModelEntity?.successRate !== null && topModelEntity?.successRate !== undefined ? text("successValue", { value: formatSuccessRate(topModelEntity.successRate, locale) }) : text("lowData")}
          accentHex={STATS_COLORS.ember}
          sparkline={topModelEntity ? extractModelSeries(stats, topModelEntity.id) : []}
          signalLabel={text("models")}
        />
        <StatsMetricCard
          label={text("sourceRows")}
          value={formatMaybeCount(sourceRows, sourceRows > 0, locale)}
          detail={sourceRows > 0 ? text("tokenSegments", { count: formatCount(tokenSegments.length, locale) }) : text("noSourceQualityRows")}
          secondaryDetail={telemetrySummary.detail}
          qualityHint={telemetrySummary.label}
          accentHex={STATS_COLORS.moss}
          sparkline={[]}
          signalLabel={text("sources")}
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
      className="grid w-full gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14.5rem),1fr))] [&>*]:min-w-0"
      data-testid="top-cards-renderer"
    >
      {cardsContent}
    </section>
  );
};
