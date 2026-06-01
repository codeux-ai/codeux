import { describe, expect, it } from "vitest";
import { PlanningEtaEstimator, PLANNING_ETA_FALLBACK_MS } from "../../../../../src/domain/sprint/composer/eta-estimator.js";

describe("PlanningEtaEstimator", () => {
  const estimator = new PlanningEtaEstimator();

  it("returns fallback when no durations provided", () => {
    const result = estimator.estimate([]);
    expect(result.estimatedMs).toBe(PLANNING_ETA_FALLBACK_MS);
    expect(result.sampleSize).toBe(0);
    expect(result.isFallback).toBe(true);
  });

  it("averages exactly 10 records", () => {
    const durations = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
    const result = estimator.estimate(durations);
    expect(result.estimatedMs).toBe(5500);
    expect(result.sampleSize).toBe(10);
    expect(result.isFallback).toBe(false);
  });

  it("averages fewer than 10 records", () => {
    const durations = [1000, 2000, 3000];
    const result = estimator.estimate(durations);
    expect(result.estimatedMs).toBe(2000);
    expect(result.sampleSize).toBe(3);
    expect(result.isFallback).toBe(false);
  });

  it("handles empty values by falling back if average is 0", () => {
    const durations = [0, 0, 0];
    const result = estimator.estimate(durations);
    expect(result.estimatedMs).toBe(PLANNING_ETA_FALLBACK_MS);
    expect(result.isFallback).toBe(false); // It's not a fallback due to no data, but due to zero average
  });
});
