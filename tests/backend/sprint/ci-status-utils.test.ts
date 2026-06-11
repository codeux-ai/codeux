import { describe, expect, it } from "vitest";
import { deriveChecksFromCiRuns, getFailedJobLabels, isCiFailure, isCiPending, selectFailedCiRuns, summarizeFailedRuns } from "../../../src/sprint/ci-status-utils.js";
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

  it("derives check entries from the newest workflow run per workflow on the branch", () => {
    const status: GitTrackingStatus = {
      available: true,
      mode: "REMOTE",
      branch: "feature/test",
      openPullRequests: [],
      ciRuns: [
        { id: 3, name: "CI", workflowName: "CI", status: "completed", conclusion: "success", event: "pull_request", headBranch: "task/x", url: "u3", updatedAt: "2024-01-03T00:00:00Z" },
        { id: 2, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "pull_request", headBranch: "task/x", url: "u2", updatedAt: "2024-01-02T00:00:00Z" },
        { id: 1, name: "Lint", workflowName: "Lint", status: "in_progress", conclusion: null, event: "pull_request", headBranch: "task/x", url: "u1", updatedAt: "2024-01-01T00:00:00Z" },
        { id: 9, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "pull_request", headBranch: "other", url: "u9", updatedAt: "2024-01-09T00:00:00Z" },
      ],
      recentMerges: [],
      warnings: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/test" },
    };

    const checks = deriveChecksFromCiRuns(status, "task/x");
    expect(checks).toEqual([
      { name: "CI", status: "completed", conclusion: "success" },
      { name: "Lint", status: "in_progress", conclusion: null },
    ]);
    expect(deriveChecksFromCiRuns(status, null)).toEqual([]);
    expect(deriveChecksFromCiRuns(status, "unknown-branch")).toEqual([]);
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
