import { useCallback, useMemo, useState } from "preact/hooks";
import { computeStats, mergeLiveActivities } from "../lib/status.js";
import { fetchGitTrackingStatus, fetchRuntimeDashboardPayload } from "../lib/api/dashboard-api.js";
import type { DashboardStatus, GitTrackingStatus, LiveActivitiesResponse } from "../types.js";
import { useDashboardPollManager } from "./use-dashboard-poll-manager.js";

const DEFAULT_POLL_INTERVAL_MS = 10000;

interface UseDashboardRuntimeDataResult {
  error: string | null;
  gitStatus: GitTrackingStatus | null;
  gitStatusError: string | null;
  refreshGitStatus: () => Promise<void>;
  refreshRuntimeStatus: () => Promise<void>;
  status: DashboardStatus;
  stats: ReturnType<typeof computeStats>;
  tasksWithLiveActivities: DashboardStatus["subtasks"];
}

export const useDashboardRuntimeData = (): UseDashboardRuntimeDataResult => {
  const [status, setStatus] = useState<DashboardStatus>({ subtasks: [], timestamp: null });
  const [error, setError] = useState<string | null>(null);
  const [liveActivities, setLiveActivities] = useState<Record<string, LiveActivitiesResponse["activitiesBySession"][string]>>({});
  const [gitStatus, setGitStatus] = useState<GitTrackingStatus | null>(null);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);

  const refreshRuntimeStatusAction = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchRuntimeDashboardPayload();
      setStatus(data.status);
      setLiveActivities((prev) => ({ ...prev, ...data.liveActivities }));
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

  const runtimePoll = useDashboardPollManager({
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    onPoll: refreshRuntimeStatusAction,
  });

  const gitPoll = useDashboardPollManager({
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    onPoll: refreshGitStatusAction,
  });

  const tasksWithLiveActivities = useMemo(() => {
    return mergeLiveActivities(status.subtasks || [], liveActivities);
  }, [status.subtasks, liveActivities]);

  const stats = useMemo(() => computeStats(tasksWithLiveActivities), [tasksWithLiveActivities]);

  return {
    error,
    gitStatus,
    gitStatusError,
    refreshGitStatus: gitPoll.refreshNow,
    refreshRuntimeStatus: runtimePoll.refreshNow,
    status,
    stats,
    tasksWithLiveActivities,
  };
};
