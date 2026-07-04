import { describe, expect, it } from "vitest";
import {
  buildMetricSeries,
  extractModelSeries,
  extractProviderSeries,
  extractPurposeInvocationSeries,
} from "../../../dashboard/src/v2/lib/stats/series-builders.js";

describe("series-builders", () => {
  const mockStats = {
    chartSeries: [
      { id: "purpose_invocations_task_coding", data: [1, 2, 3] },
      { id: "purpose_invocations_ci_fix", data: [4, 5, 6] },
      { id: "purpose_invocations_qa_review", data: [7, 8, 9] },
      { id: "purpose_invocations_planning", data: [10, 11, 12] },
      { id: "provider_codex", data: [12, 16, 20] },
      { id: "model_gpt-5", data: [3, 5, 8] },
      { id: "git_merge_conflicts", data: [0, 1, 2] },
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
    expect(series.gitMergeConflicts).toEqual([0, 1, 2]);
  });

  it("handles null stats", () => {
    const series = buildMetricSeries(null);
    expect(series.taskCodingTokens).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(series.wallRuntime).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns stable zero-filled empty series for snapshots without buckets", () => {
    const series = buildMetricSeries({ chartSeries: [], buckets: [] } as any);
    expect(series.totalTokens).toHaveLength(7);
    expect(series.totalTokens.every((point) => point === 0)).toBe(true);
    expect(series.gitFilesChanged).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("extracts provider, model, and purpose series without fallback noise", () => {
    expect(extractProviderSeries(mockStats, "codex")).toEqual([12, 16, 20]);
    expect(extractModelSeries(mockStats, "gpt-5")).toEqual([3, 5, 8]);
    expect(extractPurposeInvocationSeries(mockStats, "task_coding")).toEqual([1, 2, 3]);
    expect(extractProviderSeries(mockStats, "missing")).toEqual([]);
  });
});
