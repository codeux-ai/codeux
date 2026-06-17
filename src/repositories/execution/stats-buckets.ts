import {
  ExecutionUsageBucketSummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  ProjectStatsResolution
} from "../../contracts/app-types.js";
import { startOfUtcDay } from "./project-stats-query.js";

export interface InternalStatsBucket extends ExecutionUsageBucketSummary {
  bucketStartMs: number;
  providerTokens: Map<string, number>;
  providerCost: Map<string, number>;
  purposeTime: Map<string, number>;
  purposeInvocations: Map<string, number>;
  modelTokens: Map<string, number>;
  modelCost: Map<string, number>;
}

export function createEmptyUsageTotals(): ExecutionUsageTotals {
  return {
    invocationCount: 0,
    activeTimeMs: 0,
    wallTimeMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    inputCostUsd: 0,
    outputCostUsd: 0,
    cachedInputCostUsd: 0,
    totalCostUsd: 0,
    toolCallCount: 0,
    reportedInvocationCount: 0,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
  };
}

export function createUsageBuckets(
  range: ProjectExecutionStatsSnapshot["range"],
  bucketSizeMs: number,
): InternalStatsBucket[] {
  const buckets: InternalStatsBucket[] = [];
  const startMs = new Date(range.from).getTime();
  for (let index = 0; index < range.bucketCount; index += 1) {
    const bucketStartMs = startMs + index * bucketSizeMs;
    const bucketEndMs = bucketStartMs + bucketSizeMs;
    const bucketStart = new Date(bucketStartMs);
    const label = formatBucketLabel(bucketStart, range.resolution);
    buckets.push({
      bucketStart: bucketStart.toISOString(),
      bucketEnd: new Date(bucketEndMs).toISOString(),
      bucketStartMs,
      label,
      usage: createEmptyUsageTotals(),
      providerTokens: new Map<string, number>(),
      providerCost: new Map<string, number>(),
      purposeTime: new Map<string, number>(),
      purposeInvocations: new Map<string, number>(),
      modelTokens: new Map<string, number>(),
      modelCost: new Map<string, number>(),
    });
  }
  return buckets;
}

function formatBucketLabel(date: Date, resolution: ProjectStatsResolution): string {
  if (resolution === "hour") {
    return date.toISOString().slice(11, 16);
  }
  if (resolution === "week") {
    return `W${getIsoWeekNumber(date)}`;
  }
  return date.toISOString().slice(5, 10);
}

function getIsoWeekNumber(date: Date): number {
  const utcDate = startOfUtcDay(date);
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - (utcDate.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
