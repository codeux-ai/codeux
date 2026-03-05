import { describe, it, expect } from "vitest";
import { matchPrForTask } from "../../../../../../src/domain/sprint/ci/feature-pr/pr-matcher.js";
import type { GitTrackingStatus, Subtask } from "../../../../../../src/contracts/app-types.js";

describe("matchPrForTask", () => {
  it("should match by worker branch", () => {
    const task: Subtask = { worker_branch: "feat/T1" } as Subtask;
    const gitStatus: GitTrackingStatus = {
      openPullRequests: [{ headRefName: "feat/T1", number: 100 }],
    } as unknown as GitTrackingStatus;

    const pr = matchPrForTask(task, gitStatus);
    expect(pr).toBeDefined();
    expect(pr?.number).toBe(100);
  });

  it("should match by PR URL if branch not found", () => {
    const task: Subtask = { pr_url: "url1" } as Subtask;
    const gitStatus: GitTrackingStatus = {
      openPullRequests: [{ url: "url1", number: 101 }],
    } as unknown as GitTrackingStatus;

    const pr = matchPrForTask(task, gitStatus);
    expect(pr).toBeDefined();
    expect(pr?.number).toBe(101);
  });

  it("should return undefined if no match", () => {
    const task: Subtask = { worker_branch: "feat/T1" } as Subtask;
    const gitStatus: GitTrackingStatus = {
      openPullRequests: [{ headRefName: "other", number: 100 }],
    } as unknown as GitTrackingStatus;

    const pr = matchPrForTask(task, gitStatus);
    expect(pr).toBeUndefined();
  });
});
