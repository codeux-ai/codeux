import { describe, expect, it } from "vitest";
import {
  clampSprintCompletion,
  formatSprintCompletion,
} from "../../../dashboard/src/v2/lib/sprint-progress-display.js";

describe("sprint progress display", () => {
  it("clamps completion and retains one decimal place", () => {
    expect(clampSprintCompletion(-4)).toBe(0);
    expect(clampSprintCompletion(7.54)).toBe(7.5);
    expect(clampSprintCompletion(105)).toBe(100);
    expect(clampSprintCompletion(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampSprintCompletion(Number.NaN)).toBe(0);
  });

  it("formats decimals without unnecessary trailing zeroes", () => {
    expect(formatSprintCompletion(5)).toBe("5%");
    expect(formatSprintCompletion(7.5)).toBe("7.5%");
    expect(formatSprintCompletion(100.04)).toBe("100%");
  });
});
