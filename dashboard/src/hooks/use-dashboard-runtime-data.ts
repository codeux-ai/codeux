import { useCallback, useMemo, useState } from "preact/hooks";
import { isDeepEqual } from "../v2/lib/resource-equality.js";
import { computeStats, processDashboardTasks } from "../lib/status.js";
import { fetchLivePayload, getCachedLivePayload } from "../lib/api/dashboard-api.js";
import {
  areExecutionSnapshotsEquivalent,
  areStatusSnapshotsEquivalent,
  stabilizeExecutionSnapshot,
  stabilizeStatusSnapshot,
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

export const useDashboardRuntimeData = (projectIdHint: string | null = null, enabled = true): UseDashboardRuntimeDataResult => {
  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) {
      return {
        ...EMPTY_LIVE_SNAPSHOT,
        projectId: projectIdHint,
      };
    }
    try {
      // API currently doesn't accept signal, but could be added
      return await fetchLivePayload(projectIdHint);
    } catch (err) {
      throw new Error("Unable to connect to Orchestrator API");
    }
  }, [enabled, projectIdHint]);

  const isEqual = useCallback((prev: ProjectLiveDashboardSnapshot, next: ProjectLiveDashboardSnapshot) => {
    return (
      prev.projectId === next.projectId
      && prev.selectedSprintId === next.selectedSprintId
      && areStatusSnapshotsEquivalent(prev.status, next.status)
      && areExecutionSnapshotsEquivalent(prev.execution, next.execution)
      && isDeepEqual(prev.gitStatus, next.gitStatus)
      && prev.gitStatusError === next.gitStatusError
    );
  }, []);

  const stabilizeSnapshot = useCallback((
    prev: ProjectLiveDashboardSnapshot,
    next: ProjectLiveDashboardSnapshot,
  ): ProjectLiveDashboardSnapshot => {
    const execution = stabilizeExecutionSnapshot(prev.execution, next.execution);
    const status = stabilizeStatusSnapshot(prev.status, next.status, execution);

    if (execution === next.execution && status === next.status) {
      return next;
    }

    return {
      ...next,
      status,
      execution,
    };
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

  const cachedData = getCachedLivePayload(projectIdHint);
  const initialData = useMemo(() => cachedData || {
    ...EMPTY_LIVE_SNAPSHOT,
    projectId: projectIdHint,
  }, [projectIdHint, cachedData]);

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
    stabilizeNext: stabilizeSnapshot,
    realtime: activeProjectId ? {
      // Dedicated sub-scope: the heavy live payload is delivered only here, so
      // pages on the plain `project:<id>` scope never receive these ~0.5MB frames.
      scopes: [`project:${activeProjectId}:live`],
      eventType: "project.live.updated",
      updateDirectlyFromEvent: true,
    } : undefined,
    isAlreadyLoaded: !enabled || !!cachedData,
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
