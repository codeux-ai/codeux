/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useUsageChartState, parseEnabledSeries, reconcileSeries, getDefaultEnabledSeries } from "../use-usage-chart-state.js";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";

const seriesKey = (projectId: string) => `codeux_stats_enabled_series_${projectId}`;
const legacySeriesKey = (projectId: string) => `jules_stats_enabled_series_${projectId}`;
const modeKey = (projectId: string) => `codeux_stats_visual_mode_${projectId}`;

const baseStats = {
  range: { from: "a", to: "b", resolution: "day" },
  buckets: [],
  chartSeries: [{ id: "tokens", label: "Tokens", defaultEnabled: true }, { id: "active", label: "Active", defaultEnabled: false }]
} as unknown as ProjectExecutionStatsSnapshot;

describe("parseEnabledSeries", () => {
  it("returns empty object for missing/null input", () => {
    expect(parseEnabledSeries(null)).toEqual({});
  });
  it("returns empty object for malformed JSON", () => {
    expect(parseEnabledSeries('invalid')).toEqual({});
  });
  it("returns empty object for non-object types", () => {
    expect(parseEnabledSeries('["a"]')).toEqual({});
    expect(parseEnabledSeries('"string"')).toEqual({});
  });
  it("strips non-boolean properties from objects", () => {
    expect(parseEnabledSeries('{"a": true, "b": "string", "c": null, "d": false}')).toEqual({ a: true, d: false });
  });
});

describe("reconcileSeries", () => {
  const series = [{ id: "tokens", defaultEnabled: true }, { id: "active", defaultEnabled: false }];

  it("returns identical reference if state is valid and unchanged", () => {
    const current = { tokens: true, active: false };
    expect(reconcileSeries(current, series)).toBe(current);
  });

  it("adds missing series with defaultEnabled value", () => {
    const current = { tokens: true };
    const next = reconcileSeries(current, series);
    expect(next).not.toBe(current);
    expect(next).toEqual({ tokens: true, active: false });
  });

  it("adds newly introduced series without changing existing selections", () => {
    const current = { tokens: false, active: true };
    const next = reconcileSeries(current, [
      ...series,
      { id: "cost", defaultEnabled: true },
      { id: "git_files", defaultEnabled: false },
    ]);
    expect(next).toEqual({ tokens: false, active: true, cost: true, git_files: false });
  });

  it("prunes stale series", () => {
    const current = { tokens: true, active: true, stale: true };
    const next = reconcileSeries(current, series);
    expect(next).not.toBe(current);
    expect(next).toEqual({ tokens: true, active: true });
  });

  it("forces at least one active series if all are false", () => {
    const current = { tokens: false, active: false };
    const next = reconcileSeries(current, series);
    expect(next).not.toBe(current);
    expect(next).toEqual({ tokens: true, active: false });
  });

  it("resets all-disabled stored state to snapshot defaults", () => {
    const current = { tokens: false, active: false, cost: false };
    const next = reconcileSeries(current, [
      { id: "tokens", defaultEnabled: false },
      { id: "active", defaultEnabled: true },
      { id: "cost", defaultEnabled: true },
    ]);
    expect(next).toEqual({ tokens: false, active: true, cost: true });
  });
});

describe("getDefaultEnabledSeries", () => {
  it("returns snapshot defaults", () => {
    expect(getDefaultEnabledSeries([
      { id: "tokens", defaultEnabled: true },
      { id: "active", defaultEnabled: false },
      { id: "cost", defaultEnabled: true },
    ])).toEqual({ tokens: true, active: false, cost: true });
  });

  it("enables the first series when snapshot defaults are all disabled", () => {
    expect(getDefaultEnabledSeries([
      { id: "tokens", defaultEnabled: false },
      { id: "active", defaultEnabled: false },
    ])).toEqual({ tokens: true, active: false });
  });
});

describe("useUsageChartState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("handles restricted localStorage environment safely", () => {
    const originalLocalStorage = window.localStorage;
    try {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => { throw new Error("SecurityError"); },
          setItem: () => { throw new Error("SecurityError"); },
          clear: () => {}
        },
        writable: true,
        configurable: true
      });
      const { result } = renderHook(() => useUsageChartState("proj-restricted", baseStats));
      expect(result.current.enabledSeries).toEqual({ tokens: true, active: false });
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true
      });
    }
  });

  it("scopes enabled series storage by projectId", () => {
    localStorage.setItem(seriesKey("proj-1"), JSON.stringify({ tokens: false, active: true }));
    localStorage.setItem(seriesKey("proj-2"), JSON.stringify({ tokens: true, active: false }));

    let currentProj = "proj-1";
    const { result, rerender } = renderHook(() => useUsageChartState(currentProj, baseStats as any));
    expect(result.current.enabledSeries).toEqual({ tokens: false, active: true });

    // Switch project
    currentProj = "proj-2";
    rerender();

    // Verify it loads the new project's config, and doesn't overwrite proj-2 with proj-1's config
    expect(result.current.enabledSeries).toEqual({ tokens: true, active: false });
    expect(localStorage.getItem(seriesKey("proj-2"))).toBe(JSON.stringify({ tokens: true, active: false }));
  });

  it("prunes stale stored series ids", () => {
    localStorage.setItem(seriesKey("proj-1"), JSON.stringify({ old_metric: true, tokens: true }));
    const { result } = renderHook(() => useUsageChartState("proj-1", baseStats));
    expect(result.current.enabledSeries.old_metric).toBeUndefined();
    expect(result.current.enabledSeries.tokens).toBe(true);
  });

  it("recovers from all-series-disabled by forcing at least one active", () => {
    localStorage.setItem(seriesKey("proj-1"), JSON.stringify({ tokens: false, active: false }));
    const { result } = renderHook(() => useUsageChartState("proj-1", baseStats as any));
    expect(result.current.enabledSeries.tokens).toBe(true);
  });

  it("exposes grouped series view-model counts and reset helper", () => {
    localStorage.setItem(seriesKey("proj-1"), JSON.stringify({ tokens: false, active: true }));
    const { result } = renderHook(() => useUsageChartState("proj-1", {
      ...baseStats,
      chartSeries: [
        { id: "tokens", label: "Tokens", grouping: "usage", defaultEnabled: true },
        { id: "active", label: "Active", grouping: "usage", defaultEnabled: false },
        { id: "git_files", label: "Files Changed", grouping: "git", defaultEnabled: false },
      ],
    } as any));

    expect(result.current.activeSeriesCount).toBe(1);
    expect(result.current.seriesGroups).toEqual([
      expect.objectContaining({ label: "Usage", activeCount: 1, totalCount: 2, defaultEnabledCount: 1 }),
      expect.objectContaining({ label: "Git", activeCount: 0, totalCount: 1, defaultEnabledCount: 0 }),
    ]);

    act(() => {
      result.current.resetEnabledSeries();
    });

    expect(result.current.enabledSeries).toEqual({ tokens: true, active: false, git_files: false });
    expect(localStorage.getItem(seriesKey("proj-1"))).toBe(JSON.stringify({ tokens: true, active: false, git_files: false }));
  });

  it("migrates legacy series storage into the codeux key and persists visual mode per project", () => {
    localStorage.setItem(legacySeriesKey("proj-legacy"), JSON.stringify({ tokens: false, active: true }));
    localStorage.setItem(modeKey("proj-legacy"), "models");

    const { result } = renderHook(() => useUsageChartState("proj-legacy", baseStats as any));
    expect(result.current.enabledSeries).toEqual({ tokens: false, active: true });
    expect(result.current.visualMode).toBe("models");
    expect(localStorage.getItem(seriesKey("proj-legacy"))).toBe(JSON.stringify({ tokens: false, active: true }));

    act(() => {
      result.current.setVisualMode("system");
    });

    expect(localStorage.getItem(modeKey("proj-legacy"))).toBe("system");
  });
});
