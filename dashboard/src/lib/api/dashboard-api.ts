import type {
  DashboardSettings,
  DashboardStatus,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  LiveActivitiesResponse,
} from "../../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return (await response.json()) as T;
};

export interface RuntimeDashboardPayload {
  status: DashboardStatus;
  liveActivities: LiveActivitiesResponse["activitiesBySession"];
  execution: ExecutionDashboardSnapshot;
}

export const fetchRuntimeDashboardPayload = async (): Promise<RuntimeDashboardPayload> => {
  const [status, liveActivitiesResponse, execution] = await Promise.all([
    fetchJson<DashboardStatus>("/api/status"),
    fetchJson<LiveActivitiesResponse>("/api/live-activities"),
    fetchJson<ExecutionDashboardSnapshot>("/api/execution"),
  ]);

  return {
    status,
    liveActivities: liveActivitiesResponse.activitiesBySession || {},
    execution,
  };
};

export const fetchGitTrackingStatus = async (): Promise<GitTrackingStatus> => {
  return fetchJson<GitTrackingStatus>("/api/git-status");
};

export const fetchDashboardSettings = async (): Promise<DashboardSettings> => {
  return fetchJson<DashboardSettings>("/api/settings");
};

export const saveDashboardSettings = async (settings: DashboardSettings): Promise<DashboardSettings> => {
  return fetchJson<DashboardSettings>("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
};

export const fetchExternalSettingsHints = async (): Promise<ExternalSettingsHints> => {
  return fetchJson<ExternalSettingsHints>("/api/settings/import-sources");
};

export const rerunTask = async (taskId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/rerun`, {
    method: "POST",
  });
};
