import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord, ProjectInvocationsQuery, ProjectInvocationsQueryResult } from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export function fetchProjectInvocations(projectId: string, query?: undefined, init?: RequestInit): Promise<ExecutionInvocationRecord[]>;
export function fetchProjectInvocations(projectId: string, query: ProjectInvocationsQuery, init?: RequestInit): Promise<ProjectInvocationsQueryResult>;
export async function fetchProjectInvocations(
  projectId: string,
  query?: ProjectInvocationsQuery,
  init?: RequestInit
): Promise<ExecutionInvocationRecord[] | ProjectInvocationsQueryResult> {
  if (query) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        if (Array.isArray(value)) {
          for (const item of value) {
            searchParams.append(key, String(item));
          }
        } else {
          searchParams.set(key, String(value));
        }
      }
    }
    return fetchJson<ProjectInvocationsQueryResult>(
      `/api/projects/${encodeURIComponent(projectId)}/execution/invocations?${searchParams.toString()}`,
      init
    );
  }

  return fetchJson<ExecutionInvocationRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/execution/invocations`, init);
}

export const fetchProjectInvocationsQuery = async (
  projectId: string,
  query: ProjectInvocationsQuery,
  init?: RequestInit
): Promise<ProjectInvocationsQueryResult> => {
  return fetchProjectInvocations(projectId, query, init) as Promise<ProjectInvocationsQueryResult>;
};

export const fetchInvocationMessages = async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
  return fetchJson<ExecutionInvocationMessageRecord[]>(`/api/execution/invocations/${encodeURIComponent(invocationId)}/messages`);
};

export type InvocationRestartMode = "retry_full_prompt" | "continue_session";

export const restartExecutionInvocation = async (
  invocationId: string,
  mode: InvocationRestartMode = "retry_full_prompt",
): Promise<{ invocationId?: string }> => {
  return fetchJson<{ invocationId?: string }>(`/api/execution/invocations/${encodeURIComponent(invocationId)}/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
};

export const cancelExecutionInvocation = async (
  invocationId: string,
): Promise<{ cancelled: boolean; invocationId: string; stoppedContainerIds?: string[]; message?: string }> => {
  return fetchJson<{ cancelled: boolean; invocationId: string; stoppedContainerIds?: string[]; message?: string }>(
    `/api/execution/invocations/${encodeURIComponent(invocationId)}/cancel`,
    { method: "POST" },
  );
};
