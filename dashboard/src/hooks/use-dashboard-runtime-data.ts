import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { computeStats, mergeLiveActivities } from "../lib/status.js";
import { fetchGitTrackingStatus, fetchRuntimeDashboardPayload } from "../lib/api/dashboard-api.js";
import type { DashboardStatus, GitTrackingStatus, LiveActivitiesResponse } from "../types.js";

const DEFAULT_POLL_INTERVAL_MS = 10000;

interface UseDashboardRuntimeDataResult {
  error: string | null;
  gitStatus: GitTrackingStatus | null;
  gitStatusError: string | null;
  refreshGitStatus: () => Promise<void>;
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

  const refreshRuntimeStatus = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchRuntimeDashboardPayload();
      setStatus(data.status);
      setLiveActivities((prev) => ({ ...prev, ...data.liveActivities }));
      setError(null);
    } catch {
      setError("Unable to connect to Orchestrator API");
    }
  }, []);

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchGitTrackingStatus();
      setGitStatus(data);
      setGitStatusError(null);
    } catch {
      setGitStatusError("Unable to load git/ci/pr tracking.");
    }
  }, []);

  useEffect(() => {
    void refreshRuntimeStatus();
    void refreshGitStatus();

    const runtimeIntervalId = window.setInterval(() => void refreshRuntimeStatus(), DEFAULT_POLL_INTERVAL_MS);
    const gitIntervalId = window.setInterval(() => void refreshGitStatus(), DEFAULT_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(runtimeIntervalId);
      window.clearInterval(gitIntervalId);
    };
  }, [refreshGitStatus, refreshRuntimeStatus]);

  const tasksWithLiveActivities = useMemo(() => {
    return mergeLiveActivities(status.subtasks || [], liveActivities);
  }, [status.subtasks, liveActivities]);

  const stats = useMemo(() => computeStats(tasksWithLiveActivities), [tasksWithLiveActivities]);

  return {
    error,
    gitStatus,
    gitStatusError,
    refreshGitStatus,
    status,
    stats,
    tasksWithLiveActivities,
  };
};
