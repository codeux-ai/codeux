import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  DashboardRealtimeServerMessage,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { fetchProjectStats } from "../lib/project-api.js";

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
  const [stats, setStats] = useState<ProjectExecutionStatsSnapshot | null>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshInternal = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    if (!projectId) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setStats(null);
      setError(null);
      setLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    const isForeground = !options?.silent && !hasLoadedRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    if (isForeground) {
      setLoading(true);
    }
    try {
      setStats(await fetchProjectStats(projectId, statsQuery, abortController.signal));
      if (abortControllerRef.current === abortController) {
        hasLoadedRef.current = true;
        setError(null);
      }
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return;
      }
      if (abortControllerRef.current === abortController) {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    } finally {
      if (isForeground && abortControllerRef.current === abortController) {
        setLoading(false);
      }
    }
  }, [projectId, statsQuery]);

  useEffect(() => {
    hasLoadedRef.current = false;
    void refreshInternal();
  }, [refreshInternal]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const unsubsribe = subscribeToDashboardRealtime([`project:${projectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && (
        message.event.eventType === "project.execution.updated"
        || message.event.eventType === "project.structure.updated"
      )) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
          void refreshInternal({ silent: true });
        }, 500);
        return;
      }

      if (message.type === "snapshot_required") {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
          void refreshInternal({ silent: true });
        }, 500);
      }
    });

    return () => {
      unsubsribe();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [projectId, refreshInternal]);

  useEffect(() => {
    if (!projectId || pollIntervalMs <= 0) {
      return;
    }
    const intervalId = globalThis.window.setInterval(() => {
      void refreshInternal({ silent: true });
    }, pollIntervalMs);
    return () => globalThis.window.clearInterval(intervalId);
  }, [pollIntervalMs, projectId, refreshInternal]);

  return useMemo(() => ({
    stats,
    loading,
    error,
    refresh: () => refreshInternal({ silent: true }),
  }), [error, loading, refreshInternal, stats]);
}
