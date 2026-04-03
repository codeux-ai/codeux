import { describe, it, expect } from "vitest";
import { createEmptyUsageTotals } from "../../../../src/repositories/execution/stats-buckets.js";
import { createUsageBuckets } from "../../../../src/repositories/execution/stats-buckets.js";

describe("stats-buckets", () => {
  it("formats bucket labels correctly for all resolutions", () => {
    // day resolution
    const dayBuckets = createUsageBuckets({
      window: "30d",
      label: "30d",
      resolution: "day",
      resolutionLabel: "day",
      from: "2023-01-01T00:00:00Z",
      to: "2023-01-02T00:00:00Z",
      bucketCount: 1,
      isCustom: false
    }, 24 * 60 * 60 * 1000);
    expect(dayBuckets[0].label).toBe("01-01");

    // hour resolution
    const hourBuckets = createUsageBuckets({
      window: "24h",
      label: "24h",
      resolution: "hour",
      resolutionLabel: "hour",
      from: "2023-01-01T14:00:00Z",
      to: "2023-01-01T15:00:00Z",
      bucketCount: 1,
      isCustom: false
    }, 60 * 60 * 1000);
    expect(hourBuckets[0].label).toBe("14:00");

    // week resolution
    const weekBuckets = createUsageBuckets({
      window: "all",
      label: "all",
      resolution: "week",
      resolutionLabel: "week",
      from: "2023-01-01T00:00:00Z",
      to: "2023-01-08T00:00:00Z",
      bucketCount: 1,
      isCustom: false
    }, 7 * 24 * 60 * 60 * 1000);
    // 2023-01-01 was a Sunday, which is in the last week of 2022 by ISO week
    // W52
    expect(weekBuckets[0].label).toBe("W52");
  });

  it("creates empty usage totals correctly", () => {
    const totals = createEmptyUsageTotals();
    expect(totals.invocationCount).toBe(0);
    expect(totals.totalTokens).toBe(0);
  });
});
