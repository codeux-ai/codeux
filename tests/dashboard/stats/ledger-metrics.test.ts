/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { useGitMetricsMapper } from "../../../dashboard/src/v2/lib/stats/ledger-metrics.js";

describe("useGitMetricsMapper", () => {
  it("should return zeros when gitStats is null or undefined", () => {
    const { result } = renderHook(() => useGitMetricsMapper(null));

    expect(result.current.insertions.value).toBe("+0");
    expect(result.current.deletions.value).toBe("-0");
    expect(result.current.prCount.value).toBe("0");
    expect(result.current.mergedCount.value).toBe("0");
  });

  it("should return mapped values when gitStats is provided", () => {
    const gitStats = {
      totals: {
        insertions: 1200,
        deletions: 300,
        filesChanged: 15,
        prCount: 5,
        mergedCount: 3,
      },
      buckets: [
        {
          bucketStart: "2023-01-01T00:00:00Z",
          bucketEnd: "2023-01-02T00:00:00Z",
          label: "Day 1",
          metrics: {
            insertions: 1000,
            deletions: 200,
            filesChanged: 10,
            prCount: 4,
            mergedCount: 2,
          },
        },
        {
          bucketStart: "2023-01-02T00:00:00Z",
          bucketEnd: "2023-01-03T00:00:00Z",
          label: "Day 2",
          metrics: {
            insertions: 200,
            deletions: 100,
            filesChanged: 5,
            prCount: 1,
            mergedCount: 1,
          },
        },
      ],
      tasks: [],
      sprints: [],
    };

    const { result } = renderHook(() => useGitMetricsMapper(gitStats as any));

    expect(result.current.insertions.value).toBe("+1,200");
    expect(result.current.insertions.series).toEqual([1000, 200]);

    expect(result.current.deletions.value).toBe("-300");
    expect(result.current.deletions.series).toEqual([200, 100]);

    expect(result.current.prCount.value).toBe("5");
    expect(result.current.prCount.series).toEqual([4, 1]);

    expect(result.current.mergedCount.value).toBe("3");
    expect(result.current.mergedCount.series).toEqual([2, 1]);
  });
});
