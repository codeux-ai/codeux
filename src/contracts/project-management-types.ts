import type { AgentRoutingMode, VirtualWorkerProvider } from "./app-types.js";
import type { ProjectSettingsOverride } from "./settings-scope-types.js";
import type { ProjectWorkerAssignmentRecord } from "./worker-types.js";

export type ProjectStatus = "running" | "failed" | "intervention" | "idle";
export type ProjectSourceType = "local" | "git";
export type SprintStatus = "running" | "paused" | "completed" | "failed" | "cancelled" | "idle";
export type TaskStatus = "pending" | "in_progress" | "coding_completed" | "completed" | "QA_REVIEW_FAILED";
export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskExecutorType = "auto" | "docker_cli" | "jules" | "mcp_worker";
export type GitProvider = "github" | "gitlab" | "local";
export type ProjectInitMode = "existing" | "new-local" | "new-remote";

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
  lastRunAt: string | null;
  lastRunStatus: string | null;
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

export type LinkedIssueProvider = "github" | "gitlab" | "jira" | "notion" | "asana" | "linear" | "miro" | "lucid" | "figma" | "mural";
export type LinkedIssueCloseState = "open" | "closed" | "close_failed";
export type LinkedIssueSourceKind = "issue" | "task" | "page" | "database" | "board" | "document" | "file" | "canvas";
export type SprintImportedTaskKind = "security" | "quality" | "merge_conflict" | "failed_ci";
export type RepositoryIssueSearchState = "open" | "closed" | "all";
export type RepositoryIssueSearchSortField = "updated" | "created" | "comments";
export type RepositoryIssueSearchSortDirection = "asc" | "desc";
export type JiraIssueSearchStatus = "open" | "in_progress" | "done" | "all";
export type JiraIssueSearchAssignee = "any" | "me" | "unassigned";
export type JiraIssueSearchSortField = "updated" | "created" | "priority" | "status" | "assignee" | "reporter";
export type JiraIssueSearchSortDirection = "asc" | "desc";

export interface RepositoryIssueSearchInput {
  provider?: LinkedIssueProvider;
  externalId?: string | null;
  externalIds?: string[];
  sourceKind?: LinkedIssueSourceKind;
  sourceProvider?: LinkedIssueProvider;
  repository?: string;
  hostDomain?: string;
  workspaceId?: string;
  projectId?: string;
  providerProjectId?: string;
  teamId?: string;
  teamKey?: string;
  databaseId?: string;
  boardId?: string;
  documentId?: string;
  fileKey?: string;
  muralId?: string;
  itemTypes?: string[];
  projectKey?: string;
  search?: string;
  state?: RepositoryIssueSearchState;
  status?: JiraIssueSearchStatus;
  labels?: string[];
  assignee?: string;
  assigneeText?: string;
  author?: string;
  reporter?: string;
  milestone?: string;
  issueText?: string;
  issueKeys?: string[];
  issueNumbers?: number[];
  issueRefs?: string[];
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  sortField?: RepositoryIssueSearchSortField | JiraIssueSearchSortField;
  sortDirection?: RepositoryIssueSearchSortDirection | JiraIssueSearchSortDirection;
  limit?: number;
}

export interface RepositoryIssueSearchResult extends SprintLinkedIssueInput {
  bodyPreview: string;
  createdAt: string | null;
  updatedAt: string | null;
  issueAuthor: string | null;
  issueReporter: string | null;
  issueMilestone: string | null;
  issueType: string | null;
  issuePriority: string | null;
  issueCommentCount: number | null;
  sourceProvider: LinkedIssueProvider;
}

export type RemoteIssueSummary = RepositoryIssueSearchResult;

export interface SprintLinkedIssueRecord {
  id: string;
  projectId: string;
  sprintId: string;
  provider: LinkedIssueProvider;
  sourceProvider?: LinkedIssueProvider;
  sourceKind?: LinkedIssueSourceKind;
  externalId?: string | null;
  hostDomain: string;
  projectKey?: string;
  repository: string;
  issueNumber: number | null;
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
  sourceProvider?: LinkedIssueProvider;
  sourceKind?: LinkedIssueSourceKind;
  externalId?: string | null;
  hostDomain: string;
  projectKey?: string;
  repository: string;
  issueNumber?: number | null;
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
  metadata?: Record<string, unknown>;
}

export interface SprintImportedTaskInput {
  kind: SprintImportedTaskKind;
  title: string;
  sourceUrl?: string | null;
  sourcePath?: string | null;
  provider?: string | null;
  repository?: string | null;
  branch?: string | null;
  baseBranch?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  workflowRunId?: string | null;
  workflowRunUrl?: string | null;
  commitSha?: string | null;
  errorMessage?: string | null;
  labels?: string[];
  priority?: TaskPriority;
  agentPresetId?: string | null;
  dependsOnTaskIds?: string[];
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

export interface JiraIssueSearchInput {
  jql?: string;
  projectKey?: string;
  search?: string;
  issueKey?: string;
  status?: JiraIssueSearchStatus;
  assignee?: JiraIssueSearchAssignee;
  assigneeText?: string;
  reporterText?: string;
  issueType?: string;
  priority?: string;
  labels?: string[];
  updatedAfter?: string;
  updatedBefore?: string;
  sortField?: JiraIssueSearchSortField;
  sortDirection?: JiraIssueSearchSortDirection;
  limit?: number;
  maxResults?: number;
}

export interface JiraIssueSearchResult {
  key: string;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  projectKey: string;
  issueType: string | null;
  priority: string | null;
  bodyPreview: string;
  createdAt: string | null;
  updatedAt: string | null;
  issueAuthor: string | null;
  issueReporter: string | null;
  issueMilestone: string | null;
  issueCommentCount: number | null;
  sourceProvider: "jira";
}

export interface SprintRecord {
  id: string;
  projectId: string;
  number: number | null;
  slug: string;
  name: string;
  isGeneratedName: boolean;
  originalPrompt: string | null;
  goal: string;
  status: SprintStatus;
  showcasePinned: boolean;
  startDate: string | null;
  endDate: string | null;
  featureBranch: string | null;
  baseCommitSha: string | null;
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
  model?: string | null;
  sortOrder: number;
  dependsOnTaskIds: string[];
  isIndependent: boolean;
  isMerged: boolean;
  qa_review?: {
    error_reason?: string;
    [key: string]: any;
  };
  latestReview?: SprintReviewSummary;
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
  initMode?: ProjectInitMode;           // omitted = "existing" (backward compat)
  isPrivate?: boolean;                  // new-remote: repo visibility, default true
  remoteProvider?: "github" | "gitlab"; // new-remote: which hosting provider
  settingsOverrides?: ProjectSettingsOverride;
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
  name?: string;
  originalPrompt?: string | null;
  goal?: string;
  linkedIssues?: SprintLinkedIssueInput[];
  importedTasks?: SprintImportedTaskInput[];
  number?: number | null;
  slug?: string;
  status?: SprintStatus;
  showcasePinned?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  featureBranch?: string | null;
  baseCommitSha?: string | null;
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
  baseCommitSha?: string | null;
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
  techstack: boolean;
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

export interface ProjectSetupTechstackArtifact {
  name: string;
  description: string;
  detectedFrameworks?: string[];
  detectedLibraries?: string[];
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
  techstack?: ProjectSetupTechstackArtifact | null;
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
  model?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  promptMarkdown?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  agentPresetId?: string | null;
  model?: string | null;
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
  title?: string;
  tasks: PlannedTaskDraft[];
}
