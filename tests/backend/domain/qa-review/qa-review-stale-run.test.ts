import { describe, expect, it } from "vitest";
import { resolveStaleRunningQaInvocationReason, QA_RUN_START_TIMEOUT_MS } from "../../../../src/domain/qa-review/qa-review-stale-run.js";
import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "../../../../src/domain/qa-review/qa-review-budget.js";
import type { ExecutionInvocationRecord } from "../../../../src/contracts/invocation-types.js";
import type { ProviderInvocationUsageRecord } from "../../../../src/contracts/execution-types.js";

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
});
