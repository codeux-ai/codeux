import { useCallback, useMemo, useRef } from "preact/hooks";
import type {
  DashboardRealtimeServerMessage,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { fetchProjectStats } from "../lib/project-api.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";
import { isEqualProjectStatsSnapshot, stabilizeProjectStatsSnapshot } from "../lib/resource-equality.js";


const statsCache = new Map<string, ProjectExecutionStatsSnapshot>();
const statsInflightRequests = new Map<string, Promise<ProjectExecutionStatsSnapshot>>();

export const clearStatsCacheForTests = (): void => {
  statsCache.clear();
  statsInflightRequests.clear();
};

const getStatsKey = (projectId: string, query: ProjectStatsQuery | ProjectStatsWindow): string => {
  const q = typeof query === "string" ? { window: query } : query;
  return `${projectId}:${q.window || ""}:${q.from || ""}:${q.to || ""}`;
};

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
  const cachedStats = projectId ? statsCache.get(getStatsKey(projectId, statsQuery)) || null : null;
  const projectCacheEntryRef = useRef<{ projectId: string | null; queryKey: string; hadInitialCache: boolean }>({
    projectId: null,
    queryKey: "",
    hadInitialCache: false,
  });

  const queryKey = projectId ? getStatsKey(projectId, statsQuery) : "";
  if (projectCacheEntryRef.current.projectId !== projectId || projectCacheEntryRef.current.queryKey !== queryKey) {
    projectCacheEntryRef.current = {
      projectId,
      queryKey,
      hadInitialCache: !!cachedStats,
    };
  }

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return null;
    }
    const key = getStatsKey(projectId, statsQuery);
    let request = statsInflightRequests.get(key);
    if (!request) {
      request = fetchProjectStats(projectId, statsQuery, signal).finally(() => {
        statsInflightRequests.delete(key);
      });
      statsInflightRequests.set(key, request);
    }
    const resolvedStats = await request;
    const cached = statsCache.get(key) || null;
    const nextStats = isEqualProjectStatsSnapshot(cached, resolvedStats) ? cached : resolvedStats;
    if (nextStats) {
      statsCache.set(key, nextStats);
    }
    return nextStats;
  }, [projectId, statsQuery]);

  const { data: stats, loading, error, refetch } = useRealtimeResource<ProjectExecutionStatsSnapshot | null>({
    initialData: cachedStats,
    fetchResource,
    isEqual: isEqualProjectStatsSnapshot,
    stabilizeNext: stabilizeProjectStatsSnapshot,
    pollIntervalMs: projectId ? pollIntervalMs : 0,
    isAlreadyLoaded: projectCacheEntryRef.current.hadInitialCache || !projectId,
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

