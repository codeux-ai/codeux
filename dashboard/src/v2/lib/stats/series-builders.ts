import type { ProjectExecutionStatsSnapshot } from "../../../types.js";

function extractChartSeries(stats: ProjectExecutionStatsSnapshot | null, id: string): number[] {
  if (!stats) return [0, 0, 0, 0, 0, 0, 0];
  const series = stats.chartSeries?.find((s) => s.id === id);
  if (series && series.data && series.data.length > 0) {
    return series.data;
  }
  return new Array(Math.max(stats.buckets?.length || 7, 7)).fill(0);
}

export function buildMetricSeries(stats: ProjectExecutionStatsSnapshot | null) {
  return {
    taskCodingTokens: extractChartSeries(stats, "purpose_invocations_task_coding"),
    ciFixTokens: extractChartSeries(stats, "purpose_invocations_ci_fix"),
    qaReviewTokens: extractChartSeries(stats, "purpose_invocations_qa_review"),
    planningTokens: extractChartSeries(stats, "purpose_invocations_planning"),
    wallRuntime: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map(b => (b.usage.wallTimeMs || 0) / 3600000)
      : new Array(Math.max(stats?.buckets?.length || 7, 7)).fill(0)
  };
}
