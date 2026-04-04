import type { SprintPreviewScript, SprintPreviewSession } from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchPreviewSessions = async (projectId: string): Promise<SprintPreviewSession[]> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/preview/sessions`);
};

export const startPreviewSession = async (projectId: string, sprintId: string): Promise<SprintPreviewSession> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/preview/start`, {
    method: "POST",
  });
};

export const rebuildPreviewSession = async (sessionId: string): Promise<SprintPreviewSession> => {
  return fetchJson(`/api/browser/sessions/${encodeURIComponent(sessionId)}/rebuild`, {
    method: "POST",
  });
};

export const stopPreviewSession = async (sessionId: string): Promise<SprintPreviewSession> => {
  return fetchJson(`/api/browser/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
};

export const removePreviewSession = async (sessionId: string): Promise<void> => {
  const response = await fetch(`/api/browser/sessions/${encodeURIComponent(sessionId)}`, {
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

export const fetchPreviewLogs = async (sessionId: string, tail = 200): Promise<{ logs: string }> => {
  const url = new URL(`/api/browser/sessions/${encodeURIComponent(sessionId)}/logs`, window.location.origin);
  url.searchParams.set("tail", String(tail));
  return fetchJson(`${url.pathname}${url.search}`);
};
