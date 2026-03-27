import type { VirtualWorkerProvider } from "./app-types.js";
import type { ProjectSettingsOverride } from "./settings-scope-types.js";
import type { ProjectWorkerAssignmentRecord } from "./worker-types.js";

export type ProjectStatus = "running" | "failed" | "intervention" | "idle";
export type ProjectSourceType = "local" | "git";
export type SprintStatus = "running" | "paused" | "completed" | "failed" | "cancelled" | "idle";
export type TaskStatus = "pending" | "in_progress" | "coding_completed" | "completed";
export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskExecutorType = "auto" | "docker_cli" | "jules" | "mcp_worker";

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  baseDir: string;
  repoUrl: string | null;
  sourceType: ProjectSourceType;
  sourceRef: string;
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

export interface SprintRecord {
  id: string;
  projectId: string;
  number: number | null;
  slug: string;
  sprintKey: string | null;
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
  sortOrder: number;
  dependsOnTaskIds: string[];
  isIndependent: boolean;
  isMerged: boolean;
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
  number?: number;
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
  number?: number | null;
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
}

export interface ImprovePromptInput {
  name: string;
  goal: string;
  planningAgentPresetId?: string;
  overrides?: PlanningOverrides;
}

export interface PlanSprintOptions {
  autoStart: boolean;
  replan?: boolean;
  planningAgentPresetId?: string;
  quicksprintTemplateId?: string;
  overrides?: PlanningOverrides;
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
