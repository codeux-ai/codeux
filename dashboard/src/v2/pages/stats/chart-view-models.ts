import type {
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsChartSeries,
} from '../../../types.js';
import { EMPTY_USAGE, formatStatsDuration, formatTokens, NUMBER_FORMATTER, formatCost } from './stats-utils.js';
import {
  buildPoints,
  buildSmoothPath,
  buildSmoothAreaPath
} from './components/StatsShared.js';

const SERIES_GROUP_ORDER = [
  "Core",
  "Usage",
  "Totals",
  "Token details",
  "Source confidence",
  "Providers",
  "Provider costs",
  "Models",
  "Model costs",
  "Purpose time",
  "Purpose calls",
  "Git",
];

function normalizeSeriesGroupLabel(grouping: string | undefined): string {
  const rawGrouping = grouping?.trim() || "Core";
  const normalized = rawGrouping.toLowerCase().replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "core":
      return "Core";
    case "usage":
      return "Usage";
    case "totals":
      return "Totals";
    case "details":
      return "Token details";
    case "reliability":
      return "Source confidence";
    case "providers":
      return "Providers";
    case "providers_cost":
      return "Provider costs";
    case "models":
      return "Models";
    case "models_cost":
      return "Model costs";
    case "purposes":
    case "purposes_time":
      return "Purpose time";
    case "purposes_invocations":
      return "Purpose calls";
    case "git":
      return "Git";
    default:
      return rawGrouping;
  }
}

function compareSeriesGroups(left: string, right: string): number {
  const leftIndex = SERIES_GROUP_ORDER.indexOf(left);
  const rightIndex = SERIES_GROUP_ORDER.indexOf(right);

  if (leftIndex !== -1 || rightIndex !== -1) {
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
      - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  }

  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export interface NormalizedChartSeries extends Omit<ProjectExecutionStatsChartSeries, 'formatter'> {
  accentHex: string;
  formatter: (val: number) => string | number;
  signalLabel: string;
  values: number[];
  points: { x: number; y: number }[];
  path: string;
  areaPath: string;
  max: number;
}

export interface ChartMetrics {
  peakTokens: number;
  peakActiveTimeMs: number;
  peakTime: number;
  peakInvocations: number;
  averageTokens: number;
  peakCostUsd: number;
  totalCostUsd: number;
  invocationDensity: number;
  bucketCount: number;
  totalTokens: number;
  totalInvocations: number;
}

export interface TooltipState {
  activeIndex: number;
  activeBucket: ExecutionUsageBucketSummary | null;
  tooltipLeft: number;
  xPositions: number[];
}

export function getVisibleBuckets(
  buckets: ExecutionUsageBucketSummary[],
  viewStart: number,
  viewEnd: number
): ExecutionUsageBucketSummary[] {
  return buckets.slice(viewStart, viewEnd + 1);
}

export function normalizeChartSeries(
  chartSeries: ProjectExecutionStatsChartSeries[],
  visibleBuckets: ExecutionUsageBucketSummary[],
  viewStart: number,
  width: number,
  height: number,
  padding: number
): NormalizedChartSeries[] {
  return chartSeries.map((series, idx) => {
    const fallbackColors = ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'];
    const accentHex = series.color || fallbackColors[idx % fallbackColors.length]!;

    const formatter = series.formatter === 'duration'
      ? formatStatsDuration
      : series.formatter === 'number'
        ? (val: number) => {
            if (series.id.includes('cost')) return formatCost(val);
            return NUMBER_FORMATTER.format(val);
          }
        : series.formatter === 'percent'
          ? (val: number) => `${val.toFixed(1)}%`
          : formatTokens;

    const values = visibleBuckets.map((_, bucketIdx) => series.data[viewStart + bucketIdx] || 0);
    const points = buildPoints(values.length > 0 ? values : [0], width, height, padding);
    return {
      ...series,
      accentHex,
      formatter,
      signalLabel: series.signalLabel || 'Metric',
      values,
      points,
      path: buildSmoothPath(points),
      areaPath: buildSmoothAreaPath(points, height, padding),
      max: Math.max(...(values.length > 0 ? values : [0]), 1),
    };
  });
}

export function groupChartSeries(
  chartSeries: ProjectExecutionStatsChartSeries[]
): Record<string, ProjectExecutionStatsChartSeries[]> {
  const grouped = chartSeries.reduce((acc, series) => {
    const grouping = normalizeSeriesGroupLabel(series.grouping);
    (acc[grouping] ??= []).push(series);
    return acc;
  }, {} as Record<string, ProjectExecutionStatsChartSeries[]>);

  return Object.keys(grouped)
    .sort(compareSeriesGroups)
    .reduce((acc, grouping) => {
      acc[grouping] = [...grouped[grouping]!].sort((left, right) => (
        (left.label ?? left.id).localeCompare(right.label ?? right.id, undefined, { sensitivity: "base" })
          || left.id.localeCompare(right.id)
      ));
      return acc;
    }, {} as Record<string, ProjectExecutionStatsChartSeries[]>);
}

export function calculateChartMetrics(visibleBuckets: ExecutionUsageBucketSummary[]): ChartMetrics {
  let peakTokens = 0;
  let peakActiveTimeMs = 0;
  let peakInvocations = 0;
  let peakCostUsd = 0;
  let totalTokens = 0;
  let totalInvocations = 0;
  let totalCostUsd = 0;

  for (const bucket of visibleBuckets) {
    const usage = bucket.usage ?? EMPTY_USAGE;
    peakTokens = Math.max(peakTokens, usage.totalTokens);
    peakActiveTimeMs = Math.max(peakActiveTimeMs, usage.activeTimeMs);
    peakInvocations = Math.max(peakInvocations, usage.invocationCount);
    peakCostUsd = Math.max(peakCostUsd, usage.totalCostUsd || 0);
    totalTokens += usage.totalTokens;
    totalInvocations += usage.invocationCount;
    totalCostUsd += usage.totalCostUsd || 0;
  }

  const averageTokens = visibleBuckets.length > 0 ? Math.round(totalTokens / visibleBuckets.length) : 0;
  const invocationDensity = visibleBuckets.length > 0 ? totalInvocations / visibleBuckets.length : 0;

  return {
    peakTokens,
    peakActiveTimeMs,
    peakTime: peakActiveTimeMs,
    peakInvocations,
    averageTokens,
    peakCostUsd,
    totalCostUsd,
    invocationDensity,
    bucketCount: visibleBuckets.length,
    totalTokens,
    totalInvocations,
  };
}

export function describeChartMetrics(
  metrics: ChartMetrics,
  activeSeriesLabels: string[],
  zoomRangeLabel: string
): string {
  const seriesLabel = activeSeriesLabels.length > 0
    ? activeSeriesLabels.join(", ")
    : "No active series";

  return [
    `${metrics.bucketCount} visible buckets in ${zoomRangeLabel}.`,
    `Peak tokens ${formatTokens(metrics.peakTokens)}.`,
    `Peak active time ${formatStatsDuration(metrics.peakActiveTimeMs)}.`,
    `Average tokens ${formatTokens(metrics.averageTokens)}.`,
    `Invocation peak ${NUMBER_FORMATTER.format(metrics.peakInvocations)}.`,
    `Active series: ${seriesLabel}.`,
  ].join(" ");
}

export function calculateHoverRect(
  index: number,
  x: number,
  xPositions: number[],
  width: number,
  padding: number
): { startX: number; endX: number; rectWidth: number } {
  const startX = index === 0 ? padding : (xPositions[index - 1]! + x) / 2;
  const endX = index === xPositions.length - 1 ? width - padding : (x + xPositions[index + 1]!) / 2;
  const rectWidth = Math.max(8, endX - startX);
  return { startX, endX, rectWidth };
}

export function getTooltipState(
  visibleBuckets: ExecutionUsageBucketSummary[],
  chartData: NormalizedChartSeries[],
  hoveredIndex: number | null,
  padding: number,
  width: number
): TooltipState {
  const activeIndex = Math.min(
    Math.max(hoveredIndex ?? (visibleBuckets.length > 0 ? visibleBuckets.length - 1 : 0), 0),
    Math.max(0, visibleBuckets.length - 1)
  );
  const activeBucket = visibleBuckets[activeIndex] ?? null;
  const xPositions = chartData[0]?.points.map((point) => point.x) ?? [];
  const tooltipLeft = xPositions[activeIndex] !== undefined
    ? ((xPositions[activeIndex]! - padding) / Math.max(1, width - padding * 2)) * 100
    : 50;

  return {
    activeIndex,
    activeBucket,
    tooltipLeft,
    xPositions,
  };
}
