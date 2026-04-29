import { describe, it, expect } from "vitest";
import {
  buildPath,
  buildPoints,
  polarToCartesian,
  buildDonutSlices,
  buildSmoothPath,
  buildAreaPath,
  buildSmoothAreaPath,
  buildDonutArcPath,
} from "../components/stats-geometry.js";

describe("stats-geometry", () => {
  describe("buildPath", () => {
    it("returns empty string for empty points", () => {
      expect(buildPath([])).toBe("");
    });

    it("builds correct M and L commands", () => {
      const points = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
      expect(buildPath(points)).toBe("M 10.00 20.00 L 30.00 40.00");
    });
  });

  describe("buildSmoothPath", () => {
    it("returns empty string for empty points", () => {
      expect(buildSmoothPath([])).toBe("");
    });

    it("handles single point", () => {
      expect(buildSmoothPath([{ x: 10, y: 20 }])).toBe("M 10.00 20.00");
    });

    it("builds correct curve commands", () => {
      const points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
      const path = buildSmoothPath(points);
      expect(path).toContain("M 0.00 0.00");
      expect(path).toContain("C 35.00 0.00");
    });
  });

  describe("buildAreaPath", () => {
    it("returns empty string for empty points", () => {
      expect(buildAreaPath([], 100, 10)).toBe("");
    });

    it("builds closed area path", () => {
      const points = [{ x: 0, y: 10 }, { x: 10, y: 20 }];
      const path = buildAreaPath(points, 100, 10);
      expect(path).toContain("M 0.00 10.00 L 10.00 20.00 L 10.00 90.00 L 0.00 90.00 Z");
    });
  });

  describe("buildSmoothAreaPath", () => {
    it("returns empty string for empty points", () => {
      expect(buildSmoothAreaPath([], 100, 10)).toBe("");
    });

    it("builds closed smooth area path", () => {
      const points = [{ x: 0, y: 10 }, { x: 10, y: 20 }];
      const path = buildSmoothAreaPath(points, 100, 10);
      expect(path).toContain("Z");
    });
  });

  describe("buildPoints", () => {
    it("handles empty array", () => {
      const points = buildPoints([], 100, 100, 10);
      expect(points.length).toBe(1);
    });

    it("distributes points correctly", () => {
      const points = buildPoints([0, 100], 100, 100, 0);
      expect(points).toEqual([
        { x: 0, y: 100 },
        { x: 100, y: 0 },
      ]);
    });
  });

  describe("polarToCartesian", () => {
    it("calculates correct coordinates", () => {
      const pt = polarToCartesian(0, 0, 10, 90);
      expect(pt.x).toBeCloseTo(10, 5);
      expect(pt.y).toBeCloseTo(0, 5);
    });
  });

  describe("buildDonutArcPath", () => {
    it("builds valid path", () => {
      const path = buildDonutArcPath(0, 0, 100, 50, 0, 90);
      expect(path).toContain("M");
      expect(path).toContain("A");
      expect(path).toContain("Z");
    });
  });

  describe("buildDonutSlices", () => {
    it("returns empty for no valid segments", () => {
      expect(buildDonutSlices([{ label: "A", value: 0, color: "#000" } as any])).toEqual([]);
    });

    it("calculates slices correctly", () => {
      const segments: any[] = [
        { label: "A", value: 10, color: "#f00" },
        { label: "B", value: 30, color: "#0f0" },
      ];
      const slices = buildDonutSlices(segments);
      expect(slices.length).toBe(2);
      expect(slices[0]!.share).toBe(25);
      expect(slices[1]!.share).toBe(75);
    });
  });
});
