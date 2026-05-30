import type {
  FileBrowserChangeSet,
  FileBrowserDiff,
  FileBrowserFileContent,
  FileBrowserSession,
  FileBrowserTree,
} from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchFileBrowserSessions = async (projectId: string): Promise<FileBrowserSession[]> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/file-browser/sessions`);
};

export const startFileBrowserSession = async (projectId: string, sprintId: string): Promise<FileBrowserSession> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/file-browser/start`, {
    method: "POST",
  });
};

export const rebuildFileBrowserSession = async (sessionId: string): Promise<FileBrowserSession> => {
  return fetchJson(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}/rebuild`, {
    method: "POST",
  });
};

export const stopFileBrowserSession = async (sessionId: string): Promise<FileBrowserSession> => {
  return fetchJson(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
};

export const removeFileBrowserSession = async (sessionId: string): Promise<void> => {
  const response = await fetch(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : "Failed to remove file browser session";
    throw new Error(errorMessage);
  }
};

export const fetchFileBrowserTree = async (sessionId: string): Promise<FileBrowserTree> => {
  return fetchJson(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}/tree`);
};

export const fetchFileBrowserFile = async (sessionId: string, path: string): Promise<FileBrowserFileContent> => {
  const url = new URL(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}/file`, window.location.origin);
  url.searchParams.set("path", path);
  return fetchJson(`${url.pathname}${url.search}`);
};

export const fetchFileBrowserChanges = async (sessionId: string): Promise<FileBrowserChangeSet> => {
  return fetchJson(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}/changes`);
};

export const fetchFileBrowserDiff = async (sessionId: string, path: string): Promise<FileBrowserDiff> => {
  const url = new URL(`/api/file-browser/sessions/${encodeURIComponent(sessionId)}/diff`, window.location.origin);
  url.searchParams.set("path", path);
  return fetchJson(`${url.pathname}${url.search}`);
};
