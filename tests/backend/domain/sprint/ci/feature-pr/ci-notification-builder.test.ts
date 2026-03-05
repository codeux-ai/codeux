import { describe, it, expect } from "vitest";
import {
  buildNoPrFoundText,
  buildAutoMergeSuccessText,
  buildAutoMergeFailedText,
  buildMergeReadyText,
  buildInProgressText,
  buildFailedChecksText,
  buildReviewBlockersText
} from "../../../../../../src/domain/sprint/ci/feature-pr/ci-notification-builder.js";
import { GitCiRunStatus } from "../../../../../../src/contracts/app-types.js";

describe("ci-notification-builder", () => {
  it("buildNoPrFoundText", () => {
    const res = buildNoPrFoundText("T1", "feat-branch");
    expect(res).toContain("Task `T1` stays in progress because no open feature PR could be matched");
    expect(res).toContain("base `feat-branch`");
  });

  it("builds auto-merge success text", () => {
    const result = buildAutoMergeSuccessText("T1", 100);
    expect(result).toBe("🤖 **Auto-Merged:** Task `T1` was merged automatically (PR #100).\n");

    const resultWithMode = buildAutoMergeSuccessText("T1", 100, "always");
    expect(resultWithMode).toBe("🤖 **Auto-Merged:** Task `T1` was merged automatically (PR #100, mode: always).\n");
  });

  it("builds auto-merge failed text", () => {
    const result1 = buildAutoMergeFailedText("T1", 100, "conflict");
    expect(result1).toContain("Auto-Merge Failed");
    expect(result1).toContain("conflict");
    expect(result1).toContain("Manual check:");

    const result2 = buildAutoMergeFailedText("T1", 100, "conflict", "always");
    expect(result2).toContain("mode: always");
    expect(result2).not.toContain("Manual check:");
  });

  it("builds merge ready text", () => {
    const res = buildMergeReadyText("T1", 100, "feat-branch");
    expect(res).toContain("✅ **Feature PR Ready:** Task `T1` can be approved for merge into `feat-branch` (PR #100).");
  });

  it("builds in-progress text", () => {
    const result = buildInProgressText("T1", 100, "url", "branch", "pending", "Wait Header");
    expect(result).toContain("⏳ **Wait Header:** Task `T1` stays in progress (PR #100, branch `branch`)");
    expect(result).toContain("CI Status: `PENDING`");
  });

  it("builds failed checks text", () => {
    const failedRun: GitCiRunStatus = {
        id: 1, name: "run1", workflowName: "wf1", status: "completed", conclusion: "failure", event: "push", headBranch: "branch", url: "url1", updatedAt: "now"
    };

    const result = buildFailedChecksText("branch", ["lint", "test"], [failedRun], ["job1"]);
    expect(result).toContain("Failed checks: lint, test");
    expect(result).toContain("Failed runs:");
    expect(result).toContain("Failed run URLs: url1");
    expect(result).toContain("Failed jobs: job1");
    expect(result).toContain("Logs: `gh run list --branch branch --event pull_request --limit 5`");
  });

  it("buildReviewBlockersText", () => {
    const res = buildReviewBlockersText(100, "CHANGES_REQUESTED", 3);
    expect(res).toContain("reviewDecision=CHANGES_REQUESTED");
    expect(res).toContain("comments=3");

    const res2 = buildReviewBlockersText(100, null, 0);
    expect(res2).toContain("reviewDecision=NONE");
  });
});
