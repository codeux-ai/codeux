import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { computeStats } from "../lib/status.js";
import { fetchGitTrackingStatus, fetchRuntimeDashboardPayload } from "../lib/api/dashboard-api.js";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  DashboardRealtimeServerMessage,
} from "../types.js";
import { DEFAULT_POLL_INTERVAL_MS, useDashboardPollManager } from "./use-dashboard-poll-manager.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";

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

  const refreshRuntimeStatusAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchRuntimeDashboardPayload();
      setStatus(data.status);
      setExecution(data.execution);
      setError(null);
    } catch (err) {
      setError("Unable to connect to Orchestrator API");
      throw err;
    }
  }, []);

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

  const unifiedPoll = useDashboardPollManager({
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    onPoll: [refreshRuntimeStatusAction, refreshGitStatusAction],
  });

  const realtimeProjectId = execution.projectId || status.project_id || null;

  useEffect(() => {
    if (!realtimeProjectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${realtimeProjectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && message.event.eventType === "project.execution.updated") {
        setExecution(message.event.payload as ExecutionDashboardSnapshot);
        setError(null);
        return;
      }

      if (message.type === "snapshot_required") {
        void refreshRuntimeStatusAction();
      }
    });
  }, [realtimeProjectId, refreshRuntimeStatusAction]);

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
