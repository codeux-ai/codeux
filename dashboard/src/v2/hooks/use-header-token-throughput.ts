import { useCallback, useMemo, useRef } from "preact/hooks";
import type {
  DashboardRealtimeServerMessage,
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputWindow,
} from "../../types.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";
import { isDeepEqual } from "../lib/resource-equality.js";
import { fetchHeaderTokenThroughput } from "../lib/project-api.js";

const DEFAULT_HEADER_THROUGHPUT_POLL_MS = 5_000;

const throughputCache = new Map<string, HeaderTokenThroughputSnapshot>();
const throughputInflightRequests = new Map<string, Promise<HeaderTokenThroughputSnapshot>>();

export function clearHeaderTokenThroughputCacheForTests(): void {
  throughputCache.clear();
  throughputInflightRequests.clear();
}

function getThroughputKey(projectId: string | null, window: HeaderTokenThroughputWindow): string {
  return projectId?.trim() ? `project:${projectId.trim()}:${window}` : `app:${window}`;
}

export function useHeaderTokenThroughput(
  projectId: string | null,
  window: HeaderTokenThroughputWindow = "20s",
  pollIntervalMs: number = DEFAULT_HEADER_THROUGHPUT_POLL_MS,
): {
  snapshot: HeaderTokenThroughputSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const normalizedProjectId = projectId?.trim() || null;
  const cacheKey = getThroughputKey(normalizedProjectId, window);
  const cachedSnapshot = throughputCache.get(cacheKey) || null;
  const cacheEntryRef = useRef<{ cacheKey: string; hadInitialCache: boolean }>({
    cacheKey: "",
    hadInitialCache: false,
  });

  if (cacheEntryRef.current.cacheKey !== cacheKey) {
    cacheEntryRef.current = {
      cacheKey,
      hadInitialCache: Boolean(cachedSnapshot),
    };
  }

  const fetchResource = useCallback(async (signal?: AbortSignal): Promise<HeaderTokenThroughputSnapshot> => {
    const key = getThroughputKey(normalizedProjectId, window);
    let request = throughputInflightRequests.get(key);
    if (!request) {
      request = fetchHeaderTokenThroughput({ projectId: normalizedProjectId, window }, signal).finally(() => {
        throughputInflightRequests.delete(key);
      });
      throughputInflightRequests.set(key, request);
    }
    const snapshot = await request;
    const cached = throughputCache.get(key) || null;
    const nextSnapshot = cached && isDeepEqual(cached, snapshot) ? cached : snapshot;
    throughputCache.set(key, nextSnapshot);
    return nextSnapshot;
  }, [normalizedProjectId, window]);

  const realtimeScopes = useMemo(
    () => normalizedProjectId ? ["overview", `project:${normalizedProjectId}`] : ["overview"],
    [normalizedProjectId],
  );

  const { data, loading, error, refetch } = useRealtimeResource<HeaderTokenThroughputSnapshot | null>({
    initialData: cachedSnapshot,
    fetchResource,
    isEqual: isDeepEqual,
    pollIntervalMs,
    isAlreadyLoaded: cacheEntryRef.current.hadInitialCache,
    realtime: {
      scopes: realtimeScopes,
      shouldRefetch: (message: DashboardRealtimeServerMessage) => {
        if (message.type === "snapshot_required") {
          return true;
        }
        if (message.type !== "event") {
          return false;
        }
        return message.event.eventType === "overview.telemetry.updated"
          || message.event.eventType === "project.execution.updated";
      },
    },
  });

  return useMemo(() => ({
    snapshot: data,
    loading,
    error,
    refresh: async () => {
      await refetch({ silent: true });
    },
  }), [data, error, loading, refetch]);
}
