import type { ProjectExecutionStatsSnapshot } from "../../../types.js";

function extractChartSeries(stats: ProjectExecutionStatsSnapshot | null, id: string): number[] {
  if (!stats) return [0, 0, 0, 0, 0, 0, 0];
  const series = stats.chartSeries?.find((s) => s.id === id);
  if (series && series.data && series.data.length > 0) {
    return series.data;
  }
  return new Array(Math.max(stats.buckets?.length || 7, 7)).fill(0);
}

export function extractProviderSeries(stats: ProjectExecutionStatsSnapshot | null, providerId: string): number[] {
  return extractChartSeries(stats, `provider_${providerId}`);
}

export function extractModelSeries(stats: ProjectExecutionStatsSnapshot | null, modelId: string): number[] {
  return extractChartSeries(stats, `model_${modelId}`);
}

export function buildMetricSeries(stats: ProjectExecutionStatsSnapshot | null) {
  return {
    taskCodingTokens: extractChartSeries(stats, "purpose_invocations_task_coding"),
    ciFixTokens: extractChartSeries(stats, "purpose_invocations_ci_fix"),
    qaReviewTokens: extractChartSeries(stats, "purpose_invocations_qa_review"),
    planningTokens: extractChartSeries(stats, "purpose_invocations_planning"),
    wallRuntime: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map(b => (b.usage.wallTimeMs || 0) / 3600000)
      : new Array(Math.max(stats?.buckets?.length || 7, 7)).fill(0),
    coreInputTokens: extractChartSeries(stats, "core_input_tokens"),
    coreOutputTokens: extractChartSeries(stats, "core_output_tokens"),
    gitInsertions: extractChartSeries(stats, "git_insertions"),
    gitDeletions: extractChartSeries(stats, "git_deletions"),
    gitFilesChanged: extractChartSeries(stats, "git_files_changed"),
    gitPrs: extractChartSeries(stats, "git_prs"),
    gitMerges: extractChartSeries(stats, "git_merges"),
  };
}
