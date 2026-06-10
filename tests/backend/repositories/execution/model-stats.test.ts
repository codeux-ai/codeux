import { describe, expect, it } from "vitest";
import {
  addStatusCount,
  buildModelStatsKey,
  buildModelStatsLabel,
  computeDurationStats,
  computeSuccessRate,
  createEmptyStatusCounts,
} from "../../../../src/repositories/execution/model-stats.js";

describe("model-stats", () => {
  it("counts known statuses and ignores unknown ones", () => {
    const counts = createEmptyStatusCounts();
    addStatusCount(counts, "completed", 3);
    addStatusCount(counts, "failed", 2);
    addStatusCount(counts, "cancelled", 1);
    addStatusCount(counts, "running", 4);
    addStatusCount(counts, "paused", 1);
    addStatusCount(counts, "mystery", 9);
    addStatusCount(counts, null, 9);

    expect(counts).toEqual({ completed: 3, failed: 2, cancelled: 1, running: 4, paused: 1 });
  });

  it("computes success rate over finished invocations only", () => {
    const counts = createEmptyStatusCounts();
    counts.completed = 8;
    counts.failed = 1;
    counts.cancelled = 1;
    counts.running = 100;

    expect(computeSuccessRate(counts)).toBeCloseTo(0.8);
  });

  it("returns null success rate when nothing finished", () => {
    const counts = createEmptyStatusCounts();
    counts.running = 5;
    expect(computeSuccessRate(counts)).toBeNull();
  });

  it("computes duration percentiles from raw samples", () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const stats = computeDurationStats(durations);

    expect(stats.sampleCount).toBe(10);
    expect(stats.avgMs).toBe(550);
    expect(stats.p50Ms).toBe(500);
    expect(stats.p95Ms).toBe(1000);
    expect(stats.maxMs).toBe(1000);
  });

  it("filters invalid duration samples and handles empty input", () => {
    expect(computeDurationStats([])).toEqual({ sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
    expect(computeDurationStats([-5, 0, Number.NaN, 250]).sampleCount).toBe(1);
    expect(computeDurationStats([-5, 0, Number.NaN, 250]).p50Ms).toBe(250);
  });

  it("builds stable model keys and readable labels", () => {
    expect(buildModelStatsKey("claude", "claude-opus-4-8")).toBe("claude::claude-opus-4-8");
    expect(buildModelStatsKey("gemini", null)).toBe("gemini::");
    expect(buildModelStatsKey(null, null)).toBe("unknown::");
    expect(buildModelStatsLabel("claude", "claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(buildModelStatsLabel("gemini", "  ")).toBe("gemini (default)");
    expect(buildModelStatsLabel(null, null)).toBe("unknown (default)");
  });
});
