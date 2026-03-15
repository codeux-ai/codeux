import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ProjectCollectionResponse,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintRecord,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../types.js";
import type { ExecutionDashboardSnapshot } from "../../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return await response.json() as T;
};

export const fetchProjects = async (): Promise<ProjectCollectionResponse> => {
  return fetchJson<ProjectCollectionResponse>("/api/projects");
};

export const createProject = async (input: CreateProjectInput): Promise<ProjectSummary> => {
  return fetchJson<ProjectSummary>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateProject = async (projectId: string, input: UpdateProjectInput): Promise<ProjectSummary> => {
  return fetchJson<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteProject = async (projectId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
};

export const selectProject = async (projectId: string): Promise<string | null> => {
  const response = await fetchJson<{ selectedProjectId: string | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/select`,
    { method: "PUT" }
  );
  return response.selectedProjectId;
};

export const fetchSprints = async (projectId: string): Promise<SprintRecord[]> => {
  return fetchJson<SprintRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/sprints`);
};

export const fetchProjectExecution = async (projectId: string): Promise<ExecutionDashboardSnapshot> => {
  return fetchJson<ExecutionDashboardSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/execution`);
};

export const createSprint = async (projectId: string, input: CreateSprintInput): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/projects/${encodeURIComponent(projectId)}/sprints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const improveSprintPrompt = async (
  projectId: string,
  input: { name: string; goal: string },
): Promise<{ goal: string; threadId: string; agentId: string; workerConnectionId: string | null }> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/planning/improve-sprint-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const planSprint = async (
  projectId: string,
  sprintId: string,
  input: { autoStart: boolean },
): Promise<{ ok: true; threadId: string; agentId: string; createdTaskIds: string[]; started: boolean }> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateSprint = async (sprintId: string, input: UpdateSprintInput): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/sprints/${encodeURIComponent(sprintId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteSprint = async (sprintId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/sprints/${encodeURIComponent(sprintId)}`, {
    method: "DELETE",
  });
};

export const importSprintMarkdown = async (
  projectId: string,
  input: SprintMarkdownImportInput
): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/projects/${encodeURIComponent(projectId)}/sprints/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const exportSprintMarkdown = async (
  projectId: string,
  sprintId: string
): Promise<SprintMarkdownExportBundle> => {
  return fetchJson<SprintMarkdownExportBundle>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/export`
  );
};

export const fetchTasks = async (projectId: string, sprintId?: string): Promise<TaskRecord[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/tasks`, window.location.origin);
  if (sprintId) {
    url.searchParams.set("sprintId", sprintId);
  }
  return fetchJson<TaskRecord[]>(`${url.pathname}${url.search}`);
};

export const createTask = async (projectId: string, input: CreateTaskInput): Promise<TaskRecord> => {
  return fetchJson<TaskRecord>(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateTask = async (taskId: string, input: UpdateTaskInput): Promise<TaskRecord> => {
  return fetchJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteTask = async (taskId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
};
