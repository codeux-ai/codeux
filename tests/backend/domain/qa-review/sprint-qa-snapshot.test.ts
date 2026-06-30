import { describe, expect, it } from "vitest";
import {
  buildSprintQaSnapshot,
  readSprintQaSnapshot,
  shouldRunSprintQaReview,
} from "../../../../src/domain/qa-review/sprint-qa-snapshot.js";
import type { Subtask } from "../../../../src/contracts/app-types.js";
import type { QaReviewRunRecord } from "../../../../src/repositories/qa-review-repository.js";

function makeTask(id: string, title = "Task", status = "coding_completed"): Subtask {
  return {
    id,
    title,
    prompt: "Fix it",
    status,
    depends_on: [],
    is_merged: 0,
    merge_indicator: "",
  } as unknown as Subtask;
}

function makeRun(overrides?: Partial<QaReviewRunRecord>): QaReviewRunRecord {
  return {
    id: "run-1",
    payload: { taskSnapshot: null },
    finishedAt: new Date(1000).toISOString(),
    ...overrides,
  } as QaReviewRunRecord;
}

describe("Sprint QA Snapshot", () => {
  describe("buildSprintQaSnapshot", () => {
    it("serializes tasks deterministically", () => {
      const t1 = makeTask("t1", "Alpha");
      const t2 = makeTask("t2", "Beta");
      const snap1 = buildSprintQaSnapshot([t2, t1]);
      const snap2 = buildSprintQaSnapshot([t1, t2]);
      expect(snap1).toEqual(snap2);
      expect(JSON.parse(snap1)).toHaveLength(2);
    });
  });

  describe("readSprintQaSnapshot", () => {
    it("returns the snapshot string from payload", () => {
      const run = makeRun({ payload: { taskSnapshot: "foo" } });
      expect(readSprintQaSnapshot(run)).toBe("foo");
    });
    it("returns null when missing or empty", () => {
      expect(readSprintQaSnapshot(makeRun({ payload: { taskSnapshot: "   " } }))).toBe(null);
      expect(readSprintQaSnapshot(makeRun({ payload: {} }))).toBe(null);
      expect(readSprintQaSnapshot(null)).toBe(null);
    });
  });

  describe("shouldRunSprintQaReview", () => {
    it("returns true if latestRun is null", () => {
      expect(shouldRunSprintQaReview({
        latestRun: null,
        latestTaskUpdatedAtMs: 1000,
        currentSubtasks: [],
        isRecoveredStaleRun: false,
      })).toBe(true);
    });

    it("returns true if current task snapshot differs from latest snapshot", () => {
      const run = makeRun({ payload: { taskSnapshot: buildSprintQaSnapshot([makeTask("t1")]) } });
      expect(shouldRunSprintQaReview({
        latestRun: run,
        latestTaskUpdatedAtMs: 1000,
        currentSubtasks: [makeTask("t1", "New Title")],
        isRecoveredStaleRun: false,
      })).toBe(true);
    });

    it("returns false if current task snapshot matches latest snapshot", () => {
      const run = makeRun({ payload: { taskSnapshot: buildSprintQaSnapshot([makeTask("t1")]) } });
      expect(shouldRunSprintQaReview({
        latestRun: run,
        latestTaskUpdatedAtMs: 2000,
        currentSubtasks: [makeTask("t1")],
        isRecoveredStaleRun: false,
      })).toBe(false);
    });

    it("falls back to timestamp comparison if latest snapshot is missing", () => {
      const run = makeRun({ finishedAt: new Date(1000).toISOString(), payload: {} });
      expect(shouldRunSprintQaReview({
        latestRun: run,
        latestTaskUpdatedAtMs: 2000,
        currentSubtasks: [makeTask("t1")],
        isRecoveredStaleRun: false,
      })).toBe(true);

      expect(shouldRunSprintQaReview({
        latestRun: run,
        latestTaskUpdatedAtMs: 500,
        currentSubtasks: [makeTask("t1")],
        isRecoveredStaleRun: false,
      })).toBe(false);
    });

    it("returns true for missing snapshot if finishedAt is not finite", () => {
       const run = makeRun({ finishedAt: "invalid", payload: {} });
       expect(shouldRunSprintQaReview({
        latestRun: run,
        latestTaskUpdatedAtMs: 2000,
        currentSubtasks: [makeTask("t1")],
        isRecoveredStaleRun: false,
      })).toBe(true);
    });

    it("returns true if isRecoveredStaleRun is true, even if snapshot matches", () => {
      const run = makeRun({ payload: { taskSnapshot: buildSprintQaSnapshot([makeTask("t1")]) } });
      expect(shouldRunSprintQaReview({
        latestRun: run,
        latestTaskUpdatedAtMs: 2000,
        currentSubtasks: [makeTask("t1")],
        isRecoveredStaleRun: true,
      })).toBe(true);
    });
  });
});
