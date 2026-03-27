import type { ExecutionInvocationRecord, ExecutionInvocationMessageRecord } from "../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(`API Error: ${response.status} ${message}`);
  }
  return response.json();
};

export const fetchProjectInvocations = async (projectId: string): Promise<ExecutionInvocationRecord[]> => {
  return fetchJson<ExecutionInvocationRecord[]>(`/api/projects/${encodeURIComponent(projectId)}/execution/invocations`);
};

export const fetchInvocationMessages = async (invocationId: string): Promise<ExecutionInvocationMessageRecord[]> => {
  return fetchJson<ExecutionInvocationMessageRecord[]>(`/api/execution/invocations/${encodeURIComponent(invocationId)}/messages`);
};
