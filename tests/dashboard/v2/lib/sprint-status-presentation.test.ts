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

  it("does not infer a merge stage from task completion alone", () => {
    const result = getSprintStatusPresentation({
      state: "running",
      completion: 100,
    });

    expect(result.statusLabel).toBe("Running");
    expect(result.title).toBe("Sprint Running");
  });

  it("maps explicit merge_required attention to Merge state", () => {
    const result = getSprintStatusPresentation({
      state: "paused",
      attentionType: "merge_required",
    });

    expect(result.statusLabel).toBe("Merge");
    expect(result.title).toBe("Attempting Base Branch Merge");
  });

  it("maps sprint with active review status to QA state", () => {
    const result = getSprintStatusPresentation({
      state: "running",
      completion: 100,
      latestReviewStatus: "running",
    });
    expect(result.statusLabel).toBe("QA");
    expect(result.title).toBe("Sprint in QA Gate");
  });

  it("localizes active QA status without changing the underlying review field", () => {
    const result = getSprintStatusPresentation({
      state: "running",
      completion: 100,
      latestReviewStatus: "in_progress",
    }, "de");

    expect(result.statusLabel).toBe("QA");
    expect(result.title).toBe("Sprint in der QA-Prüfung");
  });

  it("keeps terminal lifecycle status authoritative over stale stage evidence", () => {
    const result = getSprintStatusPresentation({
      state: "completed",
      latestReviewStatus: "running",
      attentionType: "merge_required",
      completion: 100,
    });

    expect(result.statusLabel).toBe("Completed");
    expect(result.title).toBe("Sprint Completed");
  });

  it("maps merge conflicts without requesting human attention unless ownership is human", () => {
    const result1 = getSprintStatusPresentation({
      state: "paused",
      attentionType: "merge_conflict",
      humanInterventionOwnerType: "worker",
    });
    expect(result1.statusLabel).toBe("Merge Conflict");
    expect(result1.showHumanInterventionBadge).toBe(false);

    const result2 = getSprintStatusPresentation({
      state: "paused",
      pauseReason: "main_merge_blocked",
      humanInterventionOwnerType: "system",
    });
    expect(result2.statusLabel).toBe("Merge Conflict");
    expect(result2.showHumanInterventionBadge).toBe(false);

    const result3 = getSprintStatusPresentation({
      state: "paused",
      attentionType: "merge_conflict",
      humanInterventionOwnerType: "human",
    });
    expect(result3.statusLabel).toBe("Merge Conflict");
    expect(result3.showHumanInterventionBadge).toBe(true);
  });

  it("maps idle state to Draft", () => {
    const result = getSprintStatusPresentation({
      state: "idle",
    });
    expect(result.statusLabel).toBe("Draft");
  });

  it("localizes dashboard fallbacks without rewriting supplied server detail", () => {
    const result = getSprintStatusPresentation({
      state: "paused",
      pauseSource: "manual",
      humanInterventionReason: "Operator-authored reason",
    }, "de");

    expect(result.statusLabel).toBe("Pausiert");
    expect(result.title).toBe("Sprint für manuellen Eingriff pausiert");
    expect(result.reason).toBe("Operator-authored reason");
  });
});
