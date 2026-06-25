import { describe, expect, it } from "vitest";
import { isValidCustomRange } from "../../../dashboard/src/v2/pages/stats/stats-utils.js";

describe("stats-date-validation", () => {
  describe("isValidCustomRange", () => {
    it("returns true for a valid date range", () => {
      expect(isValidCustomRange("2024-03-01", "2024-03-07")).toBe(true);
    });

    it("returns true for a single day range (same start and end)", () => {
      expect(isValidCustomRange("2024-03-01", "2024-03-01")).toBe(true);
    });

    it("returns false if 'from' is after 'to'", () => {
      expect(isValidCustomRange("2024-03-08", "2024-03-01")).toBe(false);
    });

    it("returns false if 'from' is missing", () => {
      expect(isValidCustomRange("", "2024-03-01")).toBe(false);
    });

    it("returns false if 'to' is missing", () => {
      expect(isValidCustomRange("2024-03-01", "")).toBe(false);
    });

    it("returns false if both are missing", () => {
      expect(isValidCustomRange("", "")).toBe(false);
    });

    it("returns false for invalid date strings", () => {
      expect(isValidCustomRange("invalid", "2024-03-01")).toBe(false);
      expect(isValidCustomRange("2024-03-01", "invalid")).toBe(false);
    });
  });
});
