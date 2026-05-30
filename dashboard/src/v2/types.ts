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
} from "../../../src/contracts/invocation-types.js";
import type {
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
  ConversationRuntimeState,
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
  CustomMcpServer,
  CustomMcpTransport,
  McpToolToggle,
} from "../../../src/contracts/app-types.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  IssuePromptContext,
  IssuePromptContextInput,
  ImprovePromptInput,
  PlanningOverrides,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  ProjectStatus,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
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
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  SchedulerOccurrence,
  ScheduleRecurrenceRule,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
} from "../../../src/contracts/scheduler-types.js";

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
  mergeIndicator: string | null;
  isOptimistic?: boolean;
}

export type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
  LocalDirectoryBrowserEntry,
  LocalDirectoryBrowserResponse,
  AgentAvatarConfig,
  AgentMcpAccessConfig,
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
  PlanSprintOptions,
  PlanningOverrides,
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
  ConversationRuntimeState,
  McpConnectionCapabilities,
  McpConnectionRecord,
  McpConnectionRole,
  McpConnectionStatus,
  PostListenReplyInput,
  PullInboxInput,
  ProjectCollectionResponse,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  ProjectStatus,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
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
  CreateSchedulerEntryInput,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  SchedulerOccurrence,
  ScheduleRecurrenceRule,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
};

export type { SprintReviewSummary };
