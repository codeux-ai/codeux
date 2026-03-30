import type { ProjectExecutionStatsChartSeries } from "../../../types.js";

/**
 * Builds the initial enabled state for a set of chart series based on a default list.
 * Guarantees that at least one series is enabled by falling back to the first available
 * series if the resulting selection would be empty.
 */
export function buildInitialSeriesState(
  series: ProjectExecutionStatsChartSeries[],
  defaultEnabled: string[]
): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  let hasEnabled = false;

  for (const s of series) {
    const isEnabled = defaultEnabled.includes(s.id);
    state[s.id] = isEnabled;
    if (isEnabled) {
      hasEnabled = true;
    }
  }

  // Fallback to the first available series if none are enabled
  if (!hasEnabled && series.length > 0) {
    state[series[0].id] = true;
  }

  return state;
}

/**
 * Reconciles the previously enabled series state with a refreshed list of series.
 * Drops state for missing series, adds new series as disabled by default,
 * and ensures at least one series remains enabled.
 */
export function reconcileSeriesState(
  series: ProjectExecutionStatsChartSeries[],
  previousState: Record<string, boolean>
): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  let hasEnabled = false;

  for (const s of series) {
    if (previousState[s.id] !== undefined) {
      state[s.id] = previousState[s.id];
    } else {
      // New series default to disabled
      state[s.id] = false;
    }

    if (state[s.id]) {
      hasEnabled = true;
    }
  }

  // Ensure at least one series remains enabled if there are any series
  if (!hasEnabled && series.length > 0) {
    state[series[0].id] = true;
  }

  return state;
}

export interface PartitionedSeries {
  activeGroups: Record<string, ProjectExecutionStatsChartSeries[]>;
  inactiveGroups: Record<string, ProjectExecutionStatsChartSeries[]>;
}

/**
 * Partitions the chart series into active and inactive groups based on the enabled state map,
 * while preserving the backend grouping order.
 */
export function partitionSeriesByStatus(
  series: ProjectExecutionStatsChartSeries[],
  enabledSeries: Record<string, boolean>
): PartitionedSeries {
  const activeGroups: Record<string, ProjectExecutionStatsChartSeries[]> = {};
  const inactiveGroups: Record<string, ProjectExecutionStatsChartSeries[]> = {};

  for (const s of series) {
    const isActive = enabledSeries[s.id] ?? false;

    if (isActive) {
      if (!activeGroups[s.grouping]) {
        activeGroups[s.grouping] = [];
      }
      activeGroups[s.grouping].push(s);
    } else {
      if (!inactiveGroups[s.grouping]) {
        inactiveGroups[s.grouping] = [];
      }
      inactiveGroups[s.grouping].push(s);
    }
  }

  return { activeGroups, inactiveGroups };
}
