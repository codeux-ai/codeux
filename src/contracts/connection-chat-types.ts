import type { WorkerTaskDispatchClaim } from "./execution-types.js";

export type McpConnectionRole = "project_manager" | "worker" | "listener";
export type McpConnectionStatus = "connected" | "listening" | "idle" | "paused" | "stale" | "offline";
export type ConversationThreadScope = "project" | "connection";
export type ConversationThreadStatus = "open" | "closed";
export type ConversationMessageDirection = "dashboard_to_connection" | "connection_to_dashboard";
export type ConversationAuthorType = "dashboard_user" | "connection" | "system";
export type ConversationDeliveryStatus = "pending" | "delivered" | "processed" | "failed";

export interface McpConnectionCapabilities {
  instruction?: string;
  model?: string;
  labels?: string[];
  listenMode?: boolean;
  [key: string]: unknown;
}

export interface McpConnectionRecord {
  id: string;
  connectionKey: string;
  displayName: string;
  role: McpConnectionRole;
  transport: string;
  status: McpConnectionStatus;
  capabilities: McpConnectionCapabilities;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectIds: string[];
  activeProjectIds: string[];
  tasksRunCount: number;
  threadCount: number;
  messageCount: number;
  pendingInboxCount: number;
}

export interface ConversationThreadRecord {
  id: string;
  projectId: string;
  connectionId: string | null;
  scope: ConversationThreadScope;
  title: string;
  status: ConversationThreadStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pendingMessageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface ConversationMessageRecord {
  id: string;
  threadId: string;
  direction: ConversationMessageDirection;
  authorType: ConversationAuthorType;
  authorConnectionId: string | null;
  bodyMarkdown: string;
  deliveryStatus: ConversationDeliveryStatus;
  createdAt: string;
}

export interface ConnectionInboxMessage {
  id: string;
  threadId: string;
  threadTitle: string;
  projectId: string;
  bodyMarkdown: string;
  createdAt: string;
  deliveryStatus: ConversationDeliveryStatus;
}

export interface StartListenInput {
  connectionKey: string;
  displayName?: string;
  role?: McpConnectionRole;
  projectId?: string;
  transport?: string;
  capabilities?: McpConnectionCapabilities;
  maxMessages?: number;
}

export interface PullInboxInput {
  connectionKey: string;
  projectId?: string;
  maxMessages?: number;
}

export interface PostListenReplyInput {
  connectionKey: string;
  threadId: string;
  bodyMarkdown: string;
  replyToMessageId?: string;
}

export interface UpsertMcpConnectionInput {
  connectionKey: string;
  displayName: string;
  role: McpConnectionRole;
  transport: string;
  status: McpConnectionStatus;
  capabilities?: McpConnectionCapabilities;
  projectIds?: string[];
  activeProjectIds?: string[];
}

export interface UpdateMcpConnectionInput {
  displayName?: string;
  role?: McpConnectionRole;
  status?: McpConnectionStatus;
  capabilities?: McpConnectionCapabilities;
  activeProjectIds?: string[];
}

export interface CreateConversationThreadInput {
  title: string;
  connectionId?: string | null;
  scope?: ConversationThreadScope;
}

export interface CreateDashboardConversationMessageInput {
  threadId?: string;
  title?: string;
  connectionId?: string | null;
  bodyMarkdown: string;
}

export interface UpdateConversationThreadInput {
  connectionId?: string | null;
}

export interface StartListenResponse {
  connection: McpConnectionRecord;
  inbox: ConnectionInboxMessage[];
}

export interface ListenInput {
  connectionKey: string;
  displayName?: string;
  role?: McpConnectionRole;
  projectId?: string;
  transport?: string;
  capabilities?: McpConnectionCapabilities;
  includeTaskDispatch?: boolean;
  timeoutSeconds?: number;
  pollIntervalMs?: number;
}

export interface ListenContinuation {
  nextTool: "listen";
  connectionKey: string;
  instruction: string;
}

export interface ListenTimeoutEvent {
  kind: "noop_timeout";
  connection: McpConnectionRecord;
  timeoutSeconds: number;
  pollIntervalMs: number;
  continuation: ListenContinuation;
}

export interface ListenDashboardMessageEvent {
  kind: "dashboard_message";
  connection: McpConnectionRecord;
  timeoutSeconds: number;
  pollIntervalMs: number;
  message: ConnectionInboxMessage;
  continuation: ListenContinuation;
}

export interface ListenTaskDispatchEvent {
  kind: "task_dispatch";
  connection: McpConnectionRecord;
  timeoutSeconds: number;
  pollIntervalMs: number;
  dispatch: WorkerTaskDispatchClaim;
  continuation: ListenContinuation;
}

export type ListenResponse =
  | ListenTimeoutEvent
  | ListenDashboardMessageEvent
  | ListenTaskDispatchEvent;
