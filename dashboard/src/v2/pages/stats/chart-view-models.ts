import type {
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsChartSeries,
  ProjectExecutionStatsSnapshot
} from '../../../types.js';
import { formatDuration, formatTokens, sumUsage } from './stats-utils.js';
import {
  buildPoints,
  buildSmoothPath,
  buildSmoothAreaPath
} from './components/StatsShared.js';

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
  peakTime: number;
  peakInvocations: number;
  averageTokens: number;
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
      ? formatDuration
      : series.formatter === 'number'
        ? (val: number) => val.toLocaleString()
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
  return chartSeries.reduce((acc, s) => {
    if (!acc[s.grouping]) acc[s.grouping] = [];
    acc[s.grouping].push(s);
    return acc;
  }, {} as Record<string, ProjectExecutionStatsChartSeries[]>);
}

export function calculateChartMetrics(visibleBuckets: ExecutionUsageBucketSummary[]): ChartMetrics {
  const peakTokens = Math.max(0, ...visibleBuckets.map((bucket) => bucket.usage.totalTokens));
  const peakTime = Math.max(0, ...visibleBuckets.map((bucket) => bucket.usage.activeTimeMs));
  const peakInvocations = Math.max(0, ...visibleBuckets.map((bucket) => bucket.usage.invocationCount));
  const averageTokens = visibleBuckets.length > 0 ? Math.round(sumUsage(visibleBuckets.map((bucket) => ({
    id: bucket.bucketStart,
    label: bucket.label,
    secondaryLabel: null,
    status: null,
    purpose: null,
    provider: null,
    usage: bucket.usage,
    lastActivityAt: bucket.bucketEnd,
  }))).totalTokens / visibleBuckets.length) : 0;

  return {
    peakTokens,
    peakTime,
    peakInvocations,
    averageTokens,
  };
}

export function getTooltipState(
  visibleBuckets: ExecutionUsageBucketSummary[],
  chartData: NormalizedChartSeries[],
  hoveredIndex: number | null,
  padding: number,
  width: number
): TooltipState {
  const activeIndex = hoveredIndex ?? (visibleBuckets.length > 0 ? visibleBuckets.length - 1 : 0);
  const activeBucket = visibleBuckets[activeIndex] ?? null;
  const xPositions = chartData[0]?.points.map((point) => point.x) ?? [];
  const tooltipLeft = xPositions[activeIndex]
    ? ((xPositions[activeIndex]! - padding) / Math.max(1, width - padding * 2)) * 100
    : 50;

  return {
    activeIndex,
    activeBucket,
    tooltipLeft,
    xPositions,
  };
}
