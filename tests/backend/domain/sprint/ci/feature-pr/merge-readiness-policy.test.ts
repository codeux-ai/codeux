import { describe, it, expect } from "vitest";
import { evaluateMergeReadiness } from "../../../../../../src/domain/sprint/ci/feature-pr/merge-readiness-policy.js";

describe("evaluateMergeReadiness", () => {
  it("should be merge ready if all checks pass and no blockers", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "success" }];
    const result = evaluateMergeReadiness(checks, true, true, "APPROVED", 0);
    expect(result).toEqual({
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      isMergeReady: true,
    });
  });

  it("should detect failed checks", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "failure" }];
    const result = evaluateMergeReadiness(checks, true, true, "APPROVED", 0);
    expect(result.hasFailedChecks).toBe(true);
    expect(result.isMergeReady).toBe(false);
  });

  it("should detect pending checks", () => {
    const checks = [{ name: "test", status: "in_progress", conclusion: null }];
    const result = evaluateMergeReadiness(checks, true, true, "APPROVED", 0);
    expect(result.hasPendingChecks).toBe(true);
    expect(result.isMergeReady).toBe(false);
  });

  it("should detect review blockers (CHANGES_REQUESTED)", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "success" }];
    const result = evaluateMergeReadiness(checks, true, true, "CHANGES_REQUESTED", 0);
    expect(result.hasReviewBlockers).toBe(true);
    expect(result.isMergeReady).toBe(false);
  });

  it("should detect review blockers (approved PR with comments)", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "success" }];
    const result = evaluateMergeReadiness(checks, true, true, "APPROVED", 1);
    expect(result.hasReviewBlockers).toBe(true);
    expect(result.isMergeReady).toBe(false);
  });

  it("should ignore incidental comments when there is no review decision", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "success" }];
    const result = evaluateMergeReadiness(checks, true, true, null, 1);
    expect(result.hasReviewBlockers).toBe(false);
    expect(result.isMergeReady).toBe(true);
  });

  it("should ignore checks if waitForFeatureCi is false", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "failure" }];
    const result = evaluateMergeReadiness(checks, false, true, "APPROVED", 0);
    expect(result.hasFailedChecks).toBe(false);
    expect(result.isMergeReady).toBe(true);
  });

  it("should ignore review blockers if resolveAllCommentsBeforeFeatureMerge is false", () => {
    const checks = [{ name: "test", status: "completed", conclusion: "success" }];
    const result = evaluateMergeReadiness(checks, true, false, "CHANGES_REQUESTED", 1);
    expect(result.hasReviewBlockers).toBe(false);
    expect(result.isMergeReady).toBe(true);
  });
});
