import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateSprintRollbackResult,
  CreateTaskInput,
  IssuePromptContext,
  IssuePromptContextInput,
  ImprovePromptInput,
  LocalDirectoryBrowserResponse,
  LocalFileBrowserResponse,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectInitializationState,
  ProjectSummary,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  SprintCollectionResponse,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintImportedTaskInput,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
  SprintRecord,
  SprintBranchUpdateResult,
  SprintRollbackAssessment,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../types.js";
import type {
  JiraIssueSearchInput as SharedJiraIssueSearchInput,
  JiraIssueSearchResult as SharedJiraIssueSearchResult,
  RepositoryIssueSearchInput as SharedRepositoryIssueSearchInput,
  RepositoryIssueSearchResult,
} from "../../../../src/contracts/project-management-types.js";
import type {
  ExecutionAssignedWorkerSummary,
  ExecutionDashboardSnapshot,
  HeaderTokenThroughputQuery,
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputWindow,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchProjects = async (signal?: AbortSignal): Promise<ProjectCollectionResponse> => {
  return fetchJson<ProjectCollectionResponse>("/api/projects", { signal });
};

export const fetchProjectInitializationState = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectInitializationState> => {
  return fetchJson<ProjectInitializationState>(
    `/api/projects/${encodeURIComponent(projectId)}/initialization-state`,
    { signal },
  );
};

export const fetchLocalDirectories = async (directoryPath?: string): Promise<LocalDirectoryBrowserResponse> => {
  const url = new URL("/api/local-directories", window.location.origin);
  if (directoryPath?.trim()) {
    url.searchParams.set("path", directoryPath.trim());
  }
  return fetchJson<LocalDirectoryBrowserResponse>(`${url.pathname}${url.search}`);
};

export const fetchLocalFiles = async (directoryPath?: string): Promise<LocalFileBrowserResponse> => {
  const url = new URL("/api/local-files", window.location.origin);
  if (directoryPath?.trim()) {
    url.searchParams.set("path", directoryPath.trim());
  }
  return fetchJson<LocalFileBrowserResponse>(`${url.pathname}${url.search}`);
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

export type RemoteIssueSummary = RepositoryIssueSearchResult;
export type JiraIssueSearchInput = SharedJiraIssueSearchInput;
export type JiraIssueSearchResult = SharedJiraIssueSearchResult;
export interface JiraProjectStatus {
  id: string;
  name: string;
  issueTypes: string[];
}
export type RepositoryIssueSearchInput = Omit<SharedRepositoryIssueSearchInput, "state" | "status"> & {
  state?: SharedRepositoryIssueSearchInput["state"] | string;
  status?: SharedJiraIssueSearchInput["status"] | string;
  providerProjectId?: string;
  includeConversation?: boolean;
};

export const searchJiraIssues = async (
  projectId: string,
  input: JiraIssueSearchInput,
  signal?: AbortSignal,
): Promise<JiraIssueSearchResult[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/jira/search`, window.location.origin);
  if (input.projectKey?.trim()) url.searchParams.set("projectKey", input.projectKey.trim());
  if (input.search?.trim()) url.searchParams.set("search", input.search.trim());
  if (input.issueKey?.trim()) url.searchParams.set("issueKey", input.issueKey.trim());
  if (input.status) url.searchParams.set("status", input.status);
  if (input.inProgressStatusName?.trim()) url.searchParams.set("inProgressStatusName", input.inProgressStatusName.trim());
  for (const statusName of input.statusNames ?? []) {
    if (statusName.trim()) url.searchParams.append("statusNames", statusName.trim());
  }
  if (input.assignee) url.searchParams.set("assignee", input.assignee);
  if (input.assigneeText?.trim()) url.searchParams.set("assigneeText", input.assigneeText.trim());
  if (input.reporterText?.trim()) url.searchParams.set("reporterText", input.reporterText.trim());
  if (input.issueType?.trim()) url.searchParams.set("issueType", input.issueType.trim());
  if (input.priority?.trim()) url.searchParams.set("priority", input.priority.trim());
  if (input.labels?.length) url.searchParams.set("labels", input.labels.join(","));
  if (input.updatedAfter?.trim()) url.searchParams.set("updatedAfter", input.updatedAfter.trim());
  if (input.updatedBefore?.trim()) url.searchParams.set("updatedBefore", input.updatedBefore.trim());
  if (input.sortField) url.searchParams.set("sortField", input.sortField);
  if (input.sortDirection) url.searchParams.set("sortDirection", input.sortDirection);
  if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
  if (input.maxResults !== undefined) url.searchParams.set("maxResults", String(input.maxResults));
  if (input.jql?.trim()) url.searchParams.set("jql", input.jql.trim());
  return fetchJson<JiraIssueSearchResult[]>(
    `${url.pathname}${url.search}`,
    { signal }
  );
};

export const fetchJiraProjectStatuses = async (
  projectId: string,
  projectKey: string,
  signal?: AbortSignal,
): Promise<JiraProjectStatus[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/jira/statuses`, window.location.origin);
  if (projectKey.trim()) url.searchParams.set("projectKey", projectKey.trim());
  return fetchJson<JiraProjectStatus[]>(`${url.pathname}${url.search}`, { signal });
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
): Promise<{ linkedIssues: SprintLinkedIssueRecord[]; warnings: Array<{ issueId: string; issueKey: string; message: string }> }> => {
  return fetchJson<{ linkedIssues: SprintLinkedIssueRecord[]; warnings: Array<{ issueId: string; issueKey: string; message: string }> }>(
    `/api/sprints/${encodeURIComponent(sprintId)}/linked-issues`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, issues }),
    }
  );
};

export const addImportedTasksToSprint = async (
  projectId: string,
  sprintId: string,
  tasks: SprintImportedTaskInput[],
): Promise<TaskRecord[]> => {
  return fetchJson<TaskRecord[]>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/imported-tasks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks }),
    }
  );
};

export const searchProjectIssues = async (
  projectId: string,
  input: RepositoryIssueSearchInput,
  signal?: AbortSignal,
): Promise<RemoteIssueSummary[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/issues`, window.location.origin);
  if (input.provider) url.searchParams.set("provider", input.provider);
  if (input.externalId?.trim()) url.searchParams.set("externalIds", input.externalId.trim());
  if (input.externalIds?.length) url.searchParams.set("externalIds", input.externalIds.join(","));
  if (input.repository?.trim()) url.searchParams.set("repository", input.repository.trim());
  if (input.hostDomain?.trim()) url.searchParams.set("hostDomain", input.hostDomain.trim());
  if (input.workspaceId?.trim()) url.searchParams.set("workspaceId", input.workspaceId.trim());
  if (input.providerProjectId?.trim()) url.searchParams.set("projectId", input.providerProjectId.trim());
  if (input.projectId?.trim()) url.searchParams.set("projectId", input.projectId.trim());
  if (input.teamId?.trim()) url.searchParams.set("teamId", input.teamId.trim());
  if (input.teamKey?.trim()) url.searchParams.set("teamKey", input.teamKey.trim());
  if (input.databaseId?.trim()) url.searchParams.set("databaseId", input.databaseId.trim());
  if (input.boardId?.trim()) url.searchParams.set("boardId", input.boardId.trim());
  if (input.documentId?.trim()) url.searchParams.set("documentId", input.documentId.trim());
  if (input.fileKey?.trim()) url.searchParams.set("fileKey", input.fileKey.trim());
  if (input.muralId?.trim()) url.searchParams.set("muralId", input.muralId.trim());
  if (input.itemTypes?.length) url.searchParams.set("itemTypes", input.itemTypes.join(","));
  if (input.projectKey?.trim()) url.searchParams.set("projectKey", input.projectKey.trim());
  if (input.search?.trim()) url.searchParams.set("search", input.search.trim());
  if (input.issueText?.trim()) url.searchParams.set("issueText", input.issueText.trim());
  if (input.state) url.searchParams.set("state", input.state);
  if (input.status) url.searchParams.set("status", input.status);
  if (input.labels?.length) url.searchParams.set("labels", input.labels.join(","));
  if (input.assignee?.trim()) url.searchParams.set("assignee", input.assignee.trim());
  if (input.assigneeText?.trim()) url.searchParams.set("assigneeText", input.assigneeText.trim());
  if (input.author?.trim()) url.searchParams.set("author", input.author.trim());
  if (input.reporter?.trim()) url.searchParams.set("reporter", input.reporter.trim());
  if (input.milestone?.trim()) url.searchParams.set("milestone", input.milestone.trim());
  if (input.createdAfter?.trim()) url.searchParams.set("createdAfter", input.createdAfter.trim());
  if (input.createdBefore?.trim()) url.searchParams.set("createdBefore", input.createdBefore.trim());
  if (input.updatedAfter?.trim()) url.searchParams.set("updatedAfter", input.updatedAfter.trim());
  if (input.updatedBefore?.trim()) url.searchParams.set("updatedBefore", input.updatedBefore.trim());
  if (input.sortField) url.searchParams.set("sortField", input.sortField);
  if (input.sortDirection) url.searchParams.set("sortDirection", input.sortDirection);
  if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
  if (input.includeConversation !== undefined) url.searchParams.set("includeConversation", String(input.includeConversation));
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

export const fetchHeaderTokenThroughput = async (
  query: Partial<HeaderTokenThroughputQuery> & { window?: HeaderTokenThroughputWindow } = {},
  signal?: AbortSignal,
): Promise<HeaderTokenThroughputSnapshot> => {
  const url = new URL("/api/stats/header-throughput", window.location.origin);
  url.searchParams.set("window", query.window || "1h");
  const projectId = query.projectId?.trim();
  if (projectId) {
    url.searchParams.set("projectId", projectId);
  }
  return fetchJson<HeaderTokenThroughputSnapshot>(`${url.pathname}${url.search}`, { signal });
};

export const createSprint = async (projectId: string, input: CreateSprintInput): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/projects/${encodeURIComponent(projectId)}/sprints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const assessSprintRollback = async (
  projectId: string,
  sprintId: string,
  signal?: AbortSignal,
): Promise<SprintRollbackAssessment> => fetchJson<SprintRollbackAssessment>(
  `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/rollback/assessment`,
  { signal },
);

export const createSprintRollback = async (
  projectId: string,
  sprintId: string,
  instructions: string,
): Promise<CreateSprintRollbackResult> => fetchJson<CreateSprintRollbackResult>(
  `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/rollback`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions: instructions.trim() || undefined }),
  },
);

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

export const updateSprintBranch = async (
  projectId: string,
  sprintId: string,
): Promise<SprintBranchUpdateResult> => {
  return fetchJson<SprintBranchUpdateResult>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/update-branch`,
    { method: "POST" },
  );
};

export const markSprintCompleted = async (sprintId: string): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/sprints/${encodeURIComponent(sprintId)}/complete`, {
    method: "POST",
  });
};

export const markSprintQaPassed = async (sprintId: string): Promise<SprintRecord> => {
  return fetchJson<SprintRecord>(`/api/sprints/${encodeURIComponent(sprintId)}/qa-pass`, {
    method: "POST",
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

export const fetchTasks = async (projectId: string, sprintId?: string, view?: "overview"): Promise<TaskRecord[]> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/tasks`, window.location.origin);
  if (sprintId) {
    url.searchParams.set("sprintId", sprintId);
  }
  if (view) {
    url.searchParams.set("view", view);
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

export interface AvailableGitProviders { github: boolean; gitlab: boolean; }

export const fetchAvailableGitProviders = async (): Promise<AvailableGitProviders> =>
  fetchJson<AvailableGitProviders>("/api/git-providers/available");
