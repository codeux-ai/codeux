import { describe, expect, it } from "vitest";
import { computeSprintActionMenuPosition } from "../../../dashboard/src/v2/lib/sprint-menu-positioning.js";

describe("computeSprintActionMenuPosition", () => {
  it("positions below and right-aligned when there is enough space", () => {
    const result = computeSprintActionMenuPosition(
      { top: 100, left: 200, right: 260, bottom: 136, width: 60, height: 36 },
      { width: 1200, height: 800 },
      { width: 240, height: 180 },
    );

    expect(result.left).toBe(20);
    expect(result.top).toBe(144);
    expect(result.placement).toBe("bottom");
  });

  it("flips upward when there is not enough space below", () => {
    const result = computeSprintActionMenuPosition(
      { top: 740, left: 420, right: 500, bottom: 770, width: 80, height: 30 },
      { width: 1200, height: 820 },
      { width: 220, height: 140 },
    );

    expect(result.placement).toBe("top");
    expect(result.top).toBe(592);
    expect(result.left).toBe(280);
  });

  it("clamps to viewport right edge padding for large menus", () => {
    const result = computeSprintActionMenuPosition(
      { top: 120, left: 890, right: 920, bottom: 150, width: 30, height: 30 },
      { width: 960, height: 700 },
      { width: 220, height: 120 },
    );

    expect(result.left).toBe(700);
    expect(result.top).toBe(158);
    expect(result.placement).toBe("bottom");
  });

  it("keeps menu inside narrow viewport with left clamp", () => {
    const result = computeSprintActionMenuPosition(
      { top: 70, left: 18, right: 58, bottom: 98, width: 40, height: 28 },
      { width: 220, height: 300 },
      { width: 240, height: 140 },
    );

    expect(result.left).toBe(8);
    expect(result.top).toBe(106);
    expect(result.placement).toBe("bottom");
  });
});
