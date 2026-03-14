import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  SystemSettings,
} from "../../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return await response.json() as T;
};

export const fetchSystemSettings = async (): Promise<SystemSettings> => {
  return fetchJson<SystemSettings>("/api/system-settings");
};

export const saveSystemSettings = async (settings: SystemSettings): Promise<SystemSettings> => {
  return fetchJson<SystemSettings>("/api/system-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
};

export const resetSystemDatabase = async (): Promise<void> => {
  await fetchJson<{ ok: boolean }>("/api/system/reset-database", {
    method: "POST",
  });
};

export const fetchProjectEffectiveSettings = async (projectId: string): Promise<EffectiveSettingsResponse> => {
  return fetchJson<EffectiveSettingsResponse>(`/api/projects/${encodeURIComponent(projectId)}/settings/effective`);
};

export const saveProjectSettings = async (projectId: string, settings: ProjectSettings): Promise<void> => {
  await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
};

export const resetProjectSettings = async (projectId: string): Promise<void> => {
  await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "DELETE",
  });
};

export const fetchSprintEffectiveSettings = async (
  projectId: string,
  sprintId: string,
): Promise<EffectiveSettingsResponse> => {
  return fetchJson<EffectiveSettingsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/settings/effective`
  );
};

export const saveSprintSettings = async (
  projectId: string,
  sprintId: string,
  settings: ProjectSettings,
): Promise<void> => {
  await fetchJson(`/api/sprints/${encodeURIComponent(sprintId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      ...settings,
    }),
  });
};

export const resetSprintSettings = async (sprintId: string): Promise<void> => {
  await fetchJson(`/api/sprints/${encodeURIComponent(sprintId)}/settings`, {
    method: "DELETE",
  });
};
