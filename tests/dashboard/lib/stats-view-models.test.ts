import { describe, expect, it } from "vitest";
import {
  getChartSeries,
  getLedgerSortValue,
  sortLedgerItems,
  windowLedgerItems,
  buildDonutSlices,
} from "../../../dashboard/src/v2/pages/stats/stats-view-models.js";
import type { ExecutionStatsEntitySummary } from "../../../dashboard/src/types.js";

describe("stats-view-models", () => {
  describe("getChartSeries", () => {
    it("returns specific series for valid ids", () => {
      expect(getChartSeries("tokens").label).toBe("Tokens");
      expect(getChartSeries("active").label).toBe("Active Time");
      expect(getChartSeries("invocations").label).toBe("Invocations");
    });

    it("falls back to default series for invalid ids", () => {
      expect(getChartSeries("unknown" as any).label).toBe("Tokens");
    });
  });

  describe("ledger sorting and windowing", () => {
    const items: ExecutionStatsEntitySummary[] = [
      { id: "1", label: "A", type: "worker", lastActivityAt: "2024-01-01T00:00:00Z", usage: { invocationCount: 1, activeTimeMs: 100, wallTimeMs: 100, totalTokens: 10, inputTokens: 5, outputTokens: 5, estimatedInvocationCount: 0, reportedInvocationCount: 1 } },
      { id: "2", label: "C", type: "worker", lastActivityAt: "2024-01-03T00:00:00Z", usage: { invocationCount: 2, activeTimeMs: 300, wallTimeMs: 300, totalTokens: 30, inputTokens: 15, outputTokens: 15, estimatedInvocationCount: 0, reportedInvocationCount: 2 } },
      { id: "3", label: "B", type: "worker", lastActivityAt: "2024-01-02T00:00:00Z", usage: { invocationCount: 3, activeTimeMs: 200, wallTimeMs: 200, totalTokens: 20, inputTokens: 10, outputTokens: 10, estimatedInvocationCount: 0, reportedInvocationCount: 3 } },
    ];

    it("gets ledger sort value correctly", () => {
      expect(getLedgerSortValue(items[0], "tokens")).toBe(10);
      expect(getLedgerSortValue(items[0], "name")).toBe("a");
      expect(typeof getLedgerSortValue(items[0], "last")).toBe("number");
    });

    it("sorts ascending correctly", () => {
      const sorted = sortLedgerItems(items, "name", false);
      expect(sorted.map(i => i.label)).toEqual(["A", "B", "C"]);
    });

    it("sorts descending correctly", () => {
      const sorted = sortLedgerItems(items, "tokens", true);
      expect(sorted.map(i => i.label)).toEqual(["C", "B", "A"]);
    });

    it("windows items correctly", () => {
      const windowed1 = windowLedgerItems(items, 1, 2);
      expect(windowed1.length).toBe(2);
      expect(windowed1[0].id).toBe("1");

      const windowed2 = windowLedgerItems(items, 2, 2);
      expect(windowed2.length).toBe(1);
      expect(windowed2[0].id).toBe("3");
    });
  });

  describe("buildDonutSlices", () => {
    it("returns empty array for empty segments", () => {
      expect(buildDonutSlices([])).toEqual([]);
    });

    it("returns empty array when total is zero", () => {
      expect(buildDonutSlices([{ id: "1", label: "A", value: 0, colorHex: "#000" }])).toEqual([]);
    });

    it("calculates slices correctly", () => {
      const segments = [
        { id: "1", label: "A", value: 10, colorHex: "#000" },
        { id: "2", label: "B", value: 30, colorHex: "#111" },
      ];
      const slices = buildDonutSlices(segments);

      expect(slices.length).toBe(2);
      expect(slices[0].share).toBe(25);
      expect(slices[1].share).toBe(75);

      expect(slices[0].startAngle).toBe(-90);
      expect(slices[0].endAngle).toBe(0); // -90 + 90

      expect(slices[1].startAngle).toBe(0);
      expect(slices[1].endAngle).toBe(270); // 0 + 270
    });
  });
});
