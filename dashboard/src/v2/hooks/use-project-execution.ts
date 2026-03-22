import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ExecutionDashboardSnapshot, DashboardRealtimeServerMessage } from "../../types.js";
import { fetchProjectExecution } from "../lib/project-api.js";
import { areExecutionSnapshotsEqual } from "./project-resource-utils.js";
import { ProjectResourceStore } from "./project-resource-store.js";

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

export const projectExecutionStore = new ProjectResourceStore<ExecutionDashboardSnapshot>({
  resourceType: "execution",
  fetcher: async (projectId: string) => {
    return await fetchProjectExecution(projectId);
  },
  isEqual: areExecutionSnapshotsEqual,
  emptyData: EMPTY_SNAPSHOT,
  getRealtimeScopes: (projectId: string) => [`project:${projectId}`],
  shouldRefreshOnRealtimeEvent: (message: DashboardRealtimeServerMessage) => {
    if (message.type === "event" && message.event.eventType === "project.execution.updated") {
      return true; // The store itself will re-fetch.
    }
    if (message.type === "snapshot_required") {
      return true;
    }
    return false;
  },
});

export function useProjectExecution(projectId: string | null, pollIntervalMs: number = 30000): {
  execution: ExecutionDashboardSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [execution, setExecution] = useState<ExecutionDashboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return projectExecutionStore.subscribe(
      projectId,
      "",
      null,
      (data, errorStr, isLoading) => {
        setExecution(data);
        setError(errorStr);
        setLoading(isLoading);
      },
      pollIntervalMs
    );
  }, [projectId, pollIntervalMs]);

  // Note: previously the websocket listener passed payload directly.
  // With shared store, it fetches. If we wanted to update cache directly, we'd need store API support,
  // but shared store re-fetches to deduplicate and ensure consistency anyway.
  // We can enhance the store in the future to accept push updates.

  const refresh = useCallback(async (): Promise<void> => {
    if (projectId) {
      await projectExecutionStore.fetch(projectId, "", null, { silent: true });
    }
  }, [projectId]);

  return useMemo(() => ({
    execution,
    loading,
    error,
    refresh,
  }), [error, execution, loading, refresh]);
}
