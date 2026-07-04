import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "./qa-review-budget.js";
import type { ExecutionInvocationRecord } from "../../contracts/invocation-types.js";
import type { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import type { QaReviewRunRecord } from "../../repositories/qa-review-repository.js";

export const QA_RUN_START_TIMEOUT_MS = 60_000;

export interface ResolveStaleRunningQaInvocationArgs {
  invocation: ExecutionInvocationRecord;
  activeContainerSessionIds?: ReadonlySet<string>;
  providerInvocation: ProviderInvocationUsageRecord | null;
  now?: number;
}

export function resolveStaleRunningQaInvocationReason(
  args: ResolveStaleRunningQaInvocationArgs
): string | null {
  const { invocation, activeContainerSessionIds, providerInvocation } = args;
  const now = args.now ?? Date.now();

  if (invocation.status !== "running" && invocation.status !== "paused") {
    return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${invocation.status}. Code UX will retry the review.`;
  }

  const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
  const ageMs = Number.isFinite(referenceAt) ? now - referenceAt : 0;

  if (!providerInvocation) {
    if (ageMs < QA_RUN_START_TIMEOUT_MS) {
      return null;
    }
    return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation stayed running without provider runtime linkage. Code UX will retry the review.`;
  }

  if (providerInvocation.status !== "running") {
    return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation ${providerInvocation.status}. Code UX will retry the review.`;
  }

  if (
    providerInvocation.executionMode === "DOCKER"
    && activeContainerSessionIds
    && !activeContainerSessionIds.has(providerInvocation.sessionId)
  ) {
    return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after its Docker container disappeared for session ${providerInvocation.sessionId}. Code UX will retry the review.`;
  }

  return null;
}

export type RunningQaRunRecoveryDecision =
  | { action: "keep_running" }
  | {
      action: "recover_as_cancelled";
      summaryMarkdown: string;
      finishedAt: string;
      shouldCancelExecutionInvocation: boolean;
      shouldCancelProviderInvocation: boolean;
    };

export interface ResolveRunningQaRunRecoveryDecisionArgs {
  run: QaReviewRunRecord;
  latestInvocation: ExecutionInvocationRecord | null;
  providerInvocation: ProviderInvocationUsageRecord | null;
  activeContainerSessionIds?: ReadonlySet<string>;
  now?: Date;
}

export function resolveRunningQaRunRecoveryDecision(
  args: ResolveRunningQaRunRecoveryDecisionArgs,
): RunningQaRunRecoveryDecision {
  if (args.run.status !== "running") {
    return { action: "keep_running" };
  }

  const now = args.now ?? new Date();
  const latestInvocation = args.latestInvocation;

  if (latestInvocation) {
    const staleRunningInvocationReason = resolveStaleRunningQaInvocationReason({
      invocation: latestInvocation,
      activeContainerSessionIds: args.activeContainerSessionIds,
      providerInvocation: args.providerInvocation,
      now: now.getTime(),
    });

    const invocationStillActive = latestInvocation.status === "running" || latestInvocation.status === "paused";
    if (invocationStillActive && !staleRunningInvocationReason) {
      return { action: "keep_running" };
    }

    const summaryMarkdown = staleRunningInvocationReason
      || `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${latestInvocation.status}. Code UX will retry the review.`;

    return {
      action: "recover_as_cancelled",
      summaryMarkdown,
      finishedAt: latestInvocation.finishedAt || now.toISOString(),
      shouldCancelExecutionInvocation: invocationStillActive,
      shouldCancelProviderInvocation: invocationStillActive && args.providerInvocation?.status === "running",
    };
  }

  const runStartedAtMs = Date.parse(args.run.startedAt);
  const ageMs = Number.isFinite(runStartedAtMs) ? now.getTime() - runStartedAtMs : 0;
  if (ageMs < QA_RUN_START_TIMEOUT_MS) {
    return { action: "keep_running" };
  }

  return {
    action: "recover_as_cancelled",
    summaryMarkdown: `${RECOVERED_STALE_QA_SUMMARY_PREFIX} that never started its backing invocation. Code UX will retry the review.`,
    finishedAt: now.toISOString(),
    shouldCancelExecutionInvocation: false,
    shouldCancelProviderInvocation: false,
  };
}
