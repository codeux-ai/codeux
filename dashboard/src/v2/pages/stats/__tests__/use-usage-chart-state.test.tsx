/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useUsageChartState } from "../use-usage-chart-state.js";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";

const baseStats = {
  range: { from: "a", to: "b", resolution: "day" },
  buckets: [],
  chartSeries: [{ id: "tokens", label: "Tokens", defaultEnabled: true }, { id: "active", label: "Active", defaultEnabled: false }]
} as unknown as ProjectExecutionStatsSnapshot;

describe("useUsageChartState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("scopes enabled series storage by projectId", () => {
    localStorage.setItem('jules_stats_enabled_series_proj-1', JSON.stringify({ tokens: false, active: true }));
    localStorage.setItem('jules_stats_enabled_series_proj-2', JSON.stringify({ tokens: true, active: false }));

    let currentProj = "proj-1";
    const { result, rerender } = renderHook(() => useUsageChartState(currentProj, baseStats as any));
    expect(result.current.enabledSeries).toEqual({ tokens: false, active: true });

    // Switch project
    currentProj = "proj-2";
    rerender();

    // Verify it loads the new project's config, and doesn't overwrite proj-2 with proj-1's config
    expect(result.current.enabledSeries).toEqual({ tokens: true, active: false });
    expect(localStorage.getItem('jules_stats_enabled_series_proj-2')).toBe(JSON.stringify({ tokens: true, active: false }));
  });

  it("prunes stale stored series ids", () => {
    localStorage.setItem('jules_stats_enabled_series_proj-1', JSON.stringify({ old_metric: true, tokens: true }));
    const { result } = renderHook(() => useUsageChartState("proj-1", baseStats));
    expect(result.current.enabledSeries.old_metric).toBeUndefined();
    expect(result.current.enabledSeries.tokens).toBe(true);
  });

  it("recovers from all-series-disabled by forcing at least one active", () => {
    localStorage.setItem('jules_stats_enabled_series_proj-1', JSON.stringify({ tokens: false, active: false }));
    const { result } = renderHook(() => useUsageChartState("proj-1", baseStats as any));
    expect(result.current.enabledSeries.tokens).toBe(true);
  });
});
