import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { InternalStatsBucket } from "./stats-buckets.js";
import { toNumber } from "./execution-utils.js";
import { StatsEntityMetadata } from "./execution-stats-types.js";

export const usageFields = `
    COUNT(*) as invocationCount,
    SUM(COALESCE(duration_ms, 0)) as activeTimeMs,
    SUM(input_tokens) as inputTokens,
    SUM(cached_input_tokens) as cachedInputTokens,
    SUM(output_tokens) as outputTokens,
    SUM(reasoning_output_tokens) as reasoningOutputTokens,
    SUM(total_tokens) as totalTokens,
    SUM(tool_call_count) as toolCallCount,
    SUM(CASE WHEN usage_source = 'reported' THEN 1 ELSE 0 END) as reportedInvocationCount,
    SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) as estimatedInvocationCount,
    SUM(CASE WHEN usage_source = 'unsupported' THEN 1 ELSE 0 END) as unsupportedInvocationCount,
    SUM(CASE WHEN usage_source NOT IN ('reported', 'estimated', 'unsupported') THEN 1 ELSE 0 END) as unavailableInvocationCount
  `;

export interface UsageAggregationRow {
  invocationCount: number | string | null;
  activeTimeMs: number | string | null;
  inputTokens: number | string | null;
  cachedInputTokens: number | string | null;
  outputTokens: number | string | null;
  reasoningOutputTokens: number | string | null;
  totalTokens: number | string | null;
  toolCallCount: number | string | null;
  reportedInvocationCount: number | string | null;
  estimatedInvocationCount: number | string | null;
  unsupportedInvocationCount: number | string | null;
  unavailableInvocationCount: number | string | null;
}

export function mapAggregatedUsage(row: UsageAggregationRow): ExecutionUsageTotals {
  return {
    invocationCount: toNumber(row.invocationCount),
    activeTimeMs: toNumber(row.activeTimeMs),
    wallTimeMs: 0,
    inputTokens: toNumber(row.inputTokens),
    cachedInputTokens: toNumber(row.cachedInputTokens),
    outputTokens: toNumber(row.outputTokens),
    reasoningOutputTokens: toNumber(row.reasoningOutputTokens),
    totalTokens: toNumber(row.totalTokens),
    inputCostUsd: 0,
    outputCostUsd: 0,
    cachedInputCostUsd: 0,
    totalCostUsd: 0,
    toolCallCount: toNumber(row.toolCallCount),
    reportedInvocationCount: toNumber(row.reportedInvocationCount),
    estimatedInvocationCount: toNumber(row.estimatedInvocationCount),
    unsupportedInvocationCount: toNumber(row.unsupportedInvocationCount),
    unavailableInvocationCount: toNumber(row.unavailableInvocationCount),
  };
}

export function mergeAggregatedUsage(target: ExecutionUsageTotals, source: ExecutionUsageTotals): void {
  target.invocationCount += source.invocationCount;
  target.activeTimeMs += source.activeTimeMs;
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
  target.inputCostUsd += source.inputCostUsd;
  target.outputCostUsd += source.outputCostUsd;
  target.cachedInputCostUsd += source.cachedInputCostUsd;
  target.totalCostUsd += source.totalCostUsd;
  target.toolCallCount = (target.toolCallCount ?? 0) + (source.toolCallCount ?? 0);
  target.reportedInvocationCount += source.reportedInvocationCount;
  target.estimatedInvocationCount += source.estimatedInvocationCount;
  target.unsupportedInvocationCount += source.unsupportedInvocationCount;
  target.unavailableInvocationCount += source.unavailableInvocationCount;
}

export function accumulateBucketUsage(
  bucket: InternalStatsBucket,
  usage: ExecutionUsageTotals,
  provider: string | null | undefined,
  purpose: string | null | undefined,
  modelKey: string
): void {
  mergeAggregatedUsage(bucket.usage, usage);
  bucket.providerTokens.set(provider as string, (bucket.providerTokens.get(provider as string) || 0) + usage.totalTokens);
  bucket.purposeTime.set(purpose as string, (bucket.purposeTime.get(purpose as string) || 0) + usage.activeTimeMs);
  bucket.purposeInvocations.set(purpose as string, (bucket.purposeInvocations.get(purpose as string) || 0) + usage.invocationCount);
  bucket.modelTokens.set(modelKey, (bucket.modelTokens.get(modelKey) || 0) + usage.totalTokens);
}

export function mapEntityUsage(
  map: Map<string, ExecutionUsageTotals>,
  activityMap: Map<string, string>,
  getMeta?: (id: string) => StatsEntityMetadata | undefined
) {
  return Array.from(map.entries()).map(([id, usage]) => {
    const meta = getMeta ? getMeta(id) : undefined;
    return {
      id,
      label: meta?.label || id,
      secondaryLabel: meta?.secondaryLabel || null,
      status: (meta?.status || null) as any,
      purpose: (meta?.purpose || null) as any,
      provider: (meta?.provider || null) as any,
      usage,
      lastActivityAt: activityMap.get(id) || null,
    };
  }).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens);
}
