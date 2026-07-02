import { describe, expect, it } from "vitest";
import {
  mapAggregatedUsage,
  mergeAggregatedUsage,
  accumulateBucketUsage,
  mapEntityUsage,
} from "../../../../src/repositories/execution/project-stats-aggregation.js";
import { createEmptyUsageTotals } from "../../../../src/repositories/execution/stats-buckets.js";

describe("project-stats-aggregation", () => {
  it("mapAggregatedUsage handles null values gracefully", () => {
    const row = {
      invocationCount: null,
      activeTimeMs: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      totalTokens: null,
      toolCallCount: null,
      reportedInvocationCount: null,
      estimatedInvocationCount: null,
      unsupportedInvocationCount: null,
      unavailableInvocationCount: null,
    };
    const mapped = mapAggregatedUsage(row);
    expect(mapped.invocationCount).toBe(0);
    expect(mapped.activeTimeMs).toBe(0);
    expect(mapped.inputTokens).toBe(0);
  });

  it("uses provider-reported cost when no token pricing is available", () => {
    const mapped = mapAggregatedUsage({
      invocationCount: 1,
      activeTimeMs: 1000,
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 500,
      reasoningOutputTokens: 0,
      totalTokens: 1500,
      toolCallCount: 0,
      reportedCostUsd: 0.42,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 0,
      unsupportedInvocationCount: 0,
      unavailableInvocationCount: 0,
    });

    expect(mapped.inputCostUsd).toBe(0);
    expect(mapped.outputCostUsd).toBe(0);
    expect(mapped.totalCostUsd).toBeCloseTo(0.42);
  });

  it("prefers token pricing over provider-reported cost when pricing is available", () => {
    const mapped = mapAggregatedUsage({
      invocationCount: 1,
      activeTimeMs: 1000,
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 2_000_000,
      toolCallCount: 0,
      reportedCostUsd: 999,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 0,
      unsupportedInvocationCount: 0,
      unavailableInvocationCount: 0,
    }, () => ({ inputTokens: 2, outputTokens: 3, cachedInputTokens: 0 }), "opencode", "some/model");

    expect(mapped.inputCostUsd).toBe(2);
    expect(mapped.outputCostUsd).toBe(3);
    expect(mapped.totalCostUsd).toBe(5);
  });

  it("mergeAggregatedUsage sums fields accurately", () => {
    const target = createEmptyUsageTotals();
    const source = createEmptyUsageTotals();
    source.invocationCount = 5;
    source.inputTokens = 10;

    mergeAggregatedUsage(target, source);
    expect(target.invocationCount).toBe(5);
    expect(target.inputTokens).toBe(10);
  });

  it("accumulateBucketUsage adds values and updates maps correctly", () => {
    const bucket = {
      bucketStart: "2023-01-01T00:00:00.000Z",
      bucketEnd: "2023-01-01T01:00:00.000Z",
      bucketStartMs: 0,
      label: "bucket1",
      usage: createEmptyUsageTotals(),
      providerTokens: new Map(),
      providerCost: new Map(),
      purposeTime: new Map(),
      purposeInvocations: new Map(),
      modelTokens: new Map(),
      modelCost: new Map(),
    };
    const u = createEmptyUsageTotals();
    u.totalTokens = 100;
    u.activeTimeMs = 50;
    u.invocationCount = 1;

    accumulateBucketUsage(bucket, u, "test-provider", "test-purpose", "test-model-key");
    expect(bucket.usage.totalTokens).toBe(100);
    expect(bucket.providerTokens.get("test-provider")).toBe(100);
    expect(bucket.purposeTime.get("test-purpose")).toBe(50);
    expect(bucket.purposeInvocations.get("test-purpose")).toBe(1);
    expect(bucket.modelTokens.get("test-model-key")).toBe(100);
  });

  it("mapEntityUsage correctly maps and sorts by total tokens", () => {
    const usage1 = createEmptyUsageTotals();
    usage1.totalTokens = 10;
    const usage2 = createEmptyUsageTotals();
    usage2.totalTokens = 50;

    const map = new Map();
    map.set("entity1", usage1);
    map.set("entity2", usage2);

    const activityMap = new Map();
    activityMap.set("entity1", "2023-01-01");

    const result = mapEntityUsage(map, activityMap);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe("entity2"); // Sorted descending
    expect(result[0].usage.totalTokens).toBe(50);
    expect(result[1].id).toBe("entity1");
    expect(result[1].lastActivityAt).toBe("2023-01-01");
  });
});
