import type { DashboardSettings, DashboardStatus, ExternalSettingsHints, GitTrackingStatus, LiveActivitiesResponse } from "../../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return (await response.json()) as T;
};

export interface RuntimeDashboardPayload {
  status: DashboardStatus;
  liveActivities: LiveActivitiesResponse["activitiesBySession"];
}

export const fetchRuntimeDashboardPayload = async (): Promise<RuntimeDashboardPayload> => {
  const [status, liveActivitiesResponse] = await Promise.all([
    fetchJson<DashboardStatus>("/api/status"),
    fetchJson<LiveActivitiesResponse>("/api/live-activities"),
  ]);

  return {
    status,
    liveActivities: liveActivitiesResponse.activitiesBySession || {},
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
