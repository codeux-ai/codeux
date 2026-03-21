import { describe, expect, it } from "vitest";
import {
  isCompletedTaskAwaitingMerge,
  isCompletedTaskSettled,
} from "../../../../src/domain/sprint/task-merge-state.js";

describe("task merge state", () => {
  it("treats AUTOMERGE as a settled merge state", () => {
    const task = {
      status: "COMPLETED" as const,
      is_merged: false,
      merge_indicator: "AUTOMERGE" as const,
      worker_branch: "worker/task-1",
      pr_url: "https://example.com/pr/1",
    };

    expect(isCompletedTaskSettled(task)).toBe(true);
    expect(isCompletedTaskAwaitingMerge(task)).toBe(false);
  });
});
