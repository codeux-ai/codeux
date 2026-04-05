import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord } from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchProjectInvocations = async (projectId: string): Promise<ExecutionInvocationRecord[]> => {
  return fetchJson<ExecutionInvocationRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/execution/invocations`);
};

export const fetchInvocationMessages = async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
  return fetchJson<ExecutionInvocationMessageRecord[]>(`/api/execution/invocations/${encodeURIComponent(invocationId)}/messages`);
};
