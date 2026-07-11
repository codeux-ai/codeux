import type { PreviewEnvironmentVariable, SprintPreviewScript, SprintPreviewSession } from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchPreviewSessions = async (projectId: string): Promise<SprintPreviewSession[]> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/preview/sessions`);
};

export const startPreviewSession = async (projectId: string, sprintId: string): Promise<SprintPreviewSession> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/preview/start`, {
    method: "POST",
  });
};

const buildScopedPreviewSessionPath = (projectId: string, sprintId: string, sessionId: string, suffix = ""): string => {
  return `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/preview/sessions/${encodeURIComponent(sessionId)}${suffix}`;
};

export const rebuildPreviewSession = async (projectId: string, sprintId: string, sessionId: string): Promise<SprintPreviewSession> => {
  return fetchJson(buildScopedPreviewSessionPath(projectId, sprintId, sessionId, "/rebuild"), {
    method: "POST",
  });
};

export const stopPreviewSession = async (projectId: string, sprintId: string, sessionId: string): Promise<SprintPreviewSession> => {
  return fetchJson(buildScopedPreviewSessionPath(projectId, sprintId, sessionId, "/stop"), {
    method: "POST",
  });
};

export const removePreviewSession = async (projectId: string, sprintId: string, sessionId: string): Promise<void> => {
  const response = await fetch(buildScopedPreviewSessionPath(projectId, sprintId, sessionId), {
    method: "DELETE",
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : "Failed to remove preview session";
    throw new Error(errorMessage);
  }
};

export const fetchPreviewScript = async (projectId: string, sprintId: string): Promise<SprintPreviewScript> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/preview/script`);
};

export const savePreviewScript = async (
  projectId: string,
  sprintId: string,
  content: string,
): Promise<SprintPreviewScript> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/preview/script`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
};

export const savePreviewEnvironmentOverrides = async (
  projectId: string,
  sprintId: string,
  sessionId: string,
  environmentOverrides: PreviewEnvironmentVariable[],
): Promise<SprintPreviewSession> => {
  return fetchJson(buildScopedPreviewSessionPath(projectId, sprintId, sessionId, "/environment"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environmentOverrides }),
  });
};

export const savePreviewStartupCommandOverride = async (
  projectId: string,
  sprintId: string,
  sessionId: string,
  startupCommandOverride: string | null,
): Promise<SprintPreviewSession> => {
  return fetchJson(buildScopedPreviewSessionPath(projectId, sprintId, sessionId, "/startup-command"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startupCommandOverride }),
  });
};

export const fetchPreviewLogs = async (projectId: string, sprintId: string, sessionId: string, tail = 200): Promise<{ logs: string }> => {
  const url = new URL(buildScopedPreviewSessionPath(projectId, sprintId, sessionId, "/logs"), window.location.origin);
  url.searchParams.set("tail", String(tail));
  return fetchJson(`${url.pathname}${url.search}`);
};
