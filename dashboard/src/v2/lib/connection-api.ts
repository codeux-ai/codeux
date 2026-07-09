import type {
  AgentConnection,
  ChatDraftRecord,
  ConversationMessageHistoryRecord,
  ChatMessageRecord,
  ChatThread,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  UpsertConversationDraftInput,
  UpdateConversationThreadInput,
  UpdateConversationThreadRouteInput,
  UpdateMcpConnectionInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

const CHAT_DRAFT_USER_STORAGE_KEY = "codeux.chat.draftUserId";
const CHAT_DRAFT_USER_HEADER = "X-CodeUX-Dashboard-User-Id";
let draftUserIdMemoryFallback: string | null = null;

const createCryptoRandomId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure random generation is unavailable.");
};

const createDraftUserId = (): string => `dashboard-user-${createCryptoRandomId()}`;

export const getOrCreateDashboardDraftUserId = (): string => {
  if (typeof window === "undefined") {
    return "dashboard-user-server";
  }
  try {
    const stored = window.localStorage.getItem(CHAT_DRAFT_USER_STORAGE_KEY)?.trim();
    if (stored) {
      draftUserIdMemoryFallback = stored;
      return stored;
    }
    const next = createDraftUserId();
    window.localStorage.setItem(CHAT_DRAFT_USER_STORAGE_KEY, next);
    draftUserIdMemoryFallback = next;
    return next;
  } catch {
    draftUserIdMemoryFallback ??= createDraftUserId();
    return draftUserIdMemoryFallback;
  }
};

const chatDraftHeaders = (userId: string): Record<string, string> => ({
  [CHAT_DRAFT_USER_HEADER]: userId,
});

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

export const fetchConversationDraft = async (
  projectId: string,
  input: { userId: string; contextKey: string },
): Promise<ChatDraftRecord | null> => {
  const params = new URLSearchParams({ contextKey: input.contextKey });
  return fetchJson<ChatDraftRecord | null>(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/draft?${params.toString()}`,
    { headers: chatDraftHeaders(input.userId) },
  );
};

export const upsertConversationDraft = async (
  projectId: string,
  input: UpsertConversationDraftInput,
): Promise<ChatDraftRecord | null> => {
  return fetchJson<ChatDraftRecord | null>(`/api/projects/${encodeURIComponent(projectId)}/conversations/draft`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...chatDraftHeaders(input.userId),
    },
    body: JSON.stringify({
      contextKey: input.contextKey,
      bodyMarkdown: input.bodyMarkdown,
    }),
  });
};

export const fetchConversationMessageHistory = async (
  projectId: string,
  input: { userId: string },
): Promise<ConversationMessageHistoryRecord[]> => {
  return fetchJson<ConversationMessageHistoryRecord[]>(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/message-history`,
    { headers: chatDraftHeaders(input.userId) },
  );
};

export const recordConversationMessageHistory = async (
  projectId: string,
  input: { userId: string; bodyMarkdown: string },
): Promise<ConversationMessageHistoryRecord> => {
  return fetchJson<ConversationMessageHistoryRecord>(`/api/projects/${encodeURIComponent(projectId)}/conversations/message-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...chatDraftHeaders(input.userId),
    },
    body: JSON.stringify({
      bodyMarkdown: input.bodyMarkdown,
    }),
  });
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

export const updateThreadRoute = async (
  threadId: string,
  input: UpdateConversationThreadRouteInput
): Promise<ChatThread> => {
  return fetchJson<ChatThread>(`/api/conversations/threads/${encodeURIComponent(threadId)}/route`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const compactThreadSession = async (threadId: string): Promise<ChatThread> => {
  return fetchJson<ChatThread>(`/api/conversations/threads/${encodeURIComponent(threadId)}/compact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
};

export const cancelThreadTurn = async (threadId: string): Promise<{ cancelled: boolean }> => {
  return fetchJson<{ cancelled: boolean }>(`/api/conversations/threads/${encodeURIComponent(threadId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
};

export const deleteConversationThread = async (threadId: string): Promise<void> => {
  await fetchJson<{ ok: true }>(`/api/conversations/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
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
