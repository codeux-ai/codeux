import type {
  AgentAvatarConfig,
  AgentMcpAccessConfig,
  AgentPresetRecord,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../../../src/contracts/agent-preset-types.js";
import type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
  ProjectInvocationsQuery,
  ProjectInvocationsQueryResult,
  ExecutionInvocationStatus,
} from "../../../src/contracts/invocation-types.js";
import type {
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
  ConversationRuntimeState,
  DashboardCreateAppQuickactionKind,
  DashboardCreateAppQuickactionMetadata,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  McpConnectionCapabilities,
  McpConnectionRecord,
  McpConnectionRole,
  McpConnectionStatus,
  PostListenReplyInput,
  PullInboxInput,
  StartListenInput,
  StartListenResponse,
  UpdateConversationThreadInput,
  UpdateConversationThreadRouteInput,
  UpdateMcpConnectionInput,
} from "../../../src/contracts/connection-chat-types.js";
import type {
  ExecutionHumanInterventionSummary,
  ExecutionUsageTotals,
  ExecutionUsageBucketSummary,
  ExecutionStatsEntitySummary,
  HeaderTokenThroughputProjectSnapshot,
  HeaderTokenThroughputQuery,
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputTotals,
  HeaderTokenThroughputWindow,
  ExecutionInvocationStatusCounts,
  ExecutionDurationStats,
  ExecutionModelStatsSummary,
  ExecutionConnectionSummary,
  ExecutionGitMetrics,
  ExecutionGitStatsBucketSummary,
  ExecutionGitStatsEntitySummary,
  ExecutionGitStatsSummary,
  ProjectExecutionStatsChartSeries,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
  ProviderId,
  AgentRoutingMode,
  VirtualWorkerProvider,
  LocalDirectoryBrowserEntry,
  LocalDirectoryBrowserResponse,
  LocalFileBrowserEntry,
  LocalFileBrowserResponse,
  CustomMcpServer,
  CustomMcpTransport,
  McpToolToggle,
  SkillStorageKind,
  SkillStorageRecord,
  AgentSkillStorageAttachment,
  ExternalImporterProvider,
  ExternalImporterSettings,
} from "../../../src/contracts/app-types.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  IssuePromptContext,
  IssuePromptContextInput,
  ImprovePromptInput,
  LinkedIssueProvider,
  PlanningOverrides,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectSetupOptions,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  ProjectStatus,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintImportedTaskInput,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
  SprintCollectionResponse,
  SprintMarkdownImportTask,
  SprintRecord,
  SprintReviewSummary,
  SprintStatus,
  TaskExecutorType,
  TaskPriority,
  TaskRecord,
  TaskStatus,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../../../src/contracts/project-management-types.js";
import type {
  CreateSchedulerEntryInput,
  MemoryRemediationScheduleResponse,
  MemoryRemediationScheduleSettings,
  MemoryRemediationScheduleCadence,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  SchedulerOccurrence,
  ScheduleAnchor,
  ScheduleRecurrenceRule,
  ScheduleStatus,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
} from "../../../src/contracts/scheduler-types.js";
import type {
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowEdge,
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonPrimitive,
  NodeFlowJsonValue,
  NodeFlowListResponse,
  NodeFlowNode,
  NodeFlowNodePosition,
  NodeFlowNodeRunListResponse,
  NodeFlowNodeRunRecord,
  NodeFlowNodeRunStatus,
  NodeFlowRecord,
  NodeFlowRunListResponse,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  NodeFlowRunStatus,
  NodeFlowSkillAttachment,
  NodeFlowValidationIssue,
  NodeFlowValidationResponse,
  NodeFlowVersionRecord,
  NodeWidgetField,
  NodeWidgetFieldType,
  NodeWidgetSchema,
  NodeWidgetSelectOption,
  UpdateNodeFlowInput,
} from "../../../src/contracts/node-flow-types.js";
import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardFileBundleEntry,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardStatus,
  CustomDashboardValidationReport,
  CustomDashboardValidationSessionRecord,
  CustomDashboardValidationStatus,
  UpdateCustomDashboardDraftInput,
} from "../../../src/contracts/custom-dashboard-types.js";
import type {
  TokenUsageSource,
} from "../../../src/contracts/execution-types.js";
import type {
  ChatProviderBridgeMode,
  ChatProviderBridgeSetupSchema,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionRecord,
  ChatProviderConnectionStatus,
  ChatProviderDeliveryDirection,
  ChatProviderDeliveryStatus,
  ChatProviderKind,
  ChatProviderMessageDeliveryRecord,
  ChatProviderSecretConfig,
  ChatProviderSecretFieldSchema,
  ChatProviderSetupConfig,
  ChatProviderSetupFieldSchema,
  ChatProviderSetupSchema,
  CreateChatProviderChannelBindingInput,
  CreateChatProviderConnectionInput,
  RedactedCredentialField,
  UpdateChatProviderChannelBindingInput,
  UpdateChatProviderConnectionInput,
} from "../../../src/contracts/chat-provider-types.js";
import type { TaskSelfReflectionRating } from "../../../src/contracts/task-self-reflection-types.js";
import type {
  ExternalTranscriptionSettings,
  SpeechProviderMode,
  SpeechSettings,
  SpeechTranscriptionError,
  SpeechTranscriptionErrorCode,
  SpeechTranscriptionProvider,
  SpeechTranscriptionRequestMetadata,
  SpeechTranscriptionResult,
} from "../../../src/contracts/speech-types.js";

export interface SegmentDefinition {
  label: string;
  value: number;
  color: string;
  textClassName: string;
}

export type SourceStatus = ProjectStatus;
export type Source = ProjectSummary;
export type AgentConnection = McpConnectionRecord;
export type AgentPreset = AgentPresetRecord;
export type ChatThread = ConversationThreadRecord;
export type ChatMessageRecord = ConversationMessageRecord;
export type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardFileBundleEntry,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardStatus,
  CustomDashboardValidationReport,
  CustomDashboardValidationSessionRecord,
  CustomDashboardValidationStatus,
  UpdateCustomDashboardDraftInput,
};

export type ProjectCardSourceBadgeKind = "local" | "remote-git" | "local-repository";
export type ProjectCardActionKind = "open-project" | "settings" | "setup-project" | "delete";
export type ProjectCardActionTone = "default" | "danger";

export interface ProjectCardDisplayValue {
  value: string;
  isEmpty: boolean;
}

export interface ProjectCardSourceBadge {
  kind: ProjectCardSourceBadgeKind;
  label: string;
  description: string;
}

export interface ProjectCardActionDescriptor {
  kind: ProjectCardActionKind;
  label: string;
  ariaLabel: string;
  title: string;
  tone: ProjectCardActionTone;
}

export interface ProjectCardTaskCompletion {
  value: string;
  percentage: number | null;
  completedTasks: number;
  openTasks: number;
  totalTasks: number;
  isEmpty: boolean;
}

export interface ProjectCardViewModel {
  sourceBadge: ProjectCardSourceBadge;
  sourceTypeLabel: string;
  providerLabel: ProjectCardDisplayValue;
  hostLabel: ProjectCardDisplayValue;
  gitUrl: ProjectCardDisplayValue;
  localDirectory: ProjectCardDisplayValue;
  createdAt: ProjectCardDisplayValue;
  updatedAt: ProjectCardDisplayValue;
  lastRunAt: ProjectCardDisplayValue;
  lastRunStatus: ProjectCardDisplayValue;
  branch: ProjectCardDisplayValue;
  featureBranchPrefix: ProjectCardDisplayValue;
  taskCompletion: ProjectCardTaskCompletion;
  emptyValue: string;
  actions: ProjectCardActionDescriptor[];
}

export interface Sprint extends SprintRecord {
  date: string;
  latestReview?: SprintReviewSummary;
}

export interface Task {
  recordId: string;
  id: string;
  source: string;
  sprint: string;
  sprintId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType: TaskExecutorType;
  agentPresetId?: string | null;
  assignee: string;
  time: string;
  createdAt: string;
  updatedAt: string;
  promptMarkdown: string;
  description: string;
  dependsOnTaskIds: string[];
  isIndependent: boolean;
  isMerged: boolean;
  latestReview?: SprintReviewSummary;
  selfReflectionRating?: TaskSelfReflectionRating;
  mergeIndicator: string | null;
  isOptimistic?: boolean;
}

export type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
  ExecutionInvocationStatus,
  LocalDirectoryBrowserEntry,
  LocalDirectoryBrowserResponse,
  LocalFileBrowserEntry,
  LocalFileBrowserResponse,
  AgentAvatarConfig,
  AgentMcpAccessConfig,
  ExternalImporterProvider,
  ExternalImporterSettings,
  AgentPresetRecord,
  CreateProjectInput,
  CreateAgentPresetInput,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  CreateSprintInput,
  CreateTaskInput,
  IssuePromptContext,
  IssuePromptContextInput,
  ImprovePromptInput,
  LinkedIssueProvider,
  PlanSprintOptions,
  PlanningOverrides,
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
  ConversationRuntimeState,
  DashboardCreateAppQuickactionKind,
  DashboardCreateAppQuickactionMetadata,
  McpConnectionCapabilities,
  McpConnectionRecord,
  McpConnectionRole,
  McpConnectionStatus,
  PostListenReplyInput,
  PullInboxInput,
  ProjectCollectionResponse,
  ProjectSetupOptions,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  ProjectStatus,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintImportedTaskInput,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
  SprintCollectionResponse,
  SprintMarkdownImportTask,
  SprintRecord,
  SprintStatus,
  StartListenInput,
  StartListenResponse,
  ExecutionHumanInterventionSummary,
  ExecutionUsageTotals,
  ExecutionUsageBucketSummary,
  ExecutionStatsEntitySummary,
  HeaderTokenThroughputProjectSnapshot,
  HeaderTokenThroughputQuery,
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputTotals,
  HeaderTokenThroughputWindow,
  ExecutionInvocationStatusCounts,
  ExecutionDurationStats,
  ExecutionModelStatsSummary,
  TokenUsageSource,
  ExecutionConnectionSummary,
  ExecutionGitMetrics,
  ExecutionGitStatsBucketSummary,
  ExecutionGitStatsEntitySummary,
  ExecutionGitStatsSummary,
  ProjectExecutionStatsChartSeries,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
  UpdateConversationThreadInput,
  UpdateConversationThreadRouteInput,
  TaskExecutorType,
  TaskPriority,
  TaskRecord,
  TaskStatus,
  UpdateAgentPresetInput,
  UpdateMcpConnectionInput,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
  ProviderId,
  AgentRoutingMode,
  VirtualWorkerProvider,
  CustomMcpServer,
  CustomMcpTransport,
  McpToolToggle,
  SkillStorageKind,
  SkillStorageRecord,
  AgentSkillStorageAttachment,
  CreateSchedulerEntryInput,
  MemoryRemediationScheduleResponse,
  MemoryRemediationScheduleSettings,
  MemoryRemediationScheduleCadence,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  SchedulerOccurrence,
  ScheduleAnchor,
  ScheduleRecurrenceRule,
  ScheduleStatus,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
  ChatProviderBridgeMode,
  ChatProviderBridgeSetupSchema,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionRecord,
  ChatProviderConnectionStatus,
  ChatProviderDeliveryDirection,
  ChatProviderDeliveryStatus,
  ChatProviderKind,
  ChatProviderMessageDeliveryRecord,
  ChatProviderSecretConfig,
  ChatProviderSecretFieldSchema,
  ChatProviderSetupConfig,
  ChatProviderSetupFieldSchema,
  ChatProviderSetupSchema,
  CreateChatProviderChannelBindingInput,
  CreateChatProviderConnectionInput,
  RedactedCredentialField,
  UpdateChatProviderChannelBindingInput,
  UpdateChatProviderConnectionInput,
  ExternalTranscriptionSettings,
  SpeechProviderMode,
  SpeechSettings,
  SpeechTranscriptionError,
  SpeechTranscriptionErrorCode,
  SpeechTranscriptionProvider,
  SpeechTranscriptionRequestMetadata,
  SpeechTranscriptionResult,
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowEdge,
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonPrimitive,
  NodeFlowJsonValue,
  NodeFlowListResponse,
  NodeFlowNode,
  NodeFlowNodePosition,
  NodeFlowNodeRunListResponse,
  NodeFlowNodeRunRecord,
  NodeFlowNodeRunStatus,
  NodeFlowRecord,
  NodeFlowRunListResponse,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  NodeFlowRunStatus,
  NodeFlowSkillAttachment,
  NodeFlowValidationIssue,
  NodeFlowValidationResponse,
  NodeFlowVersionRecord,
  NodeWidgetField,
  NodeWidgetFieldType,
  NodeWidgetSchema,
  NodeWidgetSelectOption,
  UpdateNodeFlowInput,
};

export type { SprintReviewSummary };

export type { ProjectInvocationsQuery, ProjectInvocationsQueryResult };
