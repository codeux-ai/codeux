import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type {
  DashboardRealtimeServerMessage,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { fetchProjectStats } from "../lib/project-api.js";
import { areProjectStatsSnapshotsEqual } from "./project-resource-utils.js";
import { ProjectResourceStore } from "./project-resource-store.js";

const EMPTY_STATS: ProjectExecutionStatsSnapshot | null = null;

export const projectStatsStore = new ProjectResourceStore<ProjectExecutionStatsSnapshot | null>({
  resourceType: "stats",
  fetcher: async (projectId: string, args: { statsQuery: ProjectStatsQuery | ProjectStatsWindow }) => {
    return await fetchProjectStats(projectId, args.statsQuery);
  },
  isEqual: areProjectStatsSnapshotsEqual,
  emptyData: EMPTY_STATS,
  getRealtimeScopes: (projectId: string) => [`project:${projectId}`],
  shouldRefreshOnRealtimeEvent: (message: DashboardRealtimeServerMessage) => {
    if (message.type === "event" && (
      message.event.eventType === "project.execution.updated" ||
      message.event.eventType === "project.structure.updated"
    )) {
      return true;
    }
    if (message.type === "snapshot_required") {
      return true;
    }
    return false;
  },
});

export function useProjectStats(
  projectId: string | null,
  statsQuery: ProjectStatsQuery | ProjectStatsWindow,
  pollIntervalMs: number = 30000,
): {
  stats: ProjectExecutionStatsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [stats, setStats] = useState<ProjectExecutionStatsSnapshot | null>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const keySuffix = JSON.stringify(statsQuery);
    return projectStatsStore.subscribe(
      projectId,
      keySuffix,
      { statsQuery },
      (data, errorStr, isLoading) => {
        setStats(data);
        setError(errorStr);
        setLoading(isLoading);
      },
      pollIntervalMs
    );
  }, [projectId, pollIntervalMs, statsQuery]);

  const refresh = useCallback(async (): Promise<void> => {
    if (projectId) {
      const keySuffix = JSON.stringify(statsQuery);
      await projectStatsStore.fetch(projectId, keySuffix, { statsQuery }, { silent: true });
    }
  }, [projectId, statsQuery]);

  return useMemo(() => ({
    stats,
    loading,
    error,
    refresh,
  }), [error, loading, refresh, stats]);
}
