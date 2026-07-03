import { describe, expect, it } from "vitest";
import {
  buildSprintQaSnapshot,
  evaluateSprintQaReviewDecision,
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

  describe("evaluateSprintQaReviewDecision", () => {
    it.each([
      {
        name: "runs the initial review when no prior sprint QA run exists",
        latestRun: null,
        maxSprintReviewRuns: 3,
        shouldRunReview: true,
        expected: { action: "run_review", reason: "no_prior_review" },
      },
      {
        name: "skips after a completed passing review",
        latestRun: makeRun({ status: "completed", outcome: "pass", runIndex: 1 }),
        maxSprintReviewRuns: 3,
        shouldRunReview: false,
        expected: { action: "skip_review", reason: "already_passed" },
      },
      {
        name: "blocks completion when a failed review has no meaningful follow-up changes",
        latestRun: makeRun({ status: "failed", outcome: null, runIndex: 1 }),
        maxSprintReviewRuns: 3,
        shouldRunReview: false,
        expected: { action: "block_completion", reason: "awaiting_follow_up" },
      },
      {
        name: "runs again after a failed review when the sprint changed",
        latestRun: makeRun({ status: "failed", outcome: null, runIndex: 1 }),
        maxSprintReviewRuns: 3,
        shouldRunReview: true,
        expected: { action: "run_review", reason: "needs_review" },
      },
      {
        name: "skips when a completed changes-requested review exhausted the retry budget",
        latestRun: makeRun({ status: "completed", outcome: "changes_requested", runIndex: 1 }),
        maxSprintReviewRuns: 1,
        shouldRunReview: true,
        expected: { action: "skip_review", reason: "retry_budget_exhausted" },
      },
      {
        name: "keeps completion blocked while review is running",
        latestRun: makeRun({ status: "running", outcome: null, runIndex: 1 }),
        maxSprintReviewRuns: 3,
        shouldRunReview: true,
        expected: { action: "block_completion", reason: "review_running" },
      },
    ])("$name", ({ latestRun, maxSprintReviewRuns, shouldRunReview, expected }) => {
      expect(evaluateSprintQaReviewDecision({
        latestRun,
        maxSprintReviewRuns,
        shouldRunReview,
      })).toEqual(expected);
    });
  });
});
