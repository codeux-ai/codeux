import type {
  AgentPresetRecord,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../../../src/contracts/agent-preset-types.js";
import type {
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
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
  UpdateMcpConnectionInput,
} from "../../../src/contracts/connection-chat-types.js";
import type {
  ExecutionHumanInterventionSummary,
  ExecutionUsageTotals,
  ExecutionUsageBucketSummary,
  ExecutionStatsEntitySummary,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../../src/contracts/app-types.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ImprovePromptInput,
  PlanningOverrides,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectStatus,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintMarkdownImportTask,
  SprintRecord,
  SprintStatus,
  TaskExecutorType,
  TaskPriority,
  TaskRecord,
  TaskStatus,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../../../src/contracts/project-management-types.js";

export type SourceStatus = ProjectStatus;
export type Source = ProjectSummary;
export type AgentConnection = McpConnectionRecord;
export type AgentPreset = AgentPresetRecord;
export type ChatThread = ConversationThreadRecord;
export type ChatMessageRecord = ConversationMessageRecord;

export interface Sprint extends SprintRecord {
  date: string;
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
  assignee: string;
  time: string;
  createdAt: string;
  promptMarkdown: string;
  description: string;
  dependsOnTaskIds: string[];
  isIndependent: boolean;
  isMerged: boolean;
  mergeIndicator: string | null;
}

export type {
  AgentPresetRecord,
  CreateProjectInput,
  CreateAgentPresetInput,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  CreateSprintInput,
  CreateTaskInput,
  ImprovePromptInput,
  PlanSprintOptions,
  PlanningOverrides,
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
  McpConnectionCapabilities,
  McpConnectionRecord,
  McpConnectionRole,
  McpConnectionStatus,
  PostListenReplyInput,
  PullInboxInput,
  ProjectCollectionResponse,
  ProjectStatus,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintMarkdownImportTask,
  SprintRecord,
  SprintStatus,
  StartListenInput,
  StartListenResponse,
  ExecutionHumanInterventionSummary,
  ExecutionUsageTotals,
  ExecutionUsageBucketSummary,
  ExecutionStatsEntitySummary,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
  UpdateConversationThreadInput,
  TaskExecutorType,
  TaskPriority,
  TaskRecord,
  TaskStatus,
  UpdateAgentPresetInput,
  UpdateMcpConnectionInput,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
};
