import type {
  AgentConnection,
  ChatMessageRecord,
  ChatThread,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  UpdateConversationThreadInput,
  UpdateMcpConnectionInput,
} from "../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return await response.json() as T;
};

export const fetchProjectConnections = async (projectId: string): Promise<AgentConnection[]> => {
  return fetchJson<AgentConnection[]>(`/api/projects/${encodeURIComponent(projectId)}/connections`);
};

export const updateConnection = async (
  connectionId: string,
  input: UpdateMcpConnectionInput
): Promise<AgentConnection> => {
  return fetchJson<AgentConnection>(`/api/connections/${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const fetchConversationThreads = async (projectId: string): Promise<ChatThread[]> => {
  return fetchJson<ChatThread[]>(`/api/projects/${encodeURIComponent(projectId)}/conversations/threads`);
};

export const createConversationThread = async (
  projectId: string,
  input: CreateConversationThreadInput
): Promise<ChatThread> => {
  return fetchJson<ChatThread>(`/api/projects/${encodeURIComponent(projectId)}/conversations/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const fetchConversationMessages = async (threadId: string): Promise<ChatMessageRecord[]> => {
  return fetchJson<ChatMessageRecord[]>(`/api/conversations/threads/${encodeURIComponent(threadId)}/messages`);
};

export const updateConversationThread = async (
  threadId: string,
  input: UpdateConversationThreadInput
): Promise<ChatThread> => {
  return fetchJson<ChatThread>(`/api/conversations/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const postConversationMessage = async (
  projectId: string,
  input: CreateDashboardConversationMessageInput
): Promise<ChatMessageRecord> => {
  return fetchJson<ChatMessageRecord>(`/api/projects/${encodeURIComponent(projectId)}/conversations/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};
