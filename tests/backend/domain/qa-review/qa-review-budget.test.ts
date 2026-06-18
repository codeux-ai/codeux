import { describe, expect, it } from "vitest";
import {
  evaluateQaReviewBudget,
  isRecoveredStaleQaRun,
  shouldVerifyContinuedQaFix,
  RECOVERED_STALE_QA_SUMMARY_PREFIX,
  QA_INFRA_FAILURE_GRACE,
} from "../../../../src/domain/qa-review/qa-review-budget.js";
import type { QaReviewRunRecord } from "../../../../src/repositories/qa-review-repository.js";

function makeRun(overrides: Partial<QaReviewRunRecord>): QaReviewRunRecord {
  return {
    id: "run-1",
    projectId: "p1",
    status: "completed",
    runIndex: 1,
    ...overrides,
  } as QaReviewRunRecord;
}

describe("QA Review Budget", () => {
  describe("isRecoveredStaleQaRun", () => {
    it("returns true when summary matches the prefix", () => {
      expect(isRecoveredStaleQaRun(makeRun({ summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} because timeout` }))).toBe(true);
    });
    it("returns false for unrelated summary", () => {
      expect(isRecoveredStaleQaRun(makeRun({ summaryMarkdown: "Standard review failed" }))).toBe(false);
    });
    it("returns false for null run", () => {
      expect(isRecoveredStaleQaRun(null)).toBe(false);
    });
  });

  describe("shouldVerifyContinuedQaFix", () => {
    it("returns true when status is completed, outcome is changes_requested, and continued is true", () => {
      expect(shouldVerifyContinuedQaFix(makeRun({
        status: "completed",
        outcome: "changes_requested",
        payload: { continued: true },
      }))).toBe(true);
    });
    it("returns false if continued is not true", () => {
      expect(shouldVerifyContinuedQaFix(makeRun({
        status: "completed",
        outcome: "changes_requested",
        payload: { continued: false },
      }))).toBe(false);
    });
    it("returns false if outcome is not changes_requested", () => {
      expect(shouldVerifyContinuedQaFix(makeRun({
        status: "completed",
        outcome: "pass",
        payload: { continued: true },
      }))).toBe(false);
    });
  });

  describe("evaluateQaReviewBudget", () => {
    it("rejects immediately if QA is disabled (maxTaskReviewRuns <= 0)", () => {
      const result = evaluateQaReviewBudget({
        existingRuns: 0,
        decisiveRuns: 0,
        maxTaskReviewRuns: 0,
        latestRun: null,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("qa_disabled");
    });

    it("allows run if decisive and existing runs are below limits", () => {
      const result = evaluateQaReviewBudget({
        existingRuns: 1,
        decisiveRuns: 1,
        maxTaskReviewRuns: 2,
        latestRun: makeRun({ outcome: "changes_requested" }),
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("within_budget");
    });

    it("allows run if infra grace limit is not reached and decisive limit not reached", () => {
      const maxRuns = 1;
      const result = evaluateQaReviewBudget({
        existingRuns: maxRuns + QA_INFRA_FAILURE_GRACE - 1, // e.g. 1 + 3 - 1 = 3 runs
        decisiveRuns: 0,
        maxTaskReviewRuns: maxRuns,
        latestRun: makeRun({ status: "failed" }),
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("within_budget");
    });

    it("rejects run if infra grace limit is exhausted", () => {
      const maxRuns = 1;
      const result = evaluateQaReviewBudget({
        existingRuns: maxRuns + QA_INFRA_FAILURE_GRACE,
        decisiveRuns: 0,
        maxTaskReviewRuns: maxRuns,
        latestRun: makeRun({ status: "failed" }),
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("infra_grace_exhausted");
    });

    it("rejects run if decisive runs budget is exhausted", () => {
      const result = evaluateQaReviewBudget({
        existingRuns: 2,
        decisiveRuns: 2,
        maxTaskReviewRuns: 2,
        latestRun: makeRun({ status: "completed", outcome: "changes_requested" }),
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("budget_exhausted");
    });

    it("allows run post-continuation even if budget is exhausted", () => {
      const result = evaluateQaReviewBudget({
        existingRuns: 2,
        decisiveRuns: 2,
        maxTaskReviewRuns: 2,
        latestRun: makeRun({
          status: "completed",
          outcome: "changes_requested",
          payload: { continued: true },
        }),
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allow_post_continuation_verification");
    });

    it("allows run for recovered stale retry even if budget is exhausted", () => {
      const result = evaluateQaReviewBudget({
        existingRuns: 2,
        decisiveRuns: 2,
        maxTaskReviewRuns: 2,
        latestRun: makeRun({
          summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} recovered`,
        }),
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allow_recovered_stale_retry");
    });
  });
});
