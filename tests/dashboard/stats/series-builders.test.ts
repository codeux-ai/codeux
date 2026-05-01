import { describe, expect, it } from "vitest";
import { buildMetricSeries } from "../../../dashboard/src/v2/lib/stats/series-builders.js";

describe("series-builders", () => {
  const mockStats = {
    chartSeries: [
      { id: "purpose_invocations_task_coding", data: [1, 2, 3] },
      { id: "purpose_invocations_ci_fix", data: [4, 5, 6] },
      { id: "purpose_invocations_qa_review", data: [7, 8, 9] },
      { id: "purpose_invocations_planning", data: [10, 11, 12] },
    ],
    buckets: [
      { usage: { wallTimeMs: 3600000 } },
      { usage: { wallTimeMs: 7200000 } },
      { usage: { wallTimeMs: 1800000 } },
    ],
  } as any;

  it("builds an object with the 5 series", () => {
    const series = buildMetricSeries(mockStats);
    expect(series.taskCodingTokens).toEqual([1, 2, 3]);
    expect(series.ciFixTokens).toEqual([4, 5, 6]);
    expect(series.qaReviewTokens).toEqual([7, 8, 9]);
    expect(series.planningTokens).toEqual([10, 11, 12]);
    expect(series.wallRuntime).toEqual([1, 2, 0.5]);
  });

  it("handles null stats", () => {
    const series = buildMetricSeries(null);
    expect(series.taskCodingTokens).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(series.wallRuntime).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
