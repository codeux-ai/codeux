import { describe, it, expect } from "vitest";
import { getPlanningFeedback } from "../../../dashboard/src/v2/lib/sprint-planning-feedback.js";

describe("getPlanningFeedback", () => {
  it("should return progressive feedback for improve action", () => {
    const feedback0 = getPlanningFeedback("improve", 0);
    expect(feedback0.progress).toBe(0);
    expect(feedback0.text).toBe("Consulting design guidelines...");
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
});
