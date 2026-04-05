import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import type {
  DashboardRealtimeServerMessage,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { fetchProjectStats } from "../lib/project-api.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";

const EMPTY_STATS: ProjectExecutionStatsSnapshot | null = null;

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
  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return null;
    }
    return await fetchProjectStats(projectId, statsQuery, signal);
  }, [projectId, statsQuery]);

  const isEqual = useCallback((prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null) => {
    return JSON.stringify(prev) === JSON.stringify(next);
  }, []);

  const { data: stats, loading, error, refetch } = useRealtimeResource<ProjectExecutionStatsSnapshot | null>({
    initialData: EMPTY_STATS,
    fetchResource,
    isEqual,
    pollIntervalMs: projectId ? pollIntervalMs : 0,
    isAlreadyLoaded: false,
    realtime: projectId ? {
      scopes: [`project:${projectId}`],
      shouldRefetch: (message: DashboardRealtimeServerMessage) => {
        if (message.type === "snapshot_required") {
          return true;
        }
        if (message.type === "event" && (
          message.event.eventType === "project.execution.updated" ||
          message.event.eventType === "project.structure.updated"
        )) {
          return true;
        }
        return false;
      },
    } : undefined,
  });

  return useMemo(() => ({
    stats,
    loading,
    error,
    refresh: async () => {
      await refetch({ silent: true });
    },
  }), [error, loading, refetch, stats]);
}
