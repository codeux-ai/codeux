import { useCallback, useEffect, useMemo, useReducer } from "preact/hooks";
import { computeStats, processDashboardTasks } from "../lib/status.js";
import { fetchLivePayload } from "../lib/api/dashboard-api.js";
import type {
  DashboardStatus,
  DashboardRealtimeServerMessage,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  ProjectLiveDashboardSnapshot,
} from "../types.js";
import { subscribeToDashboardRealtime, type TransportState } from "../lib/realtime/dashboard-realtime-client.js";

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

interface RuntimeState {
  snapshot: ProjectLiveDashboardSnapshot;
  error: string | null;
  initialLoadComplete: boolean;
  transportState: TransportState;
  isRecovering: boolean;
}

type RuntimeAction =
  | { type: "SET_LIVE_SNAPSHOT"; snapshot: ProjectLiveDashboardSnapshot }
  | { type: "SET_ERROR"; error: string }
  | { type: "SET_TRANSPORT_STATE"; state: TransportState }
  | { type: "SET_RECOVERING"; isRecovering: boolean };

const initialState: RuntimeState = {
  snapshot: EMPTY_LIVE_SNAPSHOT,
  error: null,
  initialLoadComplete: false,
  transportState: "disconnected",
  isRecovering: false,
};

function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case "SET_LIVE_SNAPSHOT":
      return {
        ...state,
        snapshot: action.snapshot,
        error: null,
        initialLoadComplete: true,
        isRecovering: false,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
        initialLoadComplete: true,
        isRecovering: false,
      };
    case "SET_TRANSPORT_STATE":
      return {
        ...state,
        transportState: action.state,
      };
    case "SET_RECOVERING":
      return {
        ...state,
        isRecovering: action.isRecovering,
      };
    default:
      return state;
  }
}

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

export const useDashboardRuntimeData = (projectIdHint: string | null = null): UseDashboardRuntimeDataResult => {
  const [state, dispatch] = useReducer(runtimeReducer, initialState);

  const refreshRuntimeStatusAction = useCallback(async (): Promise<void> => {
    dispatch({ type: "SET_RECOVERING", isRecovering: true });
    try {
      const snapshot = await fetchLivePayload(projectIdHint);
      dispatch({ type: "SET_LIVE_SNAPSHOT", snapshot });
    } catch (error) {
      dispatch({ type: "SET_ERROR", error: "Unable to connect to Orchestrator API" });
      throw error;
    }
  }, [projectIdHint]);

  useEffect(() => {
    void refreshRuntimeStatusAction();
  }, [refreshRuntimeStatusAction]);

  const realtimeProjectId = projectIdHint || state.snapshot.projectId || state.snapshot.status.project_id || null;

  useEffect(() => {
    if (!realtimeProjectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${realtimeProjectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && message.event.eventType === "project.live.updated") {
        dispatch({ type: "SET_LIVE_SNAPSHOT", snapshot: message.event.payload as ProjectLiveDashboardSnapshot });
        return;
      }

      if (message.type === "snapshot_required") {
        void refreshRuntimeStatusAction();
      }
    }, (transportState) => {
      dispatch({ type: "SET_TRANSPORT_STATE", state: transportState });
    });
  }, [realtimeProjectId, refreshRuntimeStatusAction]);

  const { tasksWithLiveActivities, stats } = useMemo(() => {
    const result = processDashboardTasks(state.snapshot.status.subtasks || []);
    return {
      tasksWithLiveActivities: result.tasks,
      stats: result.stats,
    };
  }, [state.snapshot.status.subtasks]);

  return {
    error: state.error,
    gitStatus: state.snapshot.gitStatus,
    gitStatusError: state.snapshot.gitStatusError,
    initialLoadComplete: state.initialLoadComplete,
    transportState: state.transportState,
    isRecovering: state.isRecovering,
    snapshotUpdatedAt: state.snapshot.updatedAt,
    refreshGitStatus: refreshRuntimeStatusAction,
    refreshRuntimeStatus: refreshRuntimeStatusAction,
    selectedSprintId: state.snapshot.selectedSprintId,
    status: state.snapshot.status,
    execution: state.snapshot.execution,
    stats,
    tasksWithLiveActivities,
  };
};
