import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "./qa-review-budget.js";
import type { ExecutionInvocationRecord } from "../../contracts/invocation-types.js";
import type { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";

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
