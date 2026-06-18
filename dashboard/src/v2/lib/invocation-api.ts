import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord, ProjectInvocationsQuery, ProjectInvocationsQueryResult } from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export function fetchProjectInvocations(projectId: string): Promise<ExecutionInvocationRecord[]>;
export function fetchProjectInvocations(projectId: string, query: ProjectInvocationsQuery): Promise<ProjectInvocationsQueryResult>;
export async function fetchProjectInvocations(
  projectId: string,
  query?: ProjectInvocationsQuery
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
      `/api/projects/${encodeURIComponent(projectId)}/execution/invocations?${searchParams.toString()}`
    );
  }

  return fetchJson<ExecutionInvocationRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/execution/invocations`);
}

export const fetchProjectInvocationsQuery = async (
  projectId: string,
  query: ProjectInvocationsQuery
): Promise<ProjectInvocationsQueryResult> => {
  return fetchProjectInvocations(projectId, query) as Promise<ProjectInvocationsQueryResult>;
};

export const fetchInvocationMessages = async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
  return fetchJson<ExecutionInvocationMessageRecord[]>(`/api/execution/invocations/${encodeURIComponent(invocationId)}/messages`);
};
