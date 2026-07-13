import type { ExecutionInvocationRecord } from "../../contracts/invocation-types.js";

export interface PlanningInvocationMetrics {
  durationsMs: number[];
}

export const PLANNING_INVOCATION_SAMPLE_LIMIT = 10;

interface CompletedPlanningInvocationDuration {
  durationMs: number;
  startedAtMs: number;
}

/**
 * Selects usable durations from the most recently started completed planning
 * invocations. Callers do not need to rely on repository result ordering.
 */
export function selectRecentPlanningInvocationDurations(
  invocations: readonly ExecutionInvocationRecord[],
  limit: number = PLANNING_INVOCATION_SAMPLE_LIMIT
): number[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));

  return invocations
    .flatMap((invocation): CompletedPlanningInvocationDuration[] => {
      if (
        invocation.type !== "planning"
        || invocation.status !== "completed"
        || !invocation.finishedAt
      ) {
        return [];
      }

      const startedAtMs = Date.parse(invocation.startedAt);
      const finishedAtMs = Date.parse(invocation.finishedAt);
      if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
        return [];
      }

      return [{
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        startedAtMs,
      }];
    })
    .sort((left, right) => right.startedAtMs - left.startedAtMs)
    .slice(0, normalizedLimit)
    .map(({ durationMs }) => durationMs);
}

export function fetchProjectPlanningMetrics(
  listProjectInvocations: (projectId: string) => ExecutionInvocationRecord[],
  projectId: string,
  limit: number = PLANNING_INVOCATION_SAMPLE_LIMIT
): PlanningInvocationMetrics {
  const invocations = listProjectInvocations(projectId);
  return { durationsMs: selectRecentPlanningInvocationDurations(invocations, limit) };
}
