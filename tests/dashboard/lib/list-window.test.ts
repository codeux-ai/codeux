import { describe, it, expect } from "vitest";
import { resolveListWindow, DEFAULT_LIST_WINDOW, sliceListWindow } from "../../../dashboard/src/v2/lib/list-window.js";

describe("List Window Utilities", () => {
  describe("resolveListWindow", () => {
    it("returns the exact option when totalItems is larger than the window", () => {
      expect(resolveListWindow(20, 100)).toBe(20);
      expect(resolveListWindow(50, 100)).toBe(50);
    });

    it("returns totalItems when the total is smaller than the selected window", () => {
      expect(resolveListWindow(50, 25)).toBe(25);
      expect(resolveListWindow(100, 5)).toBe(5);
    });

    it("handles the 'All' sentinel by returning the exact total items", () => {
      expect(resolveListWindow("All", 42)).toBe(42);
      expect(resolveListWindow("all", 42)).toBe(42);
      expect(resolveListWindow("All", 0)).toBe(0);
      expect(resolveListWindow("All", 9999)).toBe(9999);
    });

    it("returns 0 when totalItems is 0, regardless of the window option", () => {
      expect(resolveListWindow(10, 0)).toBe(0);
      expect(resolveListWindow(100, 0)).toBe(0);
    });
  });

  describe("sliceListWindow", () => {
    it("returns only the requested visible window for large lists", () => {
      const items = Array.from({ length: 50 }, (_, index) => index + 1);

      expect(sliceListWindow(items, 20)).toEqual(items.slice(0, 20));
    });

    it("clamps safely when the filtered list is smaller than the active window", () => {
      const filteredItems = ["task-a", "task-b"];

      expect(sliceListWindow(filteredItems, 50)).toEqual(filteredItems);
      expect(sliceListWindow(filteredItems, "All")).toEqual(filteredItems);
    });
  });

  describe("Constants", () => {
    it("exports DEFAULT_LIST_WINDOW as 20", () => {
      expect(DEFAULT_LIST_WINDOW).toBe(20);
    });
  });
});
