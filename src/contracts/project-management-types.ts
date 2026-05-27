import type { AgentRoutingMode, VirtualWorkerProvider } from "./app-types.js";
import type { ProjectSettingsOverride } from "./settings-scope-types.js";
import type { ProjectWorkerAssignmentRecord } from "./worker-types.js";

export type ProjectStatus = "running" | "failed" | "intervention" | "idle";
export type ProjectSourceType = "local" | "git";
export type SprintStatus = "running" | "paused" | "completed" | "failed" | "cancelled" | "idle";
export type TaskStatus = "pending" | "in_progress" | "coding_completed" | "completed" | "QA_REVIEW_FAILED";
export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskExecutorType = "auto" | "docker_cli" | "jules";
export type GitProvider = "github" | "gitlab" | "local";

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  baseDir: string;
  repoUrl: string | null;
  sourceType: ProjectSourceType;
  sourceRef: string;
  gitProvider: GitProvider;
  gitHostDomain: string | null;
  defaultBranch: string | null;
  featureBranchPrefix: string | null;
  status: ProjectStatus;
  sprintsCount: number;
  openTasks: number;
  completedTasks: number;
  isRunning: boolean;
  settingsOverrides: ProjectSettingsOverride;
  agentBindings: ProjectWorkerAssignmentRecord[];
  createdAt: string;
  updatedAt: string;
}


export interface SprintReviewSummary {
  status: string;
  outcome: string | null;
  summary: string | null;
  findings: string[];
  reviewer: string | null;
  finishedAt: string | null;
}

export type LinkedIssueProvider = "github" | "gitlab" | "jira";
export type LinkedIssueCloseState = "open" | "closed" | "close_failed";

export interface SprintLinkedIssueRecord {
  id: string;
  projectId: string;
  sprintId: string;
  provider: LinkedIssueProvider;
  hostDomain: string;
  projectKey?: string;
  repository: string;
  issueNumber: number;
  issueKey: string;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  importedAt: string;
  closedAt: string | null;
  closeState: LinkedIssueCloseState;
  closeError: string | null;
  updatedAt: string;
}

export interface SprintLinkedIssueInput {
  provider: LinkedIssueProvider;
  hostDomain: string;
  projectKey?: string;
  repository: string;
  issueNumber: number;
  issueKey?: string;
  title: string;
  url: string;
  state?: string;
  labels?: string[];
  assignees?: string[];
  issueBodyMarkdown?: string;
  issueConversationMarkdown?: string;
  includeConversation?: boolean;
  issueAuthor?: string | null;
  issueCreatedAt?: string | null;
  issueUpdatedAt?: string | null;
}

export interface IssuePromptContextInput extends SprintLinkedIssueInput {
  includeConversation?: boolean;
}

export interface IssuePromptContext extends SprintLinkedIssueInput {
  issueBodyMarkdown: string;
  issueConversationMarkdown: string;
  includeConversation: boolean;
  issueAuthor: string | null;
  issueCreatedAt: string | null;
  issueUpdatedAt: string | null;
}

export interface SprintRecord {
  id: string;
  projectId: string;
  number: number | null;
  slug: string;
  name: string;
  originalPrompt: string | null;
  goal: string;
  status: SprintStatus;
  showcasePinned: boolean;
  startDate: string | null;
  endDate: string | null;
  featureBranch: string | null;
  tasksCount: number;
  completion: number;
  linkedIssues: SprintLinkedIssueRecord[];
  latestReview?: SprintReviewSummary;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  sprintId: string;
  taskKey: string;
  title: string;
  promptMarkdown: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType: TaskExecutorType;
  agentPresetId: string | null;
  sortOrder: number;
  dependsOnTaskIds: string[];
  isIndependent: boolean;
  isMerged: boolean;
  qa_review?: {
    error_reason?: string;
    [key: string]: any;
  };
  mergeIndicator: string | null;
  sourceType: string | null;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintCollectionResponse {
  sprints: SprintRecord[];
  selectedSprintId: string | null;
}

export interface ProjectCollectionResponse {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
}

export interface CreateProjectInput {
  name: string;
  sourceType: ProjectSourceType;
  sourceRef: string;
  cloneDir?: string;
  setup?: ProjectSetupRequestInput;
  defaultBranch?: string;
  featureBranchPrefix?: string;
  status?: ProjectStatus;
}

export interface UpdateProjectInput {
  name?: string;
  sourceType?: ProjectSourceType;
  sourceRef?: string;
  baseDir?: string;
  defaultBranch?: string | null;
  featureBranchPrefix?: string | null;
  status?: ProjectStatus;
}

export interface CreateSprintInput {
  name: string;
  originalPrompt?: string | null;
  goal?: string;
  linkedIssues?: SprintLinkedIssueInput[];
  number?: number | null;
  slug?: string;
  status?: SprintStatus;
  showcasePinned?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  featureBranch?: string | null;
}

export interface UpdateSprintInput {
  name?: string;
  originalPrompt?: string | null;
  goal?: string;
  linkedIssues?: SprintLinkedIssueInput[];
  number?: number | null;
  slug?: string;
  status?: SprintStatus;
  showcasePinned?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  featureBranch?: string | null;
}

export interface PlanningOverrides {
  workerId?: string;
  virtualProvider?: VirtualWorkerProvider;
  virtualModel?: string;
  planningAgentPresetId?: string;
  agentRoutingMode?: AgentRoutingMode;
  workerAgentPresetId?: string;
}

export interface ImprovePromptInput {
  name: string;
  goal: string;
  clientRequestId?: string;
  planningAgentPresetId?: string;
  overrides?: PlanningOverrides;
}

export interface PlanSprintOptions {
  sprintRunId?: string;
  autoStart: boolean;
  replan?: boolean;
  clientRequestId?: string;
  planningAgentPresetId?: string;
  quicksprintTemplateId?: string;
  overrides?: PlanningOverrides;
}

export interface ProjectSetupOptions {
  agents: boolean;
  quicksprints: boolean;
  previewScript: boolean;
  ci: boolean;
}

export interface ProjectSetupRequestInput {
  enabled?: boolean;
  options?: Partial<ProjectSetupOptions>;
  clientRequestId?: string;
}

export interface ProjectSetupAgentArtifact {
  name: string;
  description: string;
  instructionMarkdown: string;
  labels?: string[];
}

export interface ProjectSetupQuicksprintArtifact {
  name: string;
  description: string;
  icon?: string;
  category?: string;
  categoryColor?: string;
  agentInstructionMarkdown: string;
  defaultTaskCount?: number;
}

export interface ProjectSetupCiArtifact {
  provider: "github" | "gitlab";
  path: string;
  content: string;
}

export interface ProjectSetupArtifactPayload {
  summary: string;
  agents?: ProjectSetupAgentArtifact[];
  quicksprints?: ProjectSetupQuicksprintArtifact[];
  previewScript?: {
    path?: string;
    content: string;
  } | null;
  ci?: ProjectSetupCiArtifact[];
}

export interface ProjectSetupResult {
  ok: true;
  projectId: string;
  invocationId: string;
  agentId: string;
  summary: string;
  createdAgentIds: string[];
  createdQuicksprintTemplateIds: string[];
  writtenFiles: string[];
}

export interface ProjectSetupStartResult {
  accepted: true;
  projectId: string;
  invocationId: string;
  agentId: string;
}

export interface CreateTaskInput {
  sprintId: string;
  taskKey?: string;
  title: string;
  promptMarkdown?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  agentPresetId?: string | null;
  sortOrder?: number;
  dependsOnTaskIds?: string[];
  isIndependent?: boolean;
  isMerged?: boolean;
  mergeIndicator?: string | null;
  sourceType?: string | null;
  sourcePath?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  promptMarkdown?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  agentPresetId?: string | null;
  sortOrder?: number;
  dependsOnTaskIds?: string[];
  isIndependent?: boolean;
  isMerged?: boolean;
  mergeIndicator?: string | null;
  sourceType?: string | null;
  sourcePath?: string | null;
}

export interface SprintMarkdownImportTask {
  taskKey?: string;
  markdown: string;
}

export interface SprintMarkdownImportInput {
  sprintMarkdown: string;
  tasks: SprintMarkdownImportTask[];
}

export interface SprintMarkdownExportBundle {
  sprint: {
    fileName: string;
    markdown: string;
  };
  tasks: Array<{
    fileName: string;
    markdown: string;
  }>;
}

export interface PlannedTaskDraft {
  key: string;
  title: string;
  description: string;
  promptMarkdown: string;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  agentPresetId?: string | null;
  dependsOn?: string[];
}

export interface PlannedSprintPayload {
  goal: string;
  tasks: PlannedTaskDraft[];
}
