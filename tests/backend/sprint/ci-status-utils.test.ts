import { describe, expect, it } from "vitest";
import { getFailedJobLabels, isCiFailure, isCiPending, selectFailedCiRuns, summarizeFailedRuns } from "../../../src/sprint/ci-status-utils.js";
import type { GitTrackingStatus } from "../../../src/contracts/app-types.js";

describe("ci-status-utils", () => {
  it("classifies check states", () => {
    expect(isCiFailure("completed", "failure")).toBe(true);
    expect(isCiFailure("completed", "success")).toBe(false);
    expect(isCiFailure("completed", "neutral")).toBe(false);
    expect(isCiFailure("completed", "skipped")).toBe(false);
    expect(isCiPending("queued", null)).toBe(true);
    expect(isCiPending("completed", null)).toBe(true);
    expect(isCiPending("completed", "success")).toBe(false);
  });

  it("selects branch-matched failed runs", () => {
    const status: GitTrackingStatus = {
      available: true,
      mode: "REMOTE",
      branch: "feature/test",
      openPullRequests: [],
      ciRuns: [
        { id: 1, name: "A", workflowName: "wf", status: "completed", conclusion: "failure", event: "pull_request", headBranch: "feature/test", url: "u1", updatedAt: null },
        { id: 2, name: "B", workflowName: "wf", status: "completed", conclusion: "failure", event: "pull_request", headBranch: "other", url: "u2", updatedAt: null },
      ],
      recentMerges: [],
      warnings: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/test" },
    };

    const runs = selectFailedCiRuns(status, "feature/test");
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(1);
  });

  it("summarizes failed jobs and runs", () => {
    const failedRuns = [
      {
        id: 22,
        name: "Build",
        workflowName: "CI",
        status: "completed",
        conclusion: "failure",
        event: "pull_request",
        headBranch: "feature/test",
        url: "u",
        updatedAt: null,
        failedJobs: [{ id: 7, name: "linux", conclusion: "failure", failedSteps: [], logExcerpt: null, logCommand: null }],
      },
    ];

    expect(getFailedJobLabels(failedRuns)).toEqual(["CI/linux"]);
    expect(summarizeFailedRuns(failedRuns)).toBe("CI#22");
  });
});
