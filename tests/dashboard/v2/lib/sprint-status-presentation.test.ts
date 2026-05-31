import { describe, expect, it } from "vitest";
import { getSprintStatusPresentation } from "../../../../dashboard/src/v2/lib/sprint-status-presentation.js";

describe("getSprintStatusPresentation", () => {
  it("maps manual pause to human intervention copy and badge visibility", () => {
    const result = getSprintStatusPresentation({
      state: "paused",
      pauseSource: "manual",
      humanInterventionTitle: "Sprint Paused For Human Intervention",
      humanInterventionReason: "A dependency must be approved.",
      humanInterventionInstructions: "Approve dependency and resume the sprint.",
      humanInterventionOwnerType: "human",
    });

    expect(result.isManualPause).toBe(true);
    expect(result.isSystemStop).toBe(false);
    expect(result.showHumanInterventionBadge).toBe(true);
    expect(result.title).toContain("Human Intervention");
    expect(result.reason).toContain("dependency");
  });

  it("maps system stop to non-intervention copy and hides badge", () => {
    const result = getSprintStatusPresentation({
      state: "paused",
      pauseSource: "system",
      stopReasonTitle: "Sprint Stopped By System",
      stopReason: "No executable work was available.",
      stopReasonDetail: "Wait for new tasks, then restart.",
      humanInterventionOwnerType: "worker",
    });

    expect(result.isManualPause).toBe(false);
    expect(result.isSystemStop).toBe(true);
    expect(result.showHumanInterventionBadge).toBe(false);
    expect(result.title).toBe("Sprint Stopped By System");
    expect(result.reason.toLowerCase()).toContain("no executable work");
    expect(result.title.toLowerCase()).not.toContain("human intervention");
  });

  it("maps active statuses as running without intervention badge", () => {
    const result = getSprintStatusPresentation({
      state: "running",
    });

    expect(result.statusLabel).toBe("Running");
    expect(result.isManualPause).toBe(false);
    expect(result.isSystemStop).toBe(false);
    expect(result.showHumanInterventionBadge).toBe(false);
  });

  it("returns a safe fallback for unknown states", () => {
    const result = getSprintStatusPresentation({
      state: "mystery_state",
    });

    expect(result.statusLabel).toBe("Mystery State");
    expect(result.title).toBe("Sprint Mystery State");
    expect(result.showHumanInterventionBadge).toBe(false);
  });
});
