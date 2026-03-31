import type {
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsChartSeries
} from "../../contracts/app-types.js";
import type { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import type { ExecutionUsageTotals } from "../../contracts/app-types.js";

export function createEmptyUsageTotals(): ExecutionUsageTotals {
  return {
    invocationCount: 0,
    reportedInvocationCount: 0,
    estimatedInvocationCount: 0,
    unsupportedInvocationCount: 0,
    unavailableInvocationCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    activeTimeMs: 0,
    wallTimeMs: 0,
  };
}

export function accumulateUsageStats(
  mappedInvocations: ProviderInvocationUsageRecord[],
  buckets: (ExecutionUsageBucketSummary & { bucketStartMs: number })[],
  bucketSizeMs: number,
  mergeUsageTotals: (target: ExecutionUsageTotals, source: ProviderInvocationUsageRecord) => void,
  mergeUsageMap: (map: Map<string, ExecutionUsageTotals>, key: string, source: ProviderInvocationUsageRecord) => void,
  updateLastActivity: (map: Map<string, string>, key: string, activityAt: string) => void,
) {
  const usage = createEmptyUsageTotals();
  const taskUsage = new Map<string, ExecutionUsageTotals>();
  const sprintUsage = new Map<string, ExecutionUsageTotals>();
  const providerUsage = new Map<string, ExecutionUsageTotals>();
  const purposeUsage = new Map<string, ExecutionUsageTotals>();
  const tokenSourceCounts = new Map<string, number>();
  const taskLastActivity = new Map<string, string>();
  const sprintLastActivity = new Map<string, string>();
  const providerLastActivity = new Map<string, string>();
  const purposeLastActivity = new Map<string, string>();

  const firstBucketStartMs = buckets.length > 0 ? new Date(buckets[0].bucketStart).getTime() : 0;

  for (const invocation of mappedInvocations) {
    mergeUsageTotals(usage, invocation);
    mergeUsageMap(taskUsage, (invocation.taskId as string), invocation);
    mergeUsageMap(sprintUsage, (invocation.sprintRunId || invocation.sprintId || ""), invocation);
    mergeUsageMap(providerUsage, invocation.provider as string, invocation);
    mergeUsageMap(purposeUsage, invocation.purpose as string, invocation);

    const activityAt = invocation.finishedAt || invocation.startedAt;
    updateLastActivity(taskLastActivity, (invocation.taskId as string), activityAt);
    updateLastActivity(sprintLastActivity, (invocation.sprintRunId || invocation.sprintId || ""), activityAt);
    updateLastActivity(providerLastActivity, invocation.provider as string, activityAt);
    updateLastActivity(purposeLastActivity, invocation.purpose as string, activityAt);

    const usageSource = invocation.usageSource || "reported";
    tokenSourceCounts.set(usageSource, (tokenSourceCounts.get(usageSource) || 0) + 1);

    if (buckets.length > 0) {
      const bucketIndex = Math.floor((new Date(invocation.startedAt).getTime() - firstBucketStartMs) / bucketSizeMs);
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
        mergeUsageTotals(buckets[bucketIndex]!.usage, invocation);
      }
    }
  }

  return {
    usage,
    taskUsage,
    sprintUsage,
    providerUsage,
    purposeUsage,
    tokenSourceCounts,
    taskLastActivity,
    sprintLastActivity,
    providerLastActivity,
    purposeLastActivity,
  };
}

export function buildChartSeries(
  mappedInvocations: ProviderInvocationUsageRecord[],
  buckets: (ExecutionUsageBucketSummary & { bucketStartMs: number })[],
  bucketSizeMs: number,
  providerUsageKeys: string[],
  purposeUsageKeys: string[]
): ProjectExecutionStatsChartSeries[] {
  const chartSeries: ProjectExecutionStatsChartSeries[] = [
    { id: "core_total_tokens", label: "Total Tokens", grouping: "totals", defaultEnabled: true, data: buckets.map((b) => b.usage.totalTokens) },
    { id: "core_active_time", label: "Active Time (ms)", grouping: "totals", defaultEnabled: false, data: buckets.map((b) => b.usage.activeTimeMs) },
    { id: "core_invocations", label: "Invocations", grouping: "totals", defaultEnabled: false, data: buckets.map((b) => b.usage.invocationCount) },
    { id: "core_input_tokens", label: "Input Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.inputTokens) },
    { id: "core_cached_tokens", label: "Cached Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.cachedInputTokens) },
    { id: "core_output_tokens", label: "Output Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.outputTokens) },
    { id: "core_reasoning_tokens", label: "Reasoning Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.reasoningOutputTokens) },
    { id: "reliability_reported", label: "Reported Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.reportedInvocationCount) },
    { id: "reliability_estimated", label: "Estimated Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.estimatedInvocationCount) },
    { id: "reliability_unsupported", label: "Unsupported Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.unsupportedInvocationCount) },
    { id: "reliability_unavailable", label: "Unavailable Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.unavailableInvocationCount) },
    ...providerUsageKeys.map((providerId) => ({
      id: `provider_${providerId}`, label: `${providerId} Tokens`, grouping: "providers" as const, defaultEnabled: false, data: buckets.map(() => 0)
    })),
    ...purposeUsageKeys.map((purposeId) => ({
      id: `purpose_time_${purposeId}`, label: `${purposeId.replace(/_/g, " ")} Time`, grouping: "purposes_time" as const, defaultEnabled: false, data: buckets.map(() => 0)
    })),
    ...purposeUsageKeys.map((purposeId) => ({
      id: `purpose_invocations_${purposeId}`, label: `${purposeId.replace(/_/g, " ")} Invocations`, grouping: "purposes_invocations" as const, defaultEnabled: false, data: buckets.map(() => 0)
    }))
  ];

  const firstBucketStartMs = buckets.length > 0 ? new Date(buckets[0].bucketStart).getTime() : 0;
  if (buckets.length > 0) {
    const chartSeriesMap = new Map<string, ProjectExecutionStatsChartSeries>(
      chartSeries.map(s => [s.id, s])
    );
    for (const invocation of mappedInvocations) {
      const bucketIndex = Math.floor((new Date(invocation.startedAt).getTime() - firstBucketStartMs) / bucketSizeMs);
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
          const providerSeries = chartSeriesMap.get(`provider_${invocation.provider}`);
          if (providerSeries) providerSeries.data[bucketIndex] += invocation.totalTokens;

          const purposeTimeSeries = chartSeriesMap.get(`purpose_time_${invocation.purpose}`);
          if (purposeTimeSeries) purposeTimeSeries.data[bucketIndex] += invocation.durationMs || 0;

          const purposeInvocationsSeries = chartSeriesMap.get(`purpose_invocations_${invocation.purpose}`);
          if (purposeInvocationsSeries) purposeInvocationsSeries.data[bucketIndex] += 1;
      }
    }
  }

  return chartSeries;
}