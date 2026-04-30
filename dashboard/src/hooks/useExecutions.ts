import { useCallback, useMemo, useRef } from "preact/hooks";
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

const executionCache = new Map<string, ExecutionDashboardSnapshot>();
const executionInflightRequests = new Map<string, Promise<ExecutionDashboardSnapshot>>();

export function useExecutions(projectId: string | null, pollIntervalMs: number = 30000): {
  data: ExecutionDashboardSnapshot;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const cachedSnapshot = projectId ? executionCache.get(projectId) || null : null;
  const projectCacheEntryRef = useRef<{ projectId: string | null; hadInitialCache: boolean }>({
    projectId: null,
    hadInitialCache: false,
  });

  if (projectCacheEntryRef.current.projectId !== projectId) {
    projectCacheEntryRef.current = {
      projectId,
      hadInitialCache: !!cachedSnapshot,
    };
  }

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return EMPTY_SNAPSHOT;
    }
    let request = executionInflightRequests.get(projectId);
    if (!request) {
      request = fetchProjectExecution(projectId, signal).finally(() => {
        executionInflightRequests.delete(projectId);
      });
      executionInflightRequests.set(projectId, request);
    }
    const nextSnapshot = await request;
    const cached = executionCache.get(projectId) || null;
    const stabilized = cached ? stabilizeExecutionSnapshot(cached, nextSnapshot) : nextSnapshot;
    executionCache.set(projectId, stabilized);
    return stabilized;
  }, [projectId]);

  const { data, loading, error, refetch } = useRealtimeResource<ExecutionDashboardSnapshot>({
    initialData: cachedSnapshot || EMPTY_SNAPSHOT,
    fetchResource,
    isEqual: areExecutionSnapshotsEquivalent,
    stabilizeNext: stabilizeExecutionSnapshot,
    realtime: projectId ? {
      scopes: [`project:${projectId}`],
      eventType: "project.execution.updated",
      updateDirectlyFromEvent: true,
    } : undefined,
    pollIntervalMs: projectId ? pollIntervalMs : 0,
    isAlreadyLoaded: projectCacheEntryRef.current.hadInitialCache || !projectId,
    refreshOnMount: false,
  });

  return useMemo(() => ({
    data,
    loading,
    error,
    refetch: () => refetch({ silent: true }),
  }), [data, loading, error, refetch]);
}
