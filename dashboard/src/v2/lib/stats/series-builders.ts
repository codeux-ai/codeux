import type { ProjectExecutionStatsSnapshot } from "../../../types.js";

export interface MetricSeriesBundle {
  totalTokens: number[];
  activeTime: number[];
  invocations: number[];
  totalCost: number[];
  cacheRate: number[];
  tokenVelocity: number[];
  taskCodingTokens: number[];
  ciFixTokens: number[];
  qaReviewTokens: number[];
  planningTokens: number[];
  wallRuntime: number[];
  coreInputTokens: number[];
  coreOutputTokens: number[];
  gitInsertions: number[];
  gitDeletions: number[];
  gitFilesChanged: number[];
  gitPrs: number[];
  gitMerges: number[];
  gitMergeConflicts: number[];
}

function emptySeries(stats: ProjectExecutionStatsSnapshot | null): number[] {
  return new Array(Math.max(stats?.buckets?.length || 7, 7)).fill(0);
}

function extractChartSeries(stats: ProjectExecutionStatsSnapshot | null, id: string, options: { emptyWhenMissing?: boolean } = {}): number[] {
  if (!stats) return options.emptyWhenMissing ? [] : emptySeries(stats);
  const series = stats.chartSeries?.find((s) => s.id === id);
  if (series && series.data && series.data.length > 0) {
    return series.data;
  }
  return options.emptyWhenMissing ? [] : emptySeries(stats);
}

export function extractProviderSeries(stats: ProjectExecutionStatsSnapshot | null, providerId: string): number[] {
  return extractChartSeries(stats, `provider_${providerId}`, { emptyWhenMissing: true });
}

export function extractModelSeries(stats: ProjectExecutionStatsSnapshot | null, modelId: string): number[] {
  return extractChartSeries(stats, `model_${modelId}`, { emptyWhenMissing: true });
}

export function extractPurposeInvocationSeries(stats: ProjectExecutionStatsSnapshot | null, purposeId: string): number[] {
  return extractChartSeries(stats, `purpose_invocations_${purposeId}`, { emptyWhenMissing: true });
}

export function buildMetricSeries(stats: ProjectExecutionStatsSnapshot | null): MetricSeriesBundle {
  return {
    totalTokens: extractChartSeries(stats, "core_total_tokens"),
    activeTime: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map(b => b.usage.activeTimeMs || 0)
      : emptySeries(stats),
    invocations: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map(b => b.usage.invocationCount || 0)
      : emptySeries(stats),
    totalCost: extractChartSeries(stats, "core_total_cost"),
    cacheRate: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map((bucket) => {
          const promptTokens = bucket.usage.inputTokens + bucket.usage.cachedInputTokens;
          return promptTokens > 0 ? (bucket.usage.cachedInputTokens / promptTokens) * 100 : 0;
        })
      : emptySeries(stats),
    tokenVelocity: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map((bucket) => {
          const activeMinutes = (bucket.usage.activeTimeMs || 0) / 60000;
          return activeMinutes > 0 ? (bucket.usage.totalTokens || 0) / activeMinutes : 0;
        })
      : emptySeries(stats),
    taskCodingTokens: extractChartSeries(stats, "purpose_invocations_task_coding"),
    ciFixTokens: extractChartSeries(stats, "purpose_invocations_ci_fix"),
    qaReviewTokens: extractChartSeries(stats, "purpose_invocations_qa_review"),
    planningTokens: extractChartSeries(stats, "purpose_invocations_planning"),
    wallRuntime: stats && stats.buckets && stats.buckets.length > 0
      ? stats.buckets.map(b => (b.usage.wallTimeMs || 0) / 3600000)
      : emptySeries(stats),
    coreInputTokens: extractChartSeries(stats, "core_input_tokens"),
    coreOutputTokens: extractChartSeries(stats, "core_output_tokens"),
    gitInsertions: extractChartSeries(stats, "git_insertions"),
    gitDeletions: extractChartSeries(stats, "git_deletions"),
    gitFilesChanged: extractChartSeries(stats, "git_files_changed"),
    gitPrs: extractChartSeries(stats, "git_prs"),
    gitMerges: extractChartSeries(stats, "git_merges"),
    gitMergeConflicts: extractChartSeries(stats, "git_merge_conflicts"),
  };
}
