import { useCallback, useMemo } from "preact/hooks";
import type { ExecutionDashboardSnapshot } from "../types.js";
import { fetchProjectExecution } from "../v2/lib/project-api.js";
import {
  areExecutionSnapshotsEquivalent,
  stabilizeExecutionSnapshot,
} from "../lib/runtime-snapshot-stability.js";
import { useRealtimeResource } from "./use-realtime-resource.js";

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
  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return EMPTY_SNAPSHOT;
    }
    return fetchProjectExecution(projectId, signal);
  }, [projectId]);

  const { data, loading, error, refetch } = useRealtimeResource<ExecutionDashboardSnapshot>({
    initialData: EMPTY_SNAPSHOT,
    fetchResource,
    isEqual: areExecutionSnapshotsEquivalent,
    stabilizeNext: stabilizeExecutionSnapshot,
    realtime: projectId ? {
      scopes: [`project:${projectId}`],
      eventType: "project.execution.updated",
      updateDirectlyFromEvent: true,
    } : undefined,
    pollIntervalMs: projectId ? pollIntervalMs : 0,
    isAlreadyLoaded: !projectId, // Skip loading state if no project
  });

  return useMemo(() => ({
    data,
    loading,
    error,
    refetch: () => refetch({ silent: true }),
  }), [data, loading, error, refetch]);
}
