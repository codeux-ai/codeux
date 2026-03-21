import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { DashboardRealtimeServerMessage, ProjectExecutionStatsSnapshot, ProjectStatsWindow } from "../../types.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { fetchProjectStats } from "../lib/project-api.js";

const EMPTY_STATS: ProjectExecutionStatsSnapshot | null = null;

export function useProjectStats(projectId: string | null, statsWindow: ProjectStatsWindow, pollIntervalMs: number = 30000): {
  stats: ProjectExecutionStatsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [stats, setStats] = useState<ProjectExecutionStatsSnapshot | null>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setStats(await fetchProjectStats(projectId, statsWindow));
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [projectId, statsWindow]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${projectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && (
        message.event.eventType === "project.execution.updated"
        || message.event.eventType === "project.structure.updated"
      )) {
        void refresh();
        return;
      }

      if (message.type === "snapshot_required") {
        void refresh();
      }
    });
  }, [projectId, refresh]);

  useEffect(() => {
    if (!projectId || pollIntervalMs <= 0) {
      return;
    }
    const intervalId = globalThis.window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => globalThis.window.clearInterval(intervalId);
  }, [pollIntervalMs, projectId, refresh]);

  return useMemo(() => ({
    stats,
    loading,
    error,
    refresh,
  }), [error, loading, refresh, stats]);
}
