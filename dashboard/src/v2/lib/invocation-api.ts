import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord } from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchProjectInvocations = async (projectId: string): Promise<ExecutionInvocationRecord[]> => {
  return fetchJson<ExecutionInvocationRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/execution/invocations`);
};

export const fetchProjectInvocationsQuery = async (
  projectId: string,
  query: import("../types.js").ProjectInvocationsQuery
): Promise<import("../types.js").ProjectInvocationsQueryResult> => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  return fetchJson<import("../types.js").ProjectInvocationsQueryResult>(
    `/api/projects/${encodeURIComponent(projectId)}/execution/invocations?${searchParams.toString()}`
  );
};

export const fetchInvocationMessages = async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
  return fetchJson<ExecutionInvocationMessageRecord[]>(`/api/execution/invocations/${encodeURIComponent(invocationId)}/messages`);
};
