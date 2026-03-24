import { describe, expect, it } from "vitest";
import { resolvePageSize, shouldResetVisibleCount } from "../../../dashboard/src/v2/lib/progressive-list-options.js";

describe("progressive list options", () => {
  describe("resolvePageSize", () => {
    it("should resolve numeric string to integer", () => {
      expect(resolvePageSize("20", 100)).toBe(20);
      expect(resolvePageSize("50", 100)).toBe(50);
    });

    it("should resolve 'All' to the total number of items", () => {
      expect(resolvePageSize("All", 42)).toBe(42);
      expect(resolvePageSize("All", 0)).toBe(0);
    });
  });

  describe("shouldResetVisibleCount", () => {
    it("should reset when the new list is smaller than currently visible", () => {
      expect(shouldResetVisibleCount(100, 10, 20)).toBe(true);
      expect(shouldResetVisibleCount(50, 49, 50)).toBe(true);
    });

    it("should not reset when new list is smaller but still greater than or equal to visible", () => {
      expect(shouldResetVisibleCount(100, 50, 20)).toBe(false);
      expect(shouldResetVisibleCount(100, 20, 20)).toBe(false);
    });

    it("should reset when transitioning from empty to non-empty list", () => {
      expect(shouldResetVisibleCount(0, 10, 0)).toBe(true);
    });

    it("should not reset when adding to a non-empty list", () => {
      expect(shouldResetVisibleCount(50, 60, 20)).toBe(false);
    });
  });
});
