import { describe, it, expect } from "vitest";
import { getPlanningFeedback } from "../../../dashboard/src/v2/lib/sprint-planning-feedback.js";

describe("getPlanningFeedback", () => {
  it("should return progressive feedback for improve action", () => {
    const feedback0 = getPlanningFeedback("improve", 0);
    expect(feedback0.progress).toBe(0);
    expect(feedback0.shipProgress).toBe(0);
    expect(feedback0.text).toBe("Researching codebase context...");
    expect(feedback0.shipType).toBe("wooden");

    // After 8 seconds (half-life), progress should be around 0.5 (1 - e^-1)
    const feedback8s = getPlanningFeedback("improve", 8000);
    expect(feedback8s.progress).toBeGreaterThan(0.4);
    expect(feedback8s.progress).toBeLessThan(0.7);
    expect(feedback8s.text).toBe("Refining technical requirements...");

    // After a long time, it should reach the last stage
    const feedbackLong = getPlanningFeedback("improve", 100000);
    expect(feedbackLong.progress).toBeGreaterThan(0.95);
    expect(feedbackLong.text).toBe("Synthesizing improved plan...");
  });

  it("should return progressive feedback for plan_and_start action", () => {
    const feedback0 = getPlanningFeedback("plan_and_start", 0);
    expect(feedback0.text).toBe("Registering sprint definition...");
    expect(feedback0.shipType).toBe("container");

    const feedbackLong = getPlanningFeedback("plan_and_start", 100000);
    expect(feedbackLong.text).toBe("Preparing launch sequence...");
  });

  it("should return progressive feedback for replan action", () => {
    const feedback0 = getPlanningFeedback("replan", 0);
    expect(feedback0.text).toBe("Analyzing existing tasks...");

    const feedbackLong = getPlanningFeedback("replan", 100000);
    expect(feedbackLong.text).toBe("Finalizing new structure...");
  });

  it("should loop ship progress continuously", () => {
    // At 0ms, shipProgress should be 0
    expect(getPlanningFeedback("plan_only", 0).shipProgress).toBe(0);

    // At 6000ms (half of 12s loop), shipProgress should be ~0.5
    const mid = getPlanningFeedback("plan_only", 6000);
    expect(mid.shipProgress).toBeCloseTo(0.5, 1);

    // At 12000ms (full loop), shipProgress should wrap back to 0
    const looped = getPlanningFeedback("plan_only", 12000);
    expect(looped.shipProgress).toBeCloseTo(0, 1);

    // At 18000ms (1.5 loops), shipProgress should be ~0.5 again
    const oneAndHalf = getPlanningFeedback("plan_only", 18000);
    expect(oneAndHalf.shipProgress).toBeCloseTo(0.5, 1);
  });

  it("should advance stage text independently from ship loop", () => {
    // At 100s, text should be at last stage but ship still loops
    const late = getPlanningFeedback("plan_only", 100000);
    expect(late.text).toBe("Finalizing sprint structure...");
    expect(late.progress).toBeGreaterThan(0.95);
    // shipProgress loops: 100000 % 12000 = 4000, 4000/12000 ≈ 0.333
    expect(late.shipProgress).toBeCloseTo(4000 / 12000, 1);
  });
});
