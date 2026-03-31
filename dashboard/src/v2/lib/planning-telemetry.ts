import type { ProjectExecutionStatsSnapshot } from "../../types.js";

/**
 * Derives the estimated planning duration in milliseconds from historical project telemetry.
 * If no planning stats are available or valid, falls back to 180000 ms (3 minutes).
 */
export function derivePlanningETA(stats: ProjectExecutionStatsSnapshot | null): number {
  const FALLBACK_MS = 180000;

  if (!stats || !stats.purposes) {
    return FALLBACK_MS;
  }

  const planningStats = (stats?.purposes ?? []).find(p => p.purpose === "planning");
  if (!planningStats || !planningStats.usage) {
    return FALLBACK_MS;
  }

  const { invocationCount, activeTimeMs } = planningStats.usage;
  if (typeof invocationCount !== 'number' || typeof activeTimeMs !== 'number' || invocationCount <= 0) {
    return FALLBACK_MS;
  }

  const average = activeTimeMs / invocationCount;
  return average > 0 ? average : FALLBACK_MS;
}
