import { useCallback, useEffect, useMemo, useReducer, useRef } from "preact/hooks";
import { computeStats, processDashboardTasks } from "../lib/status.js";
import { fetchGitTrackingStatus, fetchLivePayload } from "../lib/api/dashboard-api.js";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  DashboardRealtimeServerMessage,
} from "../types.js";
import { useDashboardPollManager } from "./use-dashboard-poll-manager.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";
import {
  areExecutionSnapshotsEquivalent,
  stabilizeExecutionSnapshot,
  stabilizeStatusSnapshot,
} from "../lib/runtime-snapshot-stability.js";

const RUNTIME_POLL_INTERVAL_MS = 5_000;
const GIT_STATUS_POLL_INTERVAL_MS = 30_000;
const REALTIME_GIT_REFRESH_DEBOUNCE_MS = 2_500;

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

/* ── Reducer for atomic state updates ───────────────────────────────────── */

interface RuntimeState {
  status: DashboardStatus;
  execution: ExecutionDashboardSnapshot;
  error: string | null;
  initialLoadComplete: boolean;
}

type RuntimeAction =
  | { type: "SET_LIVE_PAYLOAD"; status: DashboardStatus; execution: ExecutionDashboardSnapshot }
  | { type: "SET_STATUS"; status: DashboardStatus }
  | { type: "SET_EXECUTION"; execution: ExecutionDashboardSnapshot }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" };

const initialState: RuntimeState = {
  status: EMPTY_STATUS,
  execution: EMPTY_EXECUTION,
  error: null,
  initialLoadComplete: false,
};

function areStatusSnapshotsEquivalent(left: DashboardStatus, right: DashboardStatus): boolean {
  if (
    left.timestamp !== right.timestamp
    || left.project_id !== right.project_id
    || left.sprint_id !== right.sprint_id
    || left.feature_branch !== right.feature_branch
    || left.reportText !== right.reportText
    || left.instructions !== right.instructions
    || left.subtasks.length !== right.subtasks.length
  ) {
    return false;
  }

  for (let index = 0; index < left.subtasks.length; index += 1) {
    const leftTask = left.subtasks[index];
    const rightTask = right.subtasks[index];
    if (
      leftTask.record_id !== rightTask.record_id
      || leftTask.id !== rightTask.id
      || leftTask.status !== rightTask.status
      || leftTask.session_id !== rightTask.session_id
      || leftTask.worker_branch !== rightTask.worker_branch
      || leftTask.merge_indicator !== rightTask.merge_indicator
      || leftTask.is_merged !== rightTask.is_merged
    ) {
      return false;
    }
  }

  return true;
}

function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case "SET_LIVE_PAYLOAD": {
      const executionCandidate = stabilizeExecutionSnapshot(state.execution, action.execution);
      const nextExecution = areExecutionSnapshotsEquivalent(state.execution, executionCandidate) ? state.execution : executionCandidate;
      const statusCandidate = stabilizeStatusSnapshot(state.status, action.status, nextExecution);
      const nextStatus = areStatusSnapshotsEquivalent(state.status, statusCandidate) ? state.status : statusCandidate;
      if (nextStatus === state.status && nextExecution === state.execution && state.error === null && state.initialLoadComplete) {
        return state;
      }
      return { ...state, status: nextStatus, execution: nextExecution, error: null, initialLoadComplete: true };
    }

    case "SET_STATUS": {
      const statusCandidate = stabilizeStatusSnapshot(state.status, action.status, state.execution);
      const nextStatus = areStatusSnapshotsEquivalent(state.status, statusCandidate) ? state.status : statusCandidate;
      if (nextStatus === state.status && state.error === null) return state;
      return { ...state, status: nextStatus, error: null };
    }

    case "SET_EXECUTION": {
      const executionCandidate = stabilizeExecutionSnapshot(state.execution, action.execution);
      const nextExecution = areExecutionSnapshotsEquivalent(state.execution, executionCandidate) ? state.execution : executionCandidate;
      if (nextExecution === state.execution && state.error === null) return state;
      return { ...state, execution: nextExecution, error: null };
    }

    case "SET_ERROR":
      return { ...state, error: action.error, initialLoadComplete: true };

    case "CLEAR_ERROR":
      if (state.error === null) return state;
      return { ...state, error: null };

    default:
      return state;
  }
}

/* ── Hook ───────────────────────────────────────────────────────────────── */

export interface UseDashboardRuntimeDataResult {
  error: string | null;
  gitStatus: GitTrackingStatus | null;
  gitStatusError: string | null;
  initialLoadComplete: boolean;
  refreshGitStatus: () => Promise<void>;
  refreshRuntimeStatus: () => Promise<void>;
  status: DashboardStatus;
  execution: ExecutionDashboardSnapshot;
  stats: ReturnType<typeof computeStats>;
  tasksWithLiveActivities: DashboardStatus["subtasks"];
}

export const useDashboardRuntimeData = (projectIdHint: string | null = null): UseDashboardRuntimeDataResult => {
  const [state, dispatch] = useReducer(runtimeReducer, initialState);
  const [gitState, dispatchGit] = useReducer(
    (prev: { gitStatus: GitTrackingStatus | null; gitStatusError: string | null }, action: { gitStatus?: GitTrackingStatus; gitStatusError?: string | null }) => {
      const next = { ...prev, ...action };
      if (next.gitStatus === prev.gitStatus && next.gitStatusError === prev.gitStatusError) return prev;
      return next;
    },
    { gitStatus: null, gitStatusError: null },
  );

  const gitRefreshTimerRef = useRef<number | null>(null);
  const lastRealtimeEventAtRef = useRef<number>(0);

  const refreshRuntimeStatusAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchLivePayload();
      dispatch({ type: "SET_LIVE_PAYLOAD", status: data.status, execution: data.execution });
      return;
    } catch (error) {
      dispatch({ type: "SET_ERROR", error: "Unable to connect to Orchestrator API" });
      throw error;
    }
  }, []);

  const refreshGitStatusAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchGitTrackingStatus();
      dispatchGit({ gitStatus: data, gitStatusError: null });
    } catch (err) {
      dispatchGit({ gitStatusError: "Unable to load git/ci/pr tracking." });
      throw err;
    }
  }, []);

  const scheduleGitStatusRefresh = useCallback((delayMs: number = REALTIME_GIT_REFRESH_DEBOUNCE_MS): void => {
    if (gitRefreshTimerRef.current !== null) {
      // If delay is 0 (immediate), cancel existing timer and reschedule
      if (delayMs === 0) {
        window.clearTimeout(gitRefreshTimerRef.current);
        gitRefreshTimerRef.current = null;
      } else {
        return;
      }
    }

    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = null;
      void refreshGitStatusAction().catch(() => undefined);
    }, Math.max(0, delayMs));
  }, [refreshGitStatusAction]);

  const shouldSkipPoll = useCallback(() => {
    return Date.now() - lastRealtimeEventAtRef.current < RUNTIME_POLL_INTERVAL_MS;
  }, []);

  useDashboardPollManager({
    intervalMs: RUNTIME_POLL_INTERVAL_MS,
    onPoll: [refreshRuntimeStatusAction],
    shouldSkip: shouldSkipPoll,
  });

  useDashboardPollManager({
    intervalMs: GIT_STATUS_POLL_INTERVAL_MS,
    onPoll: [refreshGitStatusAction],
  });

  const realtimeProjectId = projectIdHint || state.execution.projectId || state.status.project_id || null;

  useEffect(() => {
    return () => {
      if (gitRefreshTimerRef.current !== null) {
        window.clearTimeout(gitRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!realtimeProjectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${realtimeProjectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && message.event.eventType === "project.execution.updated") {
        lastRealtimeEventAtRef.current = Date.now();
        dispatch({ type: "SET_EXECUTION", execution: message.event.payload as ExecutionDashboardSnapshot });
        scheduleGitStatusRefresh();
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.runtime_status.updated") {
        lastRealtimeEventAtRef.current = Date.now();
        dispatch({ type: "SET_STATUS", status: message.event.payload as DashboardStatus });
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.structure.updated") {
        lastRealtimeEventAtRef.current = Date.now();
        void refreshRuntimeStatusAction();
        scheduleGitStatusRefresh();
        return;
      }

      if (message.type === "snapshot_required") {
        void refreshRuntimeStatusAction();
        scheduleGitStatusRefresh(0);
      }
    });
  }, [projectIdHint, realtimeProjectId, refreshRuntimeStatusAction, scheduleGitStatusRefresh]);

  const { tasksWithLiveActivities, stats } = useMemo(() => {
    const result = processDashboardTasks(state.status.subtasks || []);
    return {
      tasksWithLiveActivities: result.tasks,
      stats: result.stats,
    };
  }, [state.status.subtasks]);

  return {
    error: state.error,
    gitStatus: gitState.gitStatus,
    gitStatusError: gitState.gitStatusError,
    initialLoadComplete: state.initialLoadComplete,
    refreshGitStatus: refreshGitStatusAction,
    refreshRuntimeStatus: refreshRuntimeStatusAction,
    status: state.status,
    execution: state.execution,
    stats,
    tasksWithLiveActivities,
  };
};
