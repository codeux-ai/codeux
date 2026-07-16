import { useCallback, useMemo, useState } from "preact/hooks";
import { computeStats, processDashboardTasks } from "../lib/status.js";
import { fetchLivePayload, getCachedLivePayload, type LivePayloadCacheOptions } from "../lib/api/dashboard-api.js";
import {
  areProjectLiveDashboardSnapshotsEquivalent,
  stabilizeProjectLiveDashboardSnapshot,
} from "../lib/runtime-snapshot-stability.js";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  ProjectLiveDashboardSnapshot,
} from "../types.js";
import type { TransportState } from "../lib/realtime/dashboard-realtime-client.js";
import { useRealtimeResource } from "./use-realtime-resource.js";

const EMPTY_STATUS: DashboardStatus = { subtasks: [], timestamp: null };
const EMPTY_EXECUTION: ExecutionDashboardSnapshot = {
  projectId: null,
  projectName: null,
  sprintRuns: [],
  taskDispatches: [],
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  sprintWorkflowProjections: [],
  recentEvents: [],
  recentInvocations: [],
  updatedAt: null,
};

const EMPTY_LIVE_SNAPSHOT: ProjectLiveDashboardSnapshot = {
  projectId: null,
  selectedSprintId: null,
  status: EMPTY_STATUS,
  execution: EMPTY_EXECUTION,
  gitStatus: null,
  gitStatusError: null,
  updatedAt: null,
};

export interface UseDashboardRuntimeDataResult {
  error: string | null;
  gitStatus: GitTrackingStatus | null;
  gitStatusError: string | null;
  initialLoadComplete: boolean;
  transportState: TransportState;
  isRecovering: boolean;
  snapshotUpdatedAt: string | null;
  refreshGitStatus: () => Promise<void>;
  refreshRuntimeStatus: () => Promise<void>;
  selectedSprintId: string | null;
  status: DashboardStatus;
  execution: ExecutionDashboardSnapshot;
  stats: ReturnType<typeof computeStats>;
  tasksWithLiveActivities: DashboardStatus["subtasks"];
}

interface DashboardRuntimeDataScope {
  selectedSprintId?: string | null;
}

const normalizeScopeId = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const hasSelectedSprintScope = (scope?: DashboardRuntimeDataScope): boolean => (
  !!scope && Object.prototype.hasOwnProperty.call(scope, "selectedSprintId")
);

const isSnapshotInRuntimeScope = (
  snapshot: ProjectLiveDashboardSnapshot,
  projectIdHint: string | null,
  scope?: DashboardRuntimeDataScope,
): boolean => {
  const expectedProjectId = normalizeScopeId(projectIdHint);
  const payloadProjectId = normalizeScopeId(snapshot.projectId || snapshot.status.project_id || snapshot.execution.projectId);
  if (expectedProjectId && payloadProjectId && expectedProjectId !== payloadProjectId) {
    return false;
  }
  if (!hasSelectedSprintScope(scope)) {
    return true;
  }
  return normalizeScopeId(snapshot.selectedSprintId) === normalizeScopeId(scope?.selectedSprintId);
};

const getEmptySnapshot = (
  projectIdHint: string | null,
  scope?: DashboardRuntimeDataScope,
): ProjectLiveDashboardSnapshot => ({
  ...EMPTY_LIVE_SNAPSHOT,
  projectId: projectIdHint,
  selectedSprintId: hasSelectedSprintScope(scope) ? scope?.selectedSprintId ?? null : null,
});

export const useDashboardRuntimeData = (
  projectIdHint: string | null = null,
  enabled = true,
  scope?: DashboardRuntimeDataScope,
): UseDashboardRuntimeDataResult => {
  const selectedSprintScopeKnown = hasSelectedSprintScope(scope);
  const selectedSprintScopeId = selectedSprintScopeKnown ? scope?.selectedSprintId ?? null : null;
  const runtimeScope = useMemo<DashboardRuntimeDataScope | undefined>(() => (
    selectedSprintScopeKnown ? { selectedSprintId: selectedSprintScopeId } : undefined
  ), [selectedSprintScopeId, selectedSprintScopeKnown]);
  const cacheOptions = useMemo<LivePayloadCacheOptions | undefined>(() => (
    selectedSprintScopeKnown ? { selectedSprintId: selectedSprintScopeId } : undefined
  ), [selectedSprintScopeId, selectedSprintScopeKnown]);

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) {
      return getEmptySnapshot(projectIdHint, runtimeScope);
    }
    try {
      // API currently doesn't accept signal, but could be added
      const snapshot = await fetchLivePayload(projectIdHint, cacheOptions);
      return isSnapshotInRuntimeScope(snapshot, projectIdHint, runtimeScope)
        ? snapshot
        : getEmptySnapshot(projectIdHint, runtimeScope);
    } catch (err) {
      throw new Error("Unable to connect to Orchestrator API");
    }
  }, [cacheOptions, enabled, projectIdHint, runtimeScope]);

  // Ignore assembly-only timestamps while preserving rendering changes in status,
  // execution, git, project, and selected-sprint scope.
  const isEqual = useCallback((prev: ProjectLiveDashboardSnapshot, next: ProjectLiveDashboardSnapshot) => {
    return areProjectLiveDashboardSnapshotsEquivalent(prev, next);
  }, []);

  const stabilizeNext = useCallback((prev: ProjectLiveDashboardSnapshot, next: ProjectLiveDashboardSnapshot) => {
    return stabilizeProjectLiveDashboardSnapshot(prev, next);
  }, []);

  // Use state to track the realtime project ID so it can be updated
  // when the snapshot is fetched and contains a different project ID
  const [fetchedProjectId, setFetchedProjectId] = useState<string | null>(null);

  const fetchResourceWithProjectExtraction = useCallback(async (signal?: AbortSignal) => {
    const data = await fetchResource(signal);
    const newId = data.projectId || data.status.project_id || null;
    if (newId) {
       setFetchedProjectId((prev) => prev !== newId ? newId : prev);
    }
    return data;
  }, [fetchResource]);

  const activeProjectId = projectIdHint || fetchedProjectId;

  const cachedData = getCachedLivePayload(projectIdHint, cacheOptions);
  const scopedCachedData = cachedData && isSnapshotInRuntimeScope(cachedData, projectIdHint, runtimeScope)
    ? cachedData
    : null;
  const initialData = useMemo(
    () => scopedCachedData || getEmptySnapshot(projectIdHint, runtimeScope),
    [projectIdHint, runtimeScope, scopedCachedData],
  );

  const {
    data: finalSnapshot,
    error: finalError,
    initialLoadComplete: finalInitialLoadComplete,
    transportState: finalTransportState,
    isRecovering: finalIsRecovering,
    refetch: finalRefetch,
  } = useRealtimeResource<ProjectLiveDashboardSnapshot>({
    initialData,
    fetchResource: fetchResourceWithProjectExtraction,
    isEqual,
    stabilizeNext,
    realtime: activeProjectId ? {
      // Dedicated sub-scope: the heavy live payload is delivered only here, so
      // pages on the plain `project:<id>` scope never receive these ~0.5MB frames.
      scopes: [`project:${activeProjectId}:live`],
      eventType: "project.live.updated",
      updateDirectlyFromEvent: true,
    } : undefined,
    isAlreadyLoaded: !enabled || !!scopedCachedData,
  });

  const { tasksWithLiveActivities, stats } = useMemo(() => {
    const result = processDashboardTasks(finalSnapshot.status.subtasks || []);
    return {
      tasksWithLiveActivities: result.tasks,
      stats: result.stats,
    };
  }, [finalSnapshot.status.subtasks]);

  const refreshRuntimeStatusAction = useCallback(async () => {
    await finalRefetch();
  }, [finalRefetch]);

  return {
    error: finalError,
    gitStatus: finalSnapshot.gitStatus,
    gitStatusError: finalSnapshot.gitStatusError,
    initialLoadComplete: finalInitialLoadComplete,
    transportState: finalTransportState,
    isRecovering: finalIsRecovering,
    snapshotUpdatedAt: finalSnapshot.updatedAt,
    refreshGitStatus: refreshRuntimeStatusAction,
    refreshRuntimeStatus: refreshRuntimeStatusAction,
    selectedSprintId: finalSnapshot.selectedSprintId,
    status: finalSnapshot.status,
    execution: finalSnapshot.execution,
    stats,
    tasksWithLiveActivities,
  };
};
