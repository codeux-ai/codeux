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
  workerCanSuperviseProjects?: boolean;
  workerCanExecuteTasks?: boolean;
  machineName?: string;
  platform?: string;
  arch?: string;
  localExecutionRuntime?: string;
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
  activeDispatchCount: number;
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
  projectIds?: string[];
  activeProjectIds?: string[];
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
  projectIds?: string[];
  activeProjectIds?: string[];
  transport?: string;
  capabilities?: McpConnectionCapabilities;
  includeTaskDispatch?: boolean;
  includeAttentionItems?: boolean;
  timeoutSeconds?: number;
  pollIntervalMs?: number;
}

export interface ListenContinuation {
  nextTool: "listen";
  instruction: string;
}

export interface ListenDashboardMessagePayload {
  id: string;
  threadId: string;
  projectId: string;
  bodyMarkdown: string;
}

export interface ListenProjectPayload {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch: string | null;
  featureBranch: string | null;
}

export interface ListenContextDigestPayload {
  activeSprintId: string | null;
  activeSprintName: string | null;
  activeSprintNumber: number | null;
  unresolvedAttentionCount: number;
  unresolvedAttentionTitles: string[];
  recentEventTypes: string[];
}

export interface ListenAttentionItemPayload {
  id: string;
  projectId: string;
  sprintId: string | null;
  taskId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  attentionType: string;
  severity: string;
  ownerType: string;
  status: string;
  assignedWorkerEndpointId: string | null;
  title: string;
  summaryMarkdown: string;
  payload: Record<string, unknown> | null;
  openedAt: string;
  updatedAt: string;
}

export interface ListenAssignmentChangedPayload {
  assignmentId: string;
  workerEndpointId: string | null;
  assignmentRole: string;
  status: string;
  assignedAt: string;
  updatedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  primaryAssignedWorkerEndpointId: string | null;
  overflowAssignedWorkerEndpointIds: string[];
}

export interface ListenTimeoutEvent {
  kind: "noop_timeout";
  continuation: ListenContinuation;
}

export interface ListenDashboardMessageEvent {
  kind: "dashboard_message";
  message: ListenDashboardMessagePayload;
  continuation: ListenContinuation;
}

export interface ListenTaskDispatchEvent {
  kind: "task_dispatch";
  dispatch: WorkerTaskDispatchClaim;
  continuation: ListenContinuation;
}

export interface ListenAttentionItemEvent {
  kind: "attention_item";
  item: ListenAttentionItemPayload;
  project: ListenProjectPayload;
  workingDirectoryHint: string;
  contextDigest: ListenContextDigestPayload;
  continuation: ListenContinuation;
}

export interface ListenAssignmentChangedEvent {
  kind: "assignment_changed";
  assignment: ListenAssignmentChangedPayload;
  project: ListenProjectPayload;
  workingDirectoryHint: string;
  contextDigest: ListenContextDigestPayload;
  continuation: ListenContinuation;
}

export interface PostListenReplyResult {
  threadId: string;
  deliveryStatus: ConversationDeliveryStatus;
}

export type ListenResponse =
  | ListenTimeoutEvent
  | ListenDashboardMessageEvent
  | ListenTaskDispatchEvent
  | ListenAttentionItemEvent
  | ListenAssignmentChangedEvent;
