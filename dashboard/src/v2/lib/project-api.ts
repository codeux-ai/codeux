import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ImprovePromptInput,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectSummary,
  SprintCollectionResponse,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintRecord,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../types.js";
import type {
  ExecutionAssignedWorkerSummary,
  ExecutionDashboardSnapshot,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
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

export const setProjectPreferredWorker = async (
  projectId: string,
  input: {
    workerConnectionId?: string | null;
    workerEndpointId?: string | null;
    workerEndpointKey?: string | null;
  },
): Promise<{
  primaryAssignedWorker: ExecutionAssignedWorkerSummary | null;
  overflowAssignedWorkers: ExecutionAssignedWorkerSummary[];
}> => {
  return fetchJson<{
    primaryAssignedWorker: ExecutionAssignedWorkerSummary | null;
    overflowAssignedWorkers: ExecutionAssignedWorkerSummary[];
  }>(`/api/projects/${encodeURIComponent(projectId)}/preferred-worker`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const fetchSprints = async (projectId: string, signal?: AbortSignal): Promise<SprintCollectionResponse> => {
  return fetchJson<SprintCollectionResponse>(`/api/projects/${encodeURIComponent(projectId)}/sprints`, { signal });
};

export const selectSprint = async (projectId: string, sprintId: string | null): Promise<string | null> => {
  const response = await fetchJson<{ selectedSprintId: string | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/selected-sprint`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprintId }),
    }
  );
  return response.selectedSprintId;
};

export const fetchProjectExecution = async (projectId: string, signal?: AbortSignal): Promise<ExecutionDashboardSnapshot> => {
  return fetchJson<ExecutionDashboardSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/execution`, { signal });
};

export const fetchProjectStats = async (
  projectId: string,
  statsQuery: ProjectStatsQuery | ProjectStatsWindow = "7d",
): Promise<ProjectExecutionStatsSnapshot> => {
  const query = typeof statsQuery === "string"
    ? { window: statsQuery }
    : statsQuery;
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/stats`, window.location.origin);
  url.searchParams.set("window", query.window);
  if (query.from) {
    url.searchParams.set("from", query.from);
  }
  if (query.to) {
    url.searchParams.set("to", query.to);
  }
  return fetchJson<ProjectExecutionStatsSnapshot>(`${url.pathname}${url.search}`);
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
  input: ImprovePromptInput,
  signal?: AbortSignal,
): Promise<{ goal: string; invocationId: string; agentId: string; workerConnectionId: string | null }> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/planning/improve-sprint-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
};

export const planSprint = async (
  projectId: string,
  sprintId: string,
  input: PlanSprintOptions,
  signal?: AbortSignal,
): Promise<{ ok: true; invocationId: string; agentId: string; createdTaskIds: string[]; started: boolean }> => {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
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
