import type { ProviderId } from "./app-types.js";
import type { AgentMcpAccessConfig } from "./agent-preset-types.js";
import type {
  ChatProviderBridgeMode,
  ChatProviderConnectionStatus,
  ChatProviderDeliveryStatus,
  ChatProviderKind,
  ChatProviderSetupConfig,
  ChatProviderSecretConfig,
  ChatProviderRoutingHints,
  ExternalChannelMetadata,
} from "./chat-provider-types.js";
import type { NodeFlowGraph, NodeFlowJsonObject, NodeWidgetSchema } from "./node-flow-types.js";
import type { CreateProjectInput } from "./project-management-types.js";

export interface ManagementApproval {
  confirmed: boolean;
}

export interface ManagementRequestEnvelope {
  domain: string;
  action: string;
  payload: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManageCodeUxArgs extends ManagementRequestEnvelope {}

export interface ManageProjectsArgs extends Partial<CreateProjectInput> {
  action: "list" | "get" | "create" | "update" | "select" | "setup" | "delete";
  projectId?: string;
  description?: string;
  approval?: ManagementApproval;
}

export interface ManageSprintsArgs {
  action: "list" | "get" | "create" | "update" | "delete" | "start" | "pause" | "cancel" | "force_cancel" | "inspect_run" | "import_issues" | "plan";
  projectId?: string;
  sprintId?: string;
  sprintRunId?: string;
  name?: string;
  title?: string;
  goal?: string;
  goalMarkdown?: string;
  originalPrompt?: string;
  status?: string;
  showcasePinned?: boolean;
  agentPresetId?: string;
  planningAgentPresetId?: string;
  autoStart?: boolean;
  replan?: boolean;
  search?: string;
  provider?: "github" | "gitlab" | "jira";
  repository?: string;
  hostDomain?: string;
  projectKey?: string;
  state?: "open" | "closed" | "all";
  labels?: string[];
  assignee?: string;
  assigneeText?: string;
  issueKeys?: string[];
  issueNumbers?: number[];
  issueRefs?: string[];
  includeConversation?: boolean;
  attachToSprint?: boolean;
  planAfterImport?: boolean;
  limit?: number;
  overrides?: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManageTasksArgs {
  action: "list" | "get" | "create" | "update" | "delete" | "start" | "stop" | "force_stop" | "pause" | "inspect_run";
  projectId?: string;
  sprintId?: string;
  taskId?: string;
  taskKey?: string;
  name?: string;
  title?: string;
  promptMarkdown?: string;
  description?: string;
  status?: string;
  priority?: string;
  executorType?: string;
  agentPresetId?: string | null;
  model?: string | null;
  sortOrder?: number;
  dependsOnTaskIds?: string[];
  isIndependent?: boolean;
  isMerged?: boolean;
  provider?: string;
  approval?: ManagementApproval;
}

export interface ManageQuicksprintsArgs {
  action: "list_templates" | "get_template" | "create_template" | "update_template" | "delete_template" | "execute" | "start";
  projectId?: string;
  templateId?: string;
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  categoryColor?: string;
  agentInstructionMarkdown?: string;
  defaultTaskCount?: number | string;
  taskCount?: number | string;
  noTaskLimit?: boolean;
  submitMode?: "plan_only" | "plan_and_start";
  routeOverride?: string;
  modelOverride?: string;
  planningOverrides?: Record<string, unknown>;
  agentPresetId?: string;
  additionalPrompt?: string;
  approval?: ManagementApproval;
}

export interface ManageSchedulerArgs {
  action: "list" | "create" | "schedule_sprint" | "schedule_quicksprint" | "schedule_chat" | "schedule_node_flow" | "update" | "delete" | "run_due";
  projectId?: string;
  entryId?: string;
  from?: string;
  to?: string;
  title?: string;
  targetType?: "sprint" | "quicksprint" | "chat" | "node_flow";
  status?: "scheduled" | "paused" | "completed" | "failed" | "cancelled";
  scheduledFor?: string;
  timezone?: string;
  recurrence?: Record<string, unknown>;
  sprintTarget?: Record<string, unknown>;
  quicksprintTarget?: Record<string, unknown>;
  chatTarget?: Record<string, unknown>;
  nodeFlowTarget?: Record<string, unknown>;
  sprintId?: string;
  templateId?: string;
  taskCount?: number | string;
  submitMode?: "plan_only" | "plan_and_start";
  additionalPrompt?: string;
  agentPresetId?: string;
  planningOverrides?: Record<string, unknown>;
  bodyMarkdown?: string;
  threadId?: string | null;
  connectionId?: string | null;
  flowId?: string;
  input?: Record<string, unknown>;
  flowVersion?: number | string;
  now?: string;
  approval?: ManagementApproval;
}

export interface SchedulerArgs {
  action: "list" | "schedule_wakeup" | "schedule_task" | "cancel";
  projectId?: string;
  entryId?: string;
  from?: string;
  to?: string;
  scheduledFor?: string;
  delaySeconds?: number | string;
  delayMinutes?: number | string;
  title?: string;
  timezone?: string;
  bodyMarkdown?: string;
  threadId?: string | null;
  connectionId?: string | null;
  taskId?: string;
  provider?: ProviderId;
}

export interface ManageAgentsArgs {
  action: "list" | "get" | "sync" | "create" | "update" | "delete";
  projectId?: string;
  presetId?: string;
  name?: string;
  description?: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: Record<string, unknown>;
  providerConfigId?: string | null;
  model?: string | null;
  memoryConfig?: Record<string, unknown>;
  mcpAccess?: AgentMcpAccessConfig;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  approval?: ManagementApproval;
}

export interface ManageNodeFlowsArgs {
  action: "list" | "get" | "create" | "update" | "delete" | "validate" | "run" | "list_runs" | "get_run" | "attach_to_agent" | "detach_from_agent";
  projectId?: string;
  flowId?: string;
  runId?: string;
  name?: string;
  description?: string;
  graph?: NodeFlowGraph;
  widgets?: NodeWidgetSchema | Record<string, NodeWidgetSchema>;
  input?: NodeFlowJsonObject;
  agentPresetId?: string;
  skillAlias?: string;
  approval?: ManagementApproval;
}

export interface ManageMemoryArgs {
  action: "search" | "list" | "get" | "create" | "update" | "delete" | "promote" | "start_reembed" | "get_map" | "count" | "model_status" | "create_claim" | "list_claims" | "get_claim" | "update_claim" | "add_claim_evidence" | "deprecate_claim";
  projectId?: string;
  memoryId?: string;
  claimId?: string;
  query?: string;
  scope?: string;
  sprintId?: string;
  agentPresetId?: string;
  limit?: number;
  minSimilarity?: number;
  content?: string;
  claim?: string;
  category?: string;
  strength?: number;
  confidence?: number;
  durability?: number;
  status?: string;
  tags?: string[];
  appliesToPaths?: string[];
  sourceMemoryId?: string;
  supersedesClaimId?: string | null;
  supportType?: string;
  weight?: number;
  evidenceWeight?: number;
  memoryIds?: string[];
  reason?: string;
  topKPerNode?: number;
  approval?: ManagementApproval;
}

export interface ManageSkillsArgs {
  action:
    | "authoring_prompt"
    | "list_storages"
    | "get_storage"
    | "create_storage"
    | "update_storage"
    | "delete_storage"
    | "reset_storage"
    | "list_agent_storages"
    | "attach_storage"
    | "detach_storage"
    | "list_skills"
    | "get_skill"
    | "create_skill"
    | "update_skill"
    | "delete_skill"
    | "import_markdown"
    | "export_markdown";
  projectId?: string;
  storageId?: string;
  skillId?: string;
  agentPresetId?: string;
  name?: string;
  description?: string;
  storageKind?: string;
  markdown?: string;
  sourceType?: string;
  sourceRef?: string | null;
  limit?: number;
  includeContent?: boolean;
  approval?: ManagementApproval;
}

export interface SearchSkillsArgs {
  projectId: string;
  query: string;
  agentPresetId?: string;
  storageId?: string;
  limit?: number;
  minSimilarity?: number;
}

export interface ManageSettingsArgs {
  action: "get_system" | "get_project_override" | "resolve_project_effective" | "get_sprint_override" | "resolve_sprint_effective" | "replace_system_settings" | "patch_system_setting" | "replace_project_settings" | "patch_project_setting" | "reset_project_settings" | "replace_sprint_settings" | "patch_sprint_setting" | "reset_sprint_settings" | "export_settings_bundle" | "apply_settings_bundle";
  projectId?: string;
  sprintId?: string;
  path?: string;
  value?: unknown;
  settings?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  includeSecrets?: boolean;
  scopes?: string[];
  approval?: ManagementApproval;
}

export interface ManagePreviewArgs {
  action: "list_sessions" | "start_session" | "rebuild_session" | "stop_session" | "remove_session" | "get_script" | "get_logs" | "get_url";
  projectId?: string;
  sprintId?: string;
  sessionId?: string;
  path?: string;
  approval?: ManagementApproval;
}

export type ManageChatProvidersAction =
  | "list_provider_definitions"
  | "list_connections"
  | "get_connection"
  | "create_connection"
  | "update_connection"
  | "delete_connection"
  | "list_channel_bindings"
  | "create_channel_binding"
  | "update_channel_binding"
  | "delete_channel_binding"
  | "list_outbound_deliveries";

export interface ManageChatProvidersArgs {
  action: ManageChatProvidersAction;
  providerKind?: ChatProviderKind;
  providerConnectionId?: string;
  connectionId?: string;
  displayName?: string;
  bridgeMode?: ChatProviderBridgeMode;
  status?: ChatProviderConnectionStatus;
  enabled?: boolean;
  enabledOnly?: boolean;
  setup?: ChatProviderSetupConfig;
  secrets?: ChatProviderSecretConfig | null;
  channelBindingId?: string;
  bindingId?: string;
  externalChannelId?: string;
  externalChannelName?: string;
  externalChannelMetadata?: ExternalChannelMetadata | null;
  projectId?: string;
  projectIds?: string[];
  agentPresetId?: string | null;
  routingHints?: ChatProviderRoutingHints | null;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  suppressRichWidgets?: boolean;
  deliveryStatus?: ChatProviderDeliveryStatus;
  limit?: number | string;
  baseUrl?: string;
  approval?: ManagementApproval;
}

export interface ManageTelemetryArgs {
  action: "get_project_execution_snapshot" | "get_project_stats_snapshot" | "list_sprint_runs" | "list_task_dispatches" | "list_execution_invocations" | "list_execution_invocation_messages";
  projectId?: string;
  sprintId?: string;
  taskId?: string;
  invocationId?: string;
  type?: string;
}

export interface SearchKnowledgeArgs {
  query: string;
  limit?: number;
  minSimilarity?: number;
}

export interface ManagementResponseEnvelope {
  approvalRequired?: boolean;
  approvalMessage?: string;
  result?: unknown;
}
