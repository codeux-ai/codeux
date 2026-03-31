import { describe, expect, it } from "vitest";
import { accumulateUsageStats, buildChartSeries, createEmptyUsageTotals } from "../../../src/repositories/execution/execution-stats-aggregator.js";
import type { ProviderInvocationUsageRecord } from "@sprint/core";
import type { ExecutionUsageBucketSummary, ExecutionUsageTotals } from "@sprint/core";

describe("ExecutionStatsAggregator", () => {
  const dummyInvocation: ProviderInvocationUsageRecord = {
    id: "inv-1",
    projectId: "proj-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sprintRunId: "run-1",
    provider: "test-provider",
    purpose: "test-purpose",
    startedAt: "2024-01-01T00:00:00.000Z",
    finishedAt: "2024-01-01T00:00:01.000Z",
    durationMs: 1000,
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 0,
    totalTokens: 30,
    usageSource: "reported",
    modelName: "test-model",
    modelRateId: "rate-1",
    costCents: 10,
  };

  const mergeUsageTotals = (target: ExecutionUsageTotals, source: ProviderInvocationUsageRecord) => {
    target.totalTokens += source.totalTokens;
    target.invocationCount += 1;
    target.activeTimeMs += source.durationMs || 0;
  };

  const mergeUsageMap = (map: Map<string, ExecutionUsageTotals>, key: string, source: ProviderInvocationUsageRecord) => {
    if (!key) return;
    const current = map.get(key) || createEmptyUsageTotals();
    mergeUsageTotals(current, source);
    map.set(key, current);
  };

  const updateLastActivity = (map: Map<string, string>, key: string, activityAt: string) => {
    if (!key) return;
    map.set(key, activityAt);
  };

  it("accumulateUsageStats builds maps and computes totals correctly", () => {
    const buckets: (ExecutionUsageBucketSummary & { bucketStartMs: number })[] = [
      {
        bucketStart: "2024-01-01T00:00:00.000Z",
        bucketEnd: "2024-01-02T00:00:00.000Z",
        label: "Jan 1",
        usage: createEmptyUsageTotals(),
        bucketStartMs: new Date("2024-01-01T00:00:00.000Z").getTime(),
      }
    ];

    const result = accumulateUsageStats(
      [dummyInvocation, { ...dummyInvocation, id: "inv-2", totalTokens: 50, durationMs: 2000 }],
      buckets,
      86400000,
      mergeUsageTotals,
      mergeUsageMap,
      updateLastActivity
    );

    expect(result.usage.totalTokens).toBe(80);
    expect(result.usage.invocationCount).toBe(2);

    expect(result.taskUsage.get("task-1")?.totalTokens).toBe(80);
    expect(result.sprintUsage.get("run-1")?.totalTokens).toBe(80);
    expect(result.providerUsage.get("test-provider")?.totalTokens).toBe(80);
    expect(result.purposeUsage.get("test-purpose")?.totalTokens).toBe(80);

    expect(result.tokenSourceCounts.get("reported")).toBe(2);

    expect(buckets[0].usage.totalTokens).toBe(80);
    expect(buckets[0].usage.invocationCount).toBe(2);
    expect(buckets[0].usage.activeTimeMs).toBe(3000);
  });

  it("buildChartSeries formats series for tracking tokens, invocations, providers, and purposes", () => {
    const buckets: (ExecutionUsageBucketSummary & { bucketStartMs: number })[] = [
      {
        bucketStart: "2024-01-01T00:00:00.000Z",
        bucketEnd: "2024-01-02T00:00:00.000Z",
        label: "Jan 1",
        usage: { ...createEmptyUsageTotals(), totalTokens: 80, invocationCount: 2, activeTimeMs: 3000 },
        bucketStartMs: new Date("2024-01-01T00:00:00.000Z").getTime(),
      }
    ];

    const series = buildChartSeries(
      [dummyInvocation, { ...dummyInvocation, id: "inv-2", totalTokens: 50, durationMs: 2000 }],
      buckets,
      86400000,
      ["test-provider"],
      ["test-purpose"]
    );

    const totalTokensSeries = series.find(s => s.id === "core_total_tokens");
    expect(totalTokensSeries?.data).toEqual([80]);

    const activeTimeSeries = series.find(s => s.id === "core_active_time");
    expect(activeTimeSeries?.data).toEqual([3000]);

    const providerSeries = series.find(s => s.id === "provider_test-provider");
    expect(providerSeries?.data).toEqual([80]); // 30 + 50

    const purposeTimeSeries = series.find(s => s.id === "purpose_time_test-purpose");
    expect(purposeTimeSeries?.data).toEqual([3000]); // 1000 + 2000

    const purposeInvocationSeries = series.find(s => s.id === "purpose_invocations_test-purpose");
    expect(purposeInvocationSeries?.data).toEqual([2]); // 1 + 1
  });
});
