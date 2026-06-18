import { describe, expect, it } from "vitest";
import type { ExecutionUsageBucketSummary } from "../../../types.js";
import { computeWindowDelta, formatDeltaPercent } from "../trend-insights.js";

function createBucket(totalTokens: number): ExecutionUsageBucketSummary {
  return {
    bucketStart: "2026-06-01T00:00:00.000Z",
    bucketEnd: "2026-06-01T01:00:00.000Z",
    label: "00:00",
    usage: {
      invocationCount: 1,
      activeTimeMs: 1000,
      wallTimeMs: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 0,
      unavailableInvocationCount: 0,
      unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0,
    },
  };
}

describe("computeWindowDelta", () => {
  it("compares second half against first half", () => {
    const buckets = [100, 100, 200, 200].map(createBucket);
    const delta = computeWindowDelta(buckets, (bucket) => bucket.usage.totalTokens);

    expect(delta.previous).toBe(200);
    expect(delta.current).toBe(400);
    expect(delta.changePercent).toBeCloseTo(100);
    expect(delta.direction).toBe("up");
  });

  it("reports downward momentum", () => {
    const buckets = [400, 100].map(createBucket);
    const delta = computeWindowDelta(buckets, (bucket) => bucket.usage.totalTokens);

    expect(delta.direction).toBe("down");
    expect(delta.changePercent).toBeCloseTo(-75);
  });

  it("handles an empty or single-bucket window", () => {
    expect(computeWindowDelta([], (bucket) => bucket.usage.totalTokens)).toEqual({
      current: 0,
      previous: 0,
      changePercent: null,
      direction: "flat",
    });

    const single = computeWindowDelta([createBucket(500)], (bucket) => bucket.usage.totalTokens);
    expect(single.current).toBe(500);
    expect(single.changePercent).toBeNull();
  });

  it("returns a null percent when the first half is empty", () => {
    const buckets = [0, 0, 100, 100].map(createBucket);
    const delta = computeWindowDelta(buckets, (bucket) => bucket.usage.totalTokens);
    expect(delta.changePercent).toBeNull();
    expect(delta.direction).toBe("up");
  });
});

describe("formatDeltaPercent", () => {
  it("formats signed percentages, new activity, and flat windows", () => {
    expect(formatDeltaPercent({ current: 400, previous: 200, changePercent: 100, direction: "up" })).toBe("+100%");
    expect(formatDeltaPercent({ current: 100, previous: 400, changePercent: -75, direction: "down" })).toBe("-75%");
    expect(formatDeltaPercent({ current: 100, previous: 0, changePercent: null, direction: "up" })).toBe("new");
    expect(formatDeltaPercent({ current: 0, previous: 0, changePercent: null, direction: "flat" })).toBe("—");
    expect(formatDeltaPercent({ current: 200, previous: 200, changePercent: 0, direction: "flat" })).toBe("flat");
  });
});
