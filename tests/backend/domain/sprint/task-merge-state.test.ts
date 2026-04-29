import { describe, expect, it } from "vitest";
import {
  evaluatePreCiGateTransition,
  isCompletedTaskAwaitingMerge,
  isCompletedTaskSettled,
  normalizeTaskMergeIndicator,
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

  it("treats PR_ONLY as a settled merge state", () => {
    const task = {
      status: "COMPLETED" as const,
      is_merged: false,
      merge_indicator: "PR_ONLY" as const,
      worker_branch: "worker/task-1",
      pr_url: "https://example.com/pr/1",
    };

    expect(isCompletedTaskSettled(task)).toBe(true);
    expect(isCompletedTaskAwaitingMerge(task)).toBe(false);
  });

  it("preserves MERGE_CONFLICT indicator when task is not merged", () => {
    const mergeIndicator = normalizeTaskMergeIndicator({
      is_merged: false,
      merge_indicator: "MERGE_CONFLICT",
      worker_branch: "worker/task-2",
      pr_url: "https://example.com/pr/2",
    });

    expect(mergeIndicator).toBe("MERGE_CONFLICT");
  });

  it("clears merge indicator for tasks with no merge evidence", () => {
    const transition = evaluatePreCiGateTransition({
      status: "COMPLETED",
      is_merged: false,
      merge_indicator: "CI",
      worker_branch: undefined,
      pr_url: undefined,
      intervention_owner: "AGENT",
      intervention_hint: "waiting",
    });

    expect(transition.status).toBe("COMPLETED");
    expect(transition.merge_indicator).toBeUndefined();
    expect(transition.intervention_owner).toBeUndefined();
    expect(transition.intervention_hint).toBeUndefined();
  });

  it("moves completed tasks with merge evidence back to CODING_COMPLETED", () => {
    const transition = evaluatePreCiGateTransition({
      status: "COMPLETED",
      is_merged: false,
      merge_indicator: "CI",
      worker_branch: "worker/task-3",
      pr_url: undefined,
      intervention_owner: "AGENT",
      intervention_hint: "fix",
    });

    expect(transition.status).toBe("CODING_COMPLETED");
    expect(transition.merge_indicator).toBe("CI");
    expect(transition.intervention_owner).toBeUndefined();
    expect(transition.intervention_hint).toBeUndefined();
  });

  it("keeps merged tasks completed and normalizes indicator to MERGED", () => {
    const transition = evaluatePreCiGateTransition({
      status: "CODING_COMPLETED",
      is_merged: true,
      merge_indicator: "CI",
      worker_branch: "worker/task-4",
      pr_url: "https://example.com/pr/4",
      intervention_owner: "AGENT",
      intervention_hint: "check",
    });

    expect(transition.status).toBe("COMPLETED");
    expect(transition.merge_indicator).toBe("MERGED");
    expect(transition.intervention_owner).toBeUndefined();
    expect(transition.intervention_hint).toBeUndefined();
  });
});
