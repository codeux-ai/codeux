import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { computeStats } from "../lib/status.js";
import { fetchExecutionSnapshot, fetchGitTrackingStatus, fetchRuntimeStatus } from "../lib/api/dashboard-api.js";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  DashboardRealtimeServerMessage,
} from "../types.js";
import { useDashboardPollManager } from "./use-dashboard-poll-manager.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";

const RUNTIME_POLL_INTERVAL_MS = 5_000;
const GIT_STATUS_POLL_INTERVAL_MS = 30_000;
const REALTIME_GIT_REFRESH_DEBOUNCE_MS = 2_500;

interface UseDashboardRuntimeDataResult {
  error: string | null;
  gitStatus: GitTrackingStatus | null;
  gitStatusError: string | null;
  refreshGitStatus: () => Promise<void>;
  refreshRuntimeStatus: () => Promise<void>;
  status: DashboardStatus;
  execution: ExecutionDashboardSnapshot;
  stats: ReturnType<typeof computeStats>;
  tasksWithLiveActivities: DashboardStatus["subtasks"];
}

export const useDashboardRuntimeData = (): UseDashboardRuntimeDataResult => {
  const [status, setStatus] = useState<DashboardStatus>({ subtasks: [], timestamp: null });
  const [execution, setExecution] = useState<ExecutionDashboardSnapshot>({
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
  });
  const [error, setError] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitTrackingStatus | null>(null);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);
  const gitRefreshTimerRef = useRef<number | null>(null);

  const refreshStatusAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchRuntimeStatus();
      setStatus(data);
    } catch (err) {
      throw err;
    }
  }, []);

  const refreshExecutionAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchExecutionSnapshot();
      setExecution(data);
    } catch (err) {
      throw err;
    }
  }, []);

  const refreshRuntimeStatusAction = useCallback(async (): Promise<void> => {
    const [statusResult, executionResult] = await Promise.allSettled([
      refreshStatusAction(),
      refreshExecutionAction(),
    ]);

    if (statusResult.status === "fulfilled" || executionResult.status === "fulfilled") {
      setError(null);
      return;
    }

    setError("Unable to connect to Orchestrator API");
    throw (statusResult.reason || executionResult.reason || new Error("Unable to connect to Orchestrator API"));
  }, [refreshExecutionAction, refreshStatusAction]);

  const refreshGitStatusAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchGitTrackingStatus();
      setGitStatus(data);
      setGitStatusError(null);
    } catch (err) {
      setGitStatusError("Unable to load git/ci/pr tracking.");
      throw err;
    }
  }, []);

  const scheduleGitStatusRefresh = useCallback((delayMs: number = REALTIME_GIT_REFRESH_DEBOUNCE_MS): void => {
    if (gitRefreshTimerRef.current !== null) {
      return;
    }

    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = null;
      void refreshGitStatusAction().catch(() => undefined);
    }, Math.max(0, delayMs));
  }, [refreshGitStatusAction]);

  useDashboardPollManager({
    intervalMs: RUNTIME_POLL_INTERVAL_MS,
    onPoll: [refreshRuntimeStatusAction],
  });

  useDashboardPollManager({
    intervalMs: GIT_STATUS_POLL_INTERVAL_MS,
    onPoll: [refreshGitStatusAction],
  });

  const realtimeProjectId = execution.projectId || status.project_id || null;

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
        setExecution(message.event.payload as ExecutionDashboardSnapshot);
        setError(null);
        scheduleGitStatusRefresh();
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.runtime_status.updated") {
        setStatus(message.event.payload as DashboardStatus);
        setError(null);
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.structure.updated") {
        void refreshRuntimeStatusAction();
        scheduleGitStatusRefresh();
        return;
      }

      if (message.type === "snapshot_required") {
        void refreshRuntimeStatusAction();
        scheduleGitStatusRefresh(0);
      }
    });
  }, [realtimeProjectId, refreshRuntimeStatusAction, scheduleGitStatusRefresh]);

  const tasksWithLiveActivities = useMemo(() => status.subtasks || [], [status.subtasks]);

  const stats = useMemo(() => computeStats(tasksWithLiveActivities), [tasksWithLiveActivities]);

  return {
    error,
    gitStatus,
    gitStatusError,
    refreshGitStatus: refreshGitStatusAction,
    refreshRuntimeStatus: refreshRuntimeStatusAction,
    status,
    execution,
    stats,
    tasksWithLiveActivities,
  };
};
