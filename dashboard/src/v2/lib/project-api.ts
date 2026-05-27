import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  IssuePromptContext,
  IssuePromptContextInput,
  ImprovePromptInput,
  LocalDirectoryBrowserResponse,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectSummary,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  SprintCollectionResponse,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
  SprintRecord,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../types.js";

export interface JiraIssueSearchResult {
  key: string;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  projectKey: string;
  issueType: string | null;
  priority: string | null;
  bodyPreview: string;
  updatedAt: string | null;
}
import type {
  ExecutionAssignedWorkerSummary,
  ExecutionDashboardSnapshot,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchProjects = async (signal?: AbortSignal): Promise<ProjectCollectionResponse> => {
  return fetchJson<ProjectCollectionResponse>("/api/projects", { signal });
};

export const fetchLocalDirectories = async (directoryPath?: string): Promise<LocalDirectoryBrowserResponse> => {
  const url = new URL("/api/local-directories", window.location.origin);
  if (directoryPath?.trim()) {
    url.searchParams.set("path", directoryPath.trim());
  }
  return fetchJson<LocalDirectoryBrowserResponse>(`${url.pathname}${url.search}`);
};

export const createProject = async (input: CreateProjectInput): Promise<ProjectSummary> => {
  return fetchJson<ProjectSummary>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const setupProject = async (
  projectId: string,
  input: ProjectSetupRequestInput,
): Promise<ProjectSetupResult> => {
  return fetchJson<ProjectSetupResult>(`/api/projects/${encodeURIComponent(projectId)}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const startProjectSetup = async (
  projectId: string,
  input: ProjectSetupRequestInput,
): Promise<ProjectSetupStartResult> => {
  return fetchJson<ProjectSetupStartResult>(`/api/projects/${encodeURIComponent(projectId)}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, background: true }),
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

export interface RemoteIssueSummary extends SprintLinkedIssueInput {
  bodyPreview: string;
  updatedAt: string | null;
}

export const searchJiraIssues = async (
  projectId: string,
  input: {
    projectKey?: string;
    search?: string;
    status?: "open" | "in_progress" | "done" | "all";
    assignee?: "any" | "me" | "unassigned";
    assigneeText?: string;
    labels?: string[];
    limit?: number;
    jql?: string;
  },
  signal?: AbortSignal,
): Promise<JiraIssueSearchResult[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/jira/search`, window.location.origin);
  if (input.projectKey?.trim()) url.searchParams.set("projectKey", input.projectKey.trim());
  if (input.search?.trim()) url.searchParams.set("search", input.search.trim());
  if (input.status) url.searchParams.set("status", input.status);
  if (input.assignee) url.searchParams.set("assignee", input.assignee);
  if (input.assigneeText?.trim()) url.searchParams.set("assigneeText", input.assigneeText.trim());
  if (input.labels?.length) url.searchParams.set("labels", input.labels.join(","));
  if (input.limit) url.searchParams.set("limit", String(input.limit));
  if (input.jql?.trim()) url.searchParams.set("jql", input.jql.trim());
  return fetchJson<JiraIssueSearchResult[]>(
    `${url.pathname}${url.search}`,
    { signal }
  );
};

export const listSprintLinkedIssues = async (
  sprintId: string,
  signal?: AbortSignal,
): Promise<SprintLinkedIssueRecord[]> => {
  return fetchJson<SprintLinkedIssueRecord[]>(
    `/api/sprints/${encodeURIComponent(sprintId)}/linked-issues`,
    { signal }
  );
};

export const replaceSprintLinkedIssues = async (
  sprintId: string,
  projectId: string,
  issues: SprintLinkedIssueInput[],
): Promise<SprintLinkedIssueRecord[]> => {
  return fetchJson<SprintLinkedIssueRecord[]>(
    `/api/sprints/${encodeURIComponent(sprintId)}/linked-issues`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, issues }),
    }
  );
};

export const searchProjectIssues = async (
  projectId: string,
  input: {
    provider?: "github" | "gitlab";
    repository?: string;
    hostDomain?: string;
    search?: string;
    state?: "open" | "closed" | "all";
    labels?: string[];
    assignee?: string;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<RemoteIssueSummary[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/issues`, window.location.origin);
  if (input.provider) url.searchParams.set("provider", input.provider);
  if (input.repository?.trim()) url.searchParams.set("repository", input.repository.trim());
  if (input.hostDomain?.trim()) url.searchParams.set("hostDomain", input.hostDomain.trim());
  if (input.search?.trim()) url.searchParams.set("search", input.search.trim());
  if (input.state) url.searchParams.set("state", input.state);
  if (input.labels?.length) url.searchParams.set("labels", input.labels.join(","));
  if (input.assignee?.trim()) url.searchParams.set("assignee", input.assignee.trim());
  if (input.limit) url.searchParams.set("limit", String(input.limit));
  return fetchJson<RemoteIssueSummary[]>(`${url.pathname}${url.search}`, { signal });
};

export const fetchProjectIssuePromptContexts = async (
  projectId: string,
  issues: IssuePromptContextInput[],
  signal?: AbortSignal,
): Promise<IssuePromptContext[]> => {
  return fetchJson<IssuePromptContext[]>(`/api/projects/${encodeURIComponent(projectId)}/issues/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issues }),
    signal,
  });
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
  signal?: AbortSignal,
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
  return fetchJson<ProjectExecutionStatsSnapshot>(`${url.pathname}${url.search}`, { signal });
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

export const cancelPlanningRequest = async (
  clientRequestId: string,
): Promise<{ ok: true; cancelled: boolean }> => {
  return fetchJson(`/api/planning-requests/${encodeURIComponent(clientRequestId)}/cancel`, {
    method: "POST",
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

export async function updateSprintShowcase(sprintId: string, pinned: boolean): Promise<any> {
  return fetchJson(`/api/sprints/${encodeURIComponent(sprintId)}/showcase`, {
    method: "PUT",
    body: JSON.stringify({ pinned }),
  });
}
