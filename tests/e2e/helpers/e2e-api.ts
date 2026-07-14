import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ProjectCollectionResponse,
  ProjectSummary,
  SprintCollectionResponse,
  SprintRecord,
  TaskRecord,
  UpdateSprintInput,
  UpdateTaskInput,
} from '../../../src/contracts/project-management-types.js';
import type {
  AutomationCredentialMetadata,
  CreateAutomationCredentialInput,
  UpdateAutomationCredentialMetadataInput,
} from '../../../src/contracts/automation-credential-types.js';
import type {
  CreateCustomDashboardDraftInput,
  CustomDashboardRecord,
} from '../../../src/contracts/custom-dashboard-types.js';
import type {
  CreateNodeFlowInput,
  NodeFlowDraftReview,
} from '../../../src/contracts/node-flow-types.js';

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

async function readResponseText(response: APIResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable response body>';
  }
}

async function expectApiResponse(response: APIResponse, expectedStatuses: number[]): Promise<void> {
  if (expectedStatuses.includes(response.status())) {
    return;
  }

  const body = await readResponseText(response);
  throw new Error(`Expected API status ${expectedStatuses.join(' or ')}, received ${response.status()}: ${body}`);
}

async function parseJson<T>(response: APIResponse, expectedStatuses: number[]): Promise<T> {
  await expectApiResponse(response, expectedStatuses);
  return (await response.json()) as T;
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

export async function completeOnboardingViaApi(request: APIRequestContext): Promise<void> {
  await expectApiResponse(await request.post('/api/user/onboarding/complete'), [200]);
}

export async function fetchProjectsViaApi(request: APIRequestContext): Promise<ProjectCollectionResponse> {
  return parseJson<ProjectCollectionResponse>(await request.get('/api/projects'), [200]);
}

export async function createProjectViaApi(
  request: APIRequestContext,
  input: CreateProjectInput,
): Promise<ProjectSummary> {
  return parseJson<ProjectSummary>(
    await request.post('/api/projects', {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [201],
  );
}

export async function selectProjectViaApi(request: APIRequestContext, projectId: string): Promise<string | null> {
  const response = await parseJson<{ selectedProjectId: string | null }>(
    await request.put(`/api/projects/${encodeURIComponent(projectId)}/select`),
    [200],
  );
  return response.selectedProjectId;
}

export async function deleteProjectViaApi(request: APIRequestContext, projectId: string): Promise<void> {
  await expectApiResponse(await request.delete(`/api/projects/${encodeURIComponent(projectId)}`), [200, 404]);
}

export async function fetchSprintsViaApi(
  request: APIRequestContext,
  projectId: string,
): Promise<SprintCollectionResponse> {
  return parseJson<SprintCollectionResponse>(
    await request.get(`/api/projects/${encodeURIComponent(projectId)}/sprints`),
    [200],
  );
}

export async function selectSprintViaApi(
  request: APIRequestContext,
  projectId: string,
  sprintId: string | null,
): Promise<string | null> {
  const response = await parseJson<{ selectedSprintId: string | null }>(
    await request.put(`/api/projects/${encodeURIComponent(projectId)}/selected-sprint`, {
      headers: jsonHeaders(),
      data: { sprintId } satisfies JsonValue,
    }),
    [200],
  );
  return response.selectedSprintId;
}

export async function createSprintViaApi(
  request: APIRequestContext,
  projectId: string,
  input: CreateSprintInput,
): Promise<SprintRecord> {
  return parseJson<SprintRecord>(
    await request.post(`/api/projects/${encodeURIComponent(projectId)}/sprints`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [201],
  );
}

export async function updateSprintViaApi(
  request: APIRequestContext,
  sprintId: string,
  input: UpdateSprintInput & { projectId?: string },
): Promise<SprintRecord> {
  return parseJson<SprintRecord>(
    await request.patch(`/api/sprints/${encodeURIComponent(sprintId)}`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [200],
  );
}

export async function deleteSprintViaApi(
  request: APIRequestContext,
  sprintId: string,
  projectId?: string,
): Promise<void> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  await expectApiResponse(await request.delete(`/api/sprints/${encodeURIComponent(sprintId)}${query}`), [200, 404]);
}

export async function fetchTasksViaApi(
  request: APIRequestContext,
  projectId: string,
  sprintId?: string,
): Promise<TaskRecord[]> {
  const query = sprintId ? `?sprintId=${encodeURIComponent(sprintId)}` : '';
  return parseJson<TaskRecord[]>(
    await request.get(`/api/projects/${encodeURIComponent(projectId)}/tasks${query}`),
    [200],
  );
}

export async function createTaskViaApi(
  request: APIRequestContext,
  projectId: string,
  input: CreateTaskInput,
): Promise<TaskRecord> {
  return parseJson<TaskRecord>(
    await request.post(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [201],
  );
}

export async function updateTaskViaApi(
  request: APIRequestContext,
  taskId: string,
  input: UpdateTaskInput & { projectId?: string },
): Promise<TaskRecord> {
  return parseJson<TaskRecord>(
    await request.patch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [200],
  );
}

export async function deleteTaskViaApi(
  request: APIRequestContext,
  taskId: string,
  projectId?: string,
): Promise<void> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  await expectApiResponse(await request.delete(`/api/tasks/${encodeURIComponent(taskId)}${query}`), [200, 404]);
}

export async function createAutomationCredentialViaApi(
  request: APIRequestContext,
  projectId: string,
  input: CreateAutomationCredentialInput,
): Promise<AutomationCredentialMetadata> {
  return parseJson<AutomationCredentialMetadata>(
    await request.post(`/api/projects/${encodeURIComponent(projectId)}/credentials`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [201],
  );
}

export async function updateAutomationCredentialViaApi(
  request: APIRequestContext,
  projectId: string,
  credentialId: string,
  input: UpdateAutomationCredentialMetadataInput,
): Promise<AutomationCredentialMetadata> {
  return parseJson<AutomationCredentialMetadata>(
    await request.patch(`/api/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [200],
  );
}

export async function createNodeFlowDraftViaApi(
  request: APIRequestContext,
  projectId: string,
  input: CreateNodeFlowInput,
): Promise<NodeFlowDraftReview> {
  return parseJson<NodeFlowDraftReview>(
    await request.post(`/api/projects/${encodeURIComponent(projectId)}/node-flow-drafts`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [201],
  );
}

export async function createCustomDashboardViaApi(
  request: APIRequestContext,
  projectId: string,
  input: CreateCustomDashboardDraftInput,
): Promise<CustomDashboardRecord> {
  return parseJson<CustomDashboardRecord>(
    await request.post(`/api/projects/${encodeURIComponent(projectId)}/custom-dashboards`, {
      headers: jsonHeaders(),
      data: input satisfies JsonValue,
    }),
    [201],
  );
}
