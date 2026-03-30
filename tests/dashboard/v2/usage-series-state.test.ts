import { describe, it, expect } from "vitest";
import {
  buildInitialSeriesState,
  reconcileSeriesState,
  partitionSeriesByStatus,
} from "../../../dashboard/src/v2/pages/stats/usage-series-state.js";
import type { ProjectExecutionStatsChartSeries } from "../../../dashboard/src/types.js";

function createSeries(id: string, grouping: string): ProjectExecutionStatsChartSeries {
  return {
    id,
    grouping,
    label: `Label for ${id}`,
    data: [1, 2, 3],
  };
}

const defaultSeries = [
  createSeries("totals_time", "totals"),
  createSeries("totals_invocations", "totals"),
  createSeries("providers_openai", "providers"),
];

describe("Usage Series State", () => {
  describe("buildInitialSeriesState", () => {
    it("builds state from default enabled list", () => {
      const state = buildInitialSeriesState(defaultSeries, ["totals_time"]);
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      });
    });

    it("falls back to the first series if default list is empty", () => {
      const state = buildInitialSeriesState(defaultSeries, []);
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      });
    });

    it("falls back to the first series if default list contains no matching ids", () => {
      const state = buildInitialSeriesState(defaultSeries, ["non_existent"]);
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      });
    });

    it("handles an empty series array gracefully", () => {
      const state = buildInitialSeriesState([], ["totals_time"]);
      expect(state).toEqual({});
    });
  });

  describe("reconcileSeriesState", () => {
    it("preserves state for identical series ids across refreshes", () => {
      const prevState = {
        totals_time: true,
        totals_invocations: true,
        providers_openai: false,
      };

      const state = reconcileSeriesState(defaultSeries, prevState);
      expect(state).toEqual(prevState);
    });

    it("drops state for missing series ids", () => {
      const prevState = {
        totals_time: true,
        removed_series: true,
        providers_openai: false,
      };

      const state = reconcileSeriesState(defaultSeries, prevState);
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      });
    });

    it("adds new series ids as disabled by default", () => {
      const extendedSeries = [
        ...defaultSeries,
        createSeries("new_series", "details"),
      ];
      const prevState = {
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      };

      const state = reconcileSeriesState(extendedSeries, prevState);
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
        new_series: false,
      });
    });

    it("guarantees at least one visible series remains enabled when previous state was entirely dropped", () => {
      const prevState = {
        removed_series_1: true,
        removed_series_2: true,
      };

      const state = reconcileSeriesState(defaultSeries, prevState);
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      });
    });

    it("guarantees at least one visible series when user somehow toggled all off (preventing empty state)", () => {
      const prevState = {
        totals_time: false,
        totals_invocations: false,
        providers_openai: false,
      };

      const state = reconcileSeriesState(defaultSeries, prevState);
      // It should force the first series to be true
      expect(state).toEqual({
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      });
    });
  });

  describe("partitionSeriesByStatus", () => {
    it("partitions into active and inactive while preserving backend grouping names", () => {
      const enabledState = {
        totals_time: true,
        totals_invocations: false,
        providers_openai: false,
      };

      const partitioned = partitionSeriesByStatus(defaultSeries, enabledState);

      expect(partitioned.activeGroups).toEqual({
        totals: [defaultSeries[0]], // totals_time
      });

      expect(partitioned.inactiveGroups).toEqual({
        totals: [defaultSeries[1]], // totals_invocations
        providers: [defaultSeries[2]], // providers_openai
      });
    });

    it("handles all active series", () => {
      const enabledState = {
        totals_time: true,
        totals_invocations: true,
        providers_openai: true,
      };

      const partitioned = partitionSeriesByStatus(defaultSeries, enabledState);

      expect(partitioned.activeGroups).toEqual({
        totals: [defaultSeries[0], defaultSeries[1]],
        providers: [defaultSeries[2]],
      });

      expect(partitioned.inactiveGroups).toEqual({});
    });

    it("handles missing enabledState keys as inactive by default", () => {
      const enabledState = {
        totals_time: true,
      };

      const partitioned = partitionSeriesByStatus(defaultSeries, enabledState);

      expect(partitioned.activeGroups).toEqual({
        totals: [defaultSeries[0]],
      });

      expect(partitioned.inactiveGroups).toEqual({
        totals: [defaultSeries[1]],
        providers: [defaultSeries[2]],
      });
    });
  });
});
