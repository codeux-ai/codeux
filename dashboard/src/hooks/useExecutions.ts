import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ExecutionDashboardSnapshot, DashboardRealtimeServerMessage } from "../types.js";
import { fetchProjectExecution } from "../v2/lib/project-api.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";
import {
  areExecutionSnapshotsEquivalent,
  stabilizeExecutionSnapshot,
} from "../lib/runtime-snapshot-stability.js";

const EMPTY_SNAPSHOT: ExecutionDashboardSnapshot = {
  projectId: null,
  projectName: null,
  sprintRuns: [],
  taskDispatches: [],
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  recentEvents: [],
  updatedAt: null,
};

export function useExecutions(projectId: string | null, pollIntervalMs: number = 30000): {
  data: ExecutionDashboardSnapshot;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<ExecutionDashboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshInternal = useCallback(async (options?: { silent?: boolean; signal?: AbortSignal }): Promise<void> => {
    if (!projectId) {
      setData(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    // Only show foreground loading on the very first fetch.
    // Subsequent polls/realtime refreshes update data silently
    // so the UI never flashes skeleton rows.
    const isForeground = !options?.silent && !hasLoadedRef.current;
    if (isForeground) {
      setLoading(true);
    }
    try {
      const next = await fetchProjectExecution(projectId, options?.signal);
      if (!options?.signal?.aborted) {
        setData((prev) => {
          const stabilized = stabilizeExecutionSnapshot(prev, next);
          return areExecutionSnapshotsEquivalent(prev, stabilized) ? prev : stabilized;
        });
        hasLoadedRef.current = true;
        setError(null);
      }
    } catch (fetchError: any) {
      if (fetchError.name === "AbortError") return;
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (isForeground && !options?.signal?.aborted) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    hasLoadedRef.current = false;
    const controller = new AbortController();
    void refreshInternal({ signal: controller.signal });
    return () => controller.abort();
  }, [refreshInternal]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${projectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && message.event.eventType === "project.execution.updated") {
        const next = message.event.payload as ExecutionDashboardSnapshot;
        setData((prev) => {
          const stabilized = stabilizeExecutionSnapshot(prev, next);
          return areExecutionSnapshotsEquivalent(prev, stabilized) ? prev : stabilized;
        });
        setError(null);
        return;
      }

      if (message.type === "snapshot_required") {
        void refreshInternal({ silent: true });
      }
    });
  }, [projectId, refreshInternal]);

  useEffect(() => {
    if (!projectId || pollIntervalMs <= 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshInternal({ silent: true });
    }, pollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [projectId, pollIntervalMs, refreshInternal]);

  return useMemo(() => ({
    data,
    loading,
    error,
    refetch: () => refreshInternal({ silent: true }),
  }), [error, data, loading, refreshInternal]);
}
