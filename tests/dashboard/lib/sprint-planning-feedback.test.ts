import { describe, it, expect } from "vitest";
import {
  getPlanningCancelledMessage,
  getPlanningFeedback,
  getPlanningPendingMessage,
  SHIP_LOOP_MS,
} from "../../../dashboard/src/v2/lib/sprint-planning-feedback.js";

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

  it("should return progressive feedback for draft and append_tasks actions", () => {
    const draftFeedback = getPlanningFeedback("draft", 0);
    expect(draftFeedback.text).toBe("Saving draft...");

    const appendFeedback = getPlanningFeedback("append_tasks", 100000);
    expect(appendFeedback.text).toBe("Finalizing sprint...");
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

  it("should expose offscreen ship visual travel states", () => {
    const start = getPlanningFeedback("plan_only", 0);
    expect(start.shipVisual).toEqual({
      trackXPercent: -20,
      opacity: 1,
      visible: true,
      phase: "entering",
    });

    const midTrack = getPlanningFeedback("plan_only", SHIP_LOOP_MS * 0.45);
    expect(midTrack.shipProgress).toBeCloseTo(0.45);
    expect(midTrack.shipVisual.trackXPercent).toBeCloseTo(50);
    expect(midTrack.shipVisual.opacity).toBe(1);
    expect(midTrack.shipVisual.visible).toBe(true);
    expect(midTrack.shipVisual.phase).toBe("crossing");

    const rightExit = getPlanningFeedback("plan_only", SHIP_LOOP_MS * 0.82);
    expect(rightExit.shipVisual.trackXPercent).toBeGreaterThan(100);
    expect(rightExit.shipVisual.opacity).toBe(1);
    expect(rightExit.shipVisual.visible).toBe(true);
    expect(rightExit.shipVisual.phase).toBe("exiting");

    const wrap = getPlanningFeedback("plan_only", SHIP_LOOP_MS * 0.95);
    expect(wrap.shipVisual).toEqual({
      trackXPercent: -20,
      opacity: 0,
      visible: false,
      phase: "hidden",
    });

    const leftSpawn = getPlanningFeedback("plan_only", SHIP_LOOP_MS);
    expect(leftSpawn.shipProgress).toBe(0);
    expect(leftSpawn.shipVisual).toEqual({
      trackXPercent: -20,
      opacity: 1,
      visible: true,
      phase: "entering",
    });
  });

  it("should advance stage text independently from ship loop", () => {
    // At 100s, text should be at last stage but ship still loops
    const late = getPlanningFeedback("plan_only", 100000);
    const sameLoopPosition = getPlanningFeedback("plan_only", 4000);
    expect(late.text).toBe("Finalizing sprint structure...");
    expect(late.progress).toBeGreaterThan(0.95);
    // shipProgress loops: 100000 % 12000 = 4000, 4000/12000 ≈ 0.333
    expect(late.shipProgress).toBeCloseTo(4000 / 12000, 1);
    expect(late.shipVisual.trackXPercent).toBeCloseTo(sameLoopPosition.shipVisual.trackXPercent);
    expect(late.shipVisual.phase).toBe(sameLoopPosition.shipVisual.phase);
    expect(sameLoopPosition.text).not.toBe(late.text);
  });

  it("returns state-specific pending and cancellation copy", () => {
    expect(getPlanningPendingMessage("improve")).toContain("Prompt improvement started");
    expect(getPlanningPendingMessage("plan_and_start")).toContain("will launch only after planning completes");
    expect(getPlanningCancelledMessage("plan_only")).toContain("was not started");
    expect(getPlanningCancelledMessage("replan")).toContain("Existing tasks were left unchanged");
  });

  it("localizes progress and cancellation feedback without changing action modes", () => {
    expect(getPlanningFeedback("plan_only", 0, "de").text).toBe("Sprintdefinition wird registriert...");
    expect(getPlanningPendingMessage("plan_and_start", "de")).toContain("startet erst nach erfolgreicher Planung");
    expect(getPlanningCancelledMessage("replan", "de")).toContain("Bestehende Aufgaben blieben unverändert");
  });
});
