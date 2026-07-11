import { describe, expect, it } from "vitest";
import {
  calculateSprintProgress,
  calculateTaskProgress,
  type SprintProgressTask,
} from "../../../../src/domain/sprint/sprint-progress.js";

const task = (overrides: Partial<SprintProgressTask> = {}): SprintProgressTask => ({
  status: "pending",
  isMerged: false,
  mergeIndicator: null,
  toolCallCount: 0,
  ...overrides,
});

describe("sprint progress", () => {
  it("returns zero for a sprint without tasks", () => {
    expect(calculateSprintProgress([])).toBe(0);
  });

  it.each(["pending", "PENDING"] as const)(
    "keeps %s tasks at zero despite stale merge and coding metadata",
    (status) => {
      expect(calculateTaskProgress(task({
        status,
        isMerged: true,
        mergeIndicator: "CI",
        toolCallCount: 100,
      }))).toBe(0);
      expect(calculateTaskProgress(task({
        status,
        mergeIndicator: "MERGED",
        toolCallCount: 100,
      }))).toBe(0);
    },
  );

  it.each(["in_progress", "RUNNING"] as const)(
    "uses only coding telemetry for %s tasks with stale merge metadata",
    (status) => {
      expect(calculateTaskProgress(task({
        status,
        isMerged: true,
        mergeIndicator: "CI",
        toolCallCount: 13,
      }))).toBe(0.065);
      expect(calculateTaskProgress(task({
        status,
        mergeIndicator: "MERGED",
        toolCallCount: 13,
      }))).toBe(0.065);
    },
  );

  it("caps unfinished coding progress at 100 tool calls", () => {
    expect(calculateTaskProgress(task({ status: "in_progress", toolCallCount: 100 }))).toBe(0.5);
    expect(calculateTaskProgress(task({ status: "RUNNING", toolCallCount: 150 }))).toBe(0.5);
  });

  it("ignores negative and invalid coding tool-call counts", () => {
    expect(calculateTaskProgress(task({ status: "in_progress", toolCallCount: -10 }))).toBe(0);
    expect(calculateTaskProgress(task({ status: "RUNNING", toolCallCount: 2.5 }))).toBe(0);
    expect(calculateTaskProgress(task({ status: "RUNNING", toolCallCount: Number.NaN }))).toBe(0);
    expect(calculateTaskProgress(task({ status: "RUNNING", toolCallCount: Number.POSITIVE_INFINITY }))).toBe(0);
  });

  it("keeps coding-completed tasks at half progress", () => {
    expect(calculateTaskProgress(task({ status: "coding_completed", toolCallCount: 100 }))).toBe(0.5);
    expect(calculateTaskProgress(task({ status: "CODING_COMPLETED" }))).toBe(0.5);
  });

  it.each(["CI", "QA_PENDING", "MERGE_BLOCKED", "MERGE_CONFLICT"] as const)(
    "treats the %s gate as post-coding progress",
    (mergeIndicator) => {
      expect(calculateTaskProgress(task({ status: "coding_completed", mergeIndicator }))).toBe(0.75);
    },
  );

  it("jumps directly to full progress when no CI or merge gate is required", () => {
    expect(calculateTaskProgress(task({ status: "completed" }))).toBe(1);
    expect(calculateTaskProgress(task({ status: "COMPLETED" }))).toBe(1);
  });

  it.each(["MERGED", "AUTOMERGE", "PR_ONLY"] as const)(
    "treats the settled %s merge indicator as full progress",
    (mergeIndicator) => {
      expect(calculateTaskProgress(task({ status: "coding_completed", mergeIndicator }))).toBe(1);
    },
  );

  it("treats an explicit merged state as full progress after coding", () => {
    expect(calculateTaskProgress(task({ status: "coding_completed", isMerged: true }))).toBe(1);
  });

  it("averages mixed task weights and rounds to one decimal percentage point", () => {
    expect(calculateSprintProgress([
      task({ status: "pending" }),
      task({ status: "in_progress", toolCallCount: 13 }),
      task({ status: "coding_completed" }),
      task({ status: "coding_completed", mergeIndicator: "CI" }),
      task({ status: "completed" }),
    ])).toBe(46.3);
  });
});
