import { describe, expect, it } from "vitest";
import {
  QA_RUN_START_TIMEOUT_MS,
  resolveRunningQaRunRecoveryDecision,
  resolveStaleRunningQaInvocationReason,
} from "../../../../src/domain/qa-review/qa-review-stale-run.js";
import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "../../../../src/domain/qa-review/qa-review-budget.js";
import type { ExecutionInvocationRecord } from "../../../../src/contracts/invocation-types.js";
import type { ProviderInvocationUsageRecord } from "../../../../src/contracts/execution-types.js";
import type { QaReviewRunRecord } from "../../../../src/repositories/qa-review-repository.js";

function makeRun(overrides: Partial<QaReviewRunRecord> = {}): QaReviewRunRecord {
  return {
    id: "qa-run-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintRunId: "sprint-run-1",
    taskId: "task-1",
    taskRunId: "task-run-1",
    triggerType: "task_completion",
    status: "running",
    outcome: null,
    runIndex: 1,
    agentPresetId: null,
    agentName: null,
    targetTaskKey: null,
    targetSessionId: null,
    targetProvider: null,
    summaryMarkdown: null,
    fixInstructions: null,
    payload: null,
    startedAt: "2026-06-01T00:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("qa-review-stale-run", () => {
  it("returns reason when invocation is not running or paused", () => {
    const reason = resolveStaleRunningQaInvocationReason({
      invocation: { status: "completed", startedAt: new Date().toISOString() } as ExecutionInvocationRecord,
      providerInvocation: null,
      now: Date.now(),
    });
    expect(reason).toBe(`${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation completed. Code UX will retry the review.`);
  });

  it("returns null if no provider invocation and age is under timeout", () => {
    const now = Date.now();
    const reason = resolveStaleRunningQaInvocationReason({
      invocation: { status: "running", startedAt: new Date(now - QA_RUN_START_TIMEOUT_MS / 2).toISOString() } as ExecutionInvocationRecord,
      providerInvocation: null,
      now,
    });
    expect(reason).toBeNull();
  });

  it("returns reason if no provider invocation and age is over timeout", () => {
    const now = Date.now();
    const reason = resolveStaleRunningQaInvocationReason({
      invocation: { status: "running", startedAt: new Date(now - QA_RUN_START_TIMEOUT_MS * 2).toISOString() } as ExecutionInvocationRecord,
      providerInvocation: null,
      now,
    });
    expect(reason).toBe(`${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation stayed running without provider runtime linkage. Code UX will retry the review.`);
  });

  it("returns reason if provider invocation is not running", () => {
    const reason = resolveStaleRunningQaInvocationReason({
      invocation: { status: "running", startedAt: new Date().toISOString() } as ExecutionInvocationRecord,
      providerInvocation: { status: "failed" } as ProviderInvocationUsageRecord,
      now: Date.now(),
    });
    expect(reason).toBe(`${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation failed. Code UX will retry the review.`);
  });

  it("returns reason if docker container disappeared", () => {
    const activeIds = new Set(["other-session"]);
    const reason = resolveStaleRunningQaInvocationReason({
      invocation: { status: "running", startedAt: new Date().toISOString() } as ExecutionInvocationRecord,
      providerInvocation: { status: "running", executionMode: "DOCKER", sessionId: "my-session" } as ProviderInvocationUsageRecord,
      activeContainerSessionIds: activeIds,
      now: Date.now(),
    });
    expect(reason).toBe(`${RECOVERED_STALE_QA_SUMMARY_PREFIX} after its Docker container disappeared for session my-session. Code UX will retry the review.`);
  });

  it("returns null if provider invocation is running and docker container is present", () => {
    const activeIds = new Set(["my-session"]);
    const reason = resolveStaleRunningQaInvocationReason({
      invocation: { status: "running", startedAt: new Date().toISOString() } as ExecutionInvocationRecord,
      providerInvocation: { status: "running", executionMode: "DOCKER", sessionId: "my-session" } as ProviderInvocationUsageRecord,
      activeContainerSessionIds: activeIds,
      now: Date.now(),
    });
    expect(reason).toBeNull();
  });

  describe("resolveRunningQaRunRecoveryDecision", () => {
    it.each([
      {
        name: "keeps a recent run when no backing invocation has started yet",
        run: makeRun({ startedAt: "2026-06-01T00:00:30.000Z" }),
        latestInvocation: null,
        providerInvocation: null,
        now: new Date("2026-06-01T00:01:00.000Z"),
        expected: { action: "keep_running" },
      },
      {
        name: "recovers a run whose backing invocation completed",
        run: makeRun(),
        latestInvocation: {
          id: "inv-1",
          status: "completed",
          startedAt: "2026-06-01T00:00:01.000Z",
          finishedAt: "2026-06-01T00:02:00.000Z",
        } as ExecutionInvocationRecord,
        providerInvocation: null,
        now: new Date("2026-06-01T00:03:00.000Z"),
        expected: {
          action: "recover_as_cancelled",
          summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation completed. Code UX will retry the review.`,
          finishedAt: "2026-06-01T00:02:00.000Z",
          shouldCancelExecutionInvocation: false,
          shouldCancelProviderInvocation: false,
        },
      },
      {
        name: "recovers stale provider linkage when a running invocation never linked runtime",
        run: makeRun(),
        latestInvocation: {
          id: "inv-1",
          status: "running",
          startedAt: "2026-06-01T00:00:01.000Z",
        } as ExecutionInvocationRecord,
        providerInvocation: null,
        now: new Date("2026-06-01T00:02:10.000Z"),
        expected: {
          action: "recover_as_cancelled",
          summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation stayed running without provider runtime linkage. Code UX will retry the review.`,
          finishedAt: "2026-06-01T00:02:10.000Z",
          shouldCancelExecutionInvocation: true,
          shouldCancelProviderInvocation: false,
        },
      },
      {
        name: "recovers a Docker provider invocation when its container is missing",
        run: makeRun(),
        latestInvocation: {
          id: "inv-1",
          status: "running",
          startedAt: "2026-06-01T00:00:01.000Z",
        } as ExecutionInvocationRecord,
        providerInvocation: {
          id: "provider-1",
          status: "running",
          executionMode: "DOCKER",
          sessionId: "qa-session",
        } as ProviderInvocationUsageRecord,
        activeContainerSessionIds: new Set(["other-session"]),
        now: new Date("2026-06-01T00:00:30.000Z"),
        expected: {
          action: "recover_as_cancelled",
          summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after its Docker container disappeared for session qa-session. Code UX will retry the review.`,
          finishedAt: "2026-06-01T00:00:30.000Z",
          shouldCancelExecutionInvocation: true,
          shouldCancelProviderInvocation: true,
        },
      },
      {
        name: "recovers an old run that never created a backing invocation",
        run: makeRun({ startedAt: "2026-06-01T00:00:00.000Z" }),
        latestInvocation: null,
        providerInvocation: null,
        now: new Date("2026-06-01T00:02:00.000Z"),
        expected: {
          action: "recover_as_cancelled",
          summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} that never started its backing invocation. Code UX will retry the review.`,
          finishedAt: "2026-06-01T00:02:00.000Z",
          shouldCancelExecutionInvocation: false,
          shouldCancelProviderInvocation: false,
        },
      },
    ])("$name", ({ run, latestInvocation, providerInvocation, activeContainerSessionIds, now, expected }) => {
      expect(resolveRunningQaRunRecoveryDecision({
        run,
        latestInvocation,
        providerInvocation,
        activeContainerSessionIds,
        now,
      })).toEqual(expected);
    });
  });
});
