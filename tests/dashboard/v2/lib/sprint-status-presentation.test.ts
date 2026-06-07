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

  it("maps running sprint with 100% completion or merge_required attention to Merge state", () => {
    const result1 = getSprintStatusPresentation({
      state: "running",
      completion: 100,
    });
    expect(result1.statusLabel).toBe("Merge");
    expect(result1.title).toBe("Attempting Base Branch Merge");

    const result2 = getSprintStatusPresentation({
      state: "paused",
      attentionType: "merge_required",
    });
    expect(result2.statusLabel).toBe("Merge");
    expect(result2.title).toBe("Attempting Base Branch Merge");
  });

  it("maps sprint with active review status to QA state", () => {
    const result = getSprintStatusPresentation({
      state: "running",
      latestReviewStatus: "running",
    });
    expect(result.statusLabel).toBe("QA");
    expect(result.title).toBe("Sprint in QA Gate");
  });

  it("maps merge conflict attention or block to Merge Conflict state", () => {
    const result1 = getSprintStatusPresentation({
      state: "paused",
      attentionType: "merge_conflict",
    });
    expect(result1.statusLabel).toBe("Merge Conflict");
    expect(result1.showHumanInterventionBadge).toBe(true);

    const result2 = getSprintStatusPresentation({
      state: "paused",
      pauseReason: "main_merge_blocked",
    });
    expect(result2.statusLabel).toBe("Merge Conflict");
    expect(result2.showHumanInterventionBadge).toBe(true);
  });

  it("maps idle state to Draft", () => {
    const result = getSprintStatusPresentation({
      state: "idle",
    });
    expect(result.statusLabel).toBe("Draft");
  });
});
