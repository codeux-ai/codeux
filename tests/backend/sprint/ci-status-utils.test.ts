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

  it("does not attach a failed run from another branch", () => {
    const status = {
      ciRuns: [
        { id: 2, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "push", headBranch: "other", url: "unrelated", updatedAt: "2026-01-01T00:00:02Z" },
      ],
    } as GitTrackingStatus;

    expect(selectFailedCiRuns(status, "task/x")).toEqual([]);
  });

  it("does not attach a historical failure after a newer branch run succeeds", () => {
    const status = {
      ciRuns: [
        { id: 1, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "push", headBranch: "task/x", url: "old", updatedAt: "2026-07-12T08:21:37Z" },
        { id: 2, name: "CI", workflowName: "CI", status: "completed", conclusion: "success", event: "push", headBranch: "task/x", url: "new", updatedAt: "2026-07-12T08:28:47Z" },
      ],
    } as GitTrackingStatus;

    expect(selectFailedCiRuns(status, "task/x")).toEqual([]);
  });

  it("selects only the newest failed run after ordering and duplicate suppression", () => {
    const status = {
      ciRuns: [
        { id: 3, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "pull_request", headBranch: "task/x", headSha: "abc", url: "u3", updatedAt: "2026-01-01T00:00:03Z" },
        { id: 2, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "push", headBranch: "task/x", headSha: "abc", url: "u2", updatedAt: "2026-01-01T00:00:02Z" },
        { id: 1, name: "Lint", workflowName: "Lint", status: "completed", conclusion: "failure", event: "push", headBranch: "task/x", headSha: "abc", url: "u1", updatedAt: "2026-01-01T00:00:01Z" },
        { id: 4, name: "E2E", workflowName: "E2E", status: "completed", conclusion: "failure", event: "push", headBranch: "task/x", headSha: "abc", url: "u4", updatedAt: "2026-01-01T00:00:00Z" },
      ],
    } as GitTrackingStatus;

    expect(selectFailedCiRuns(status, "task/x").map((run) => run.id)).toEqual([3]);
  });

  it("orders unsorted failures and keeps every failed job from only the newest run", () => {
    const status = {
      ciRuns: [
        { id: 10, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "push", headBranch: "task/x", url: "old", updatedAt: "2026-01-01T00:00:01Z", failedJobs: [] },
        { id: 12, name: "CI", workflowName: "CI", status: "completed", conclusion: "failure", event: "pull_request", headBranch: "task/x", url: "new", updatedAt: "2026-01-01T00:00:03Z", failedJobs: [
          { id: 1, name: "linux", conclusion: "failure", failedSteps: ["test"], logExcerpt: "first assertion", logCommand: "log-1" },
          { id: 2, name: "windows", conclusion: "failure", failedSteps: ["build"], logExcerpt: "second error", logCommand: "log-2" },
        ] },
        { id: 11, name: "Lint", workflowName: "Lint", status: "completed", conclusion: "failure", event: "push", headBranch: "task/x", url: "middle", updatedAt: "2026-01-01T00:00:02Z", failedJobs: [] },
      ],
    } as GitTrackingStatus;

    const selected = selectFailedCiRuns(status, "task/x");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      id: 12,
      failedJobs: [
        { id: 1, logExcerpt: "first assertion" },
        { id: 2, logExcerpt: "second error" },
      ],
    });
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
