import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ExecutionDashboardSnapshot } from "../../types.js";
import { fetchProjectExecution } from "../lib/project-api.js";

const EMPTY_SNAPSHOT: ExecutionDashboardSnapshot = {
  projectId: null,
  projectName: null,
  sprintRuns: [],
  taskDispatches: [],
  connections: [],
  recentEvents: [],
  updatedAt: null,
};

export function useProjectExecution(projectId: string | null, pollIntervalMs: number = 5000): {
  execution: ExecutionDashboardSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [execution, setExecution] = useState<ExecutionDashboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setExecution(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setExecution(await fetchProjectExecution(projectId));
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId || pollIntervalMs <= 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [projectId, pollIntervalMs, refresh]);

  return useMemo(() => ({
    execution,
    loading,
    error,
    refresh,
  }), [error, execution, loading, refresh]);
}
