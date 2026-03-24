import { describe, expect, it } from "vitest";
import { derivePlanningETA } from "../../../dashboard/src/v2/lib/planning-telemetry.js";
import type { ProjectExecutionStatsSnapshot } from "../../../dashboard/src/v2/types.js";

describe("planning-telemetry", () => {
  describe("derivePlanningETA", () => {
    it("returns 180000 fallback for null stats", () => {
      expect(derivePlanningETA(null)).toBe(180000);
    });

    it("returns 180000 fallback when purposes is missing", () => {
      const stats = {
        purposes: null,
      } as unknown as ProjectExecutionStatsSnapshot;
      expect(derivePlanningETA(stats)).toBe(180000);
    });

    it("returns 180000 fallback when planning purpose is not found", () => {
      const stats = {
        purposes: [
          { purpose: "test", usage: { invocationCount: 1, activeTimeMs: 1000 } }
        ]
      } as unknown as ProjectExecutionStatsSnapshot;
      expect(derivePlanningETA(stats)).toBe(180000);
    });

    it("returns 180000 fallback when planning purpose usage is missing", () => {
      const stats = {
        purposes: [
          { purpose: "planning" }
        ]
      } as unknown as ProjectExecutionStatsSnapshot;
      expect(derivePlanningETA(stats)).toBe(180000);
    });

    it("returns 180000 fallback when invocationCount is 0", () => {
      const stats = {
        purposes: [
          { purpose: "planning", usage: { invocationCount: 0, activeTimeMs: 1000 } }
        ]
      } as unknown as ProjectExecutionStatsSnapshot;
      expect(derivePlanningETA(stats)).toBe(180000);
    });

    it("returns average activeTimeMs per invocation", () => {
      const stats = {
        purposes: [
          { purpose: "planning", usage: { invocationCount: 3, activeTimeMs: 150000 } }
        ]
      } as unknown as ProjectExecutionStatsSnapshot;
      expect(derivePlanningETA(stats)).toBe(50000);
    });
  });
});
