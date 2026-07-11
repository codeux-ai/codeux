import type { WorkerTaskDispatchClaim } from "./execution-types.js";
import type { PlanningDesignGuidanceSelection } from "./project-management-types.js";

export type McpConnectionRole = "project_manager" | "worker" | "listener";
export type McpConnectionStatus = "connected" | "listening" | "idle" | "paused" | "stale" | "offline";
export type ConversationThreadScope = "project" | "connection";
export type ConversationThreadStatus = "open" | "closed";
export type ConversationMessageDirection = "dashboard_to_connection" | "connection_to_dashboard";
export type ConversationAuthorType = "dashboard_user" | "connection" | "system";
export type ConversationDeliveryStatus = "pending" | "delivered" | "processed" | "failed";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface PromptSuggestion extends JsonObject {
  id?: string;
  label: string;
  prompt: string;
  icon?: string;
}

export interface PromptSuggestionsMetadata extends JsonObject {
  promptSuggestions: PromptSuggestion[];
}

export type ConversationMessageMetadata = JsonObject;

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


import type { ManageCodeUxArgs } from "./internal-management-types.js";

export interface ConversationRuntimeState {
  routeKind?: string;
  workerEndpointId?: string;
  connectionId?: string;
  virtualProvider?: string;
  providerLabel?: string;
  modelLabel?: string;
  sessionIds?: string[];
  continuationStatus?: string;
  replayRequired?: boolean;
  compactionSummary?: ConversationCompactionSummary | null;
  pendingManagementAction?: {
    action: ManageCodeUxArgs;
    approvalMessage: string;
    proposedAt: string;
  } | null;
  createAppQuickaction?: DashboardCreateAppQuickactionRuntimeState | null;
}

export const DASHBOARD_CREATE_APP_QUICKACTION_KINDS = [
  "web_app",
  "desktop_app",
  "online_shop",
  "portfolio",
  "game",
] as const;
export type DashboardCreateAppQuickactionKind = typeof DASHBOARD_CREATE_APP_QUICKACTION_KINDS[number];

export const DASHBOARD_APP_PROGRESS_WIDGET_TYPE = "app_progress" as const;

export interface DashboardCreateAppQuickactionStackSummary extends JsonObject {
  techstackId?: string | null;
  techstackName?: string | null;
  applicationKind?: DashboardCreateAppQuickactionKind | null;
  language?: string | null;
  framework?: string | null;
  runtime?: string | null;
  packageManager?: string | null;
  styling?: string | null;
  testFramework?: string | null;
}

export interface DashboardCreateAppQuickactionPayload extends JsonObject {
  type: "create_app";
  kind: DashboardCreateAppQuickactionKind;
  requestId: string;
  templateId: string;
  designGuidance?: PlanningDesignGuidanceSelection & JsonObject;
  taskCount?: number;
  stackSummary?: DashboardCreateAppQuickactionStackSummary | null;
  suggestionTags?: string[];
}

export interface DashboardCreateAppQuickactionMetadata extends JsonObject {
  quickaction: DashboardCreateAppQuickactionPayload;
}

export type DashboardCreateAppQuickactionPlanningStatus = "running" | "completed" | "failed";

export interface DashboardCreateAppQueuedFollowUp {
  messageId: string;
  bodyMarkdown: string;
  createdAt: string;
}

export interface DashboardCreateAppQuickactionRuntimeState {
  activeSprintId: string;
  appKind: DashboardCreateAppQuickactionKind;
  planningStatus: DashboardCreateAppQuickactionPlanningStatus;
  queuedFollowUps: DashboardCreateAppQueuedFollowUp[];
  quickactionRequestId: string;
  clientRequestId: string;
  activePlanningRequestId?: string;
  progressMessageId?: string | null;
  planningError?: string | null;
  completedAt?: string;
  failedAt?: string;
}

export interface DashboardAppProgressPlanningStage extends JsonObject {
  id: "planning" | "plan" | "start" | "finish";
  label: "Planning" | "Plan" | "Start" | "Finish";
  status: "running" | "pending" | "completed" | "failed";
}

export interface DashboardAppProgressWidgetMetadata extends JsonObject {
  type: typeof DASHBOARD_APP_PROGRESS_WIDGET_TYPE;
  status: "running" | "completed" | "failed";
  appKind: DashboardCreateAppQuickactionKind;
  sprintId: string;
  sprintName: string;
  stackSummary?: DashboardCreateAppQuickactionStackSummary | null;
  planningStages: DashboardAppProgressPlanningStage[];
  suggestionTags: string[];
  quickactionRequestId: string;
  clientRequestId: string;
}

export interface ConversationCompactionSummary {
  markdown: string;
  generatedAt: string;
  provider: string;
  model: string;
  sourceMessageId: string | null;
  sourceMessageCount: number;
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
  runtimeState?: ConversationRuntimeState | null;
}

export interface ConversationMessageRecord {
  id: string;
  threadId: string;
  direction: ConversationMessageDirection;
  authorType: ConversationAuthorType;
  authorConnectionId: string | null;
  bodyMarkdown: string;
  deliveryStatus: ConversationDeliveryStatus;
  metadata?: ConversationMessageMetadata | null;
  createdAt: string;
}

export interface ConversationDraftRecord {
  userId: string;
  projectId: string;
  contextKey: string;
  bodyMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageHistoryRecord {
  id: string;
  userId: string;
  projectId: string;
  bodyMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInboxMessage {
  id: string;
  threadId: string;
  threadTitle: string;
  projectId: string;
  bodyMarkdown: string;
  metadata?: ConversationMessageMetadata | null;
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
  metadata?: ConversationMessageMetadata | null;
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
  runtimeState?: ConversationRuntimeState | null;
}

export interface CreateDashboardConversationMessageInput {
  threadId?: string;
  title?: string;
  connectionId?: string | null;
  bodyMarkdown: string;
  metadata?: ConversationMessageMetadata | DashboardCreateAppQuickactionMetadata | null;
}

export interface UpsertConversationDraftInput {
  userId: string;
  contextKey: string;
  bodyMarkdown: string;
}

export interface RecordConversationMessageHistoryInput {
  userId: string;
  bodyMarkdown: string;
}

export interface UpdateConversationThreadInput {
  title?: string;
  connectionId?: string | null;
  runtimeState?: ConversationRuntimeState | null;
}

export interface UpdateConversationThreadRouteInput {
  routeKind: "worker" | "virtual";
  virtualProvider?: string;
  virtualModel?: string;
  workerEndpointId?: string;
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
  metadata?: ConversationMessageMetadata | null;
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
