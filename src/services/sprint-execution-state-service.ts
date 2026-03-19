import * as path from "path";
import { formatSprintBranch } from "../git/sprint-branch-scheme.js";
import type { DashboardSettings, Subtask, SubtaskMergeIndicator } from "../contracts/app-types.js";
import type { SprintAgentArgs } from "../sprint/sprint-types.js";
import type { ProjectSummary, SprintRecord, TaskRecord } from "../contracts/project-management-types.js";
import type { TaskRunRecord } from "../contracts/execution-types.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";

export interface SprintExecutionContext {
  project: ProjectSummary;
  sprint: SprintRecord;
  sprintNumber: number;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  sourceId?: string;
}

function mapTaskStatusToSubtaskStatus(task: TaskRecord, latestRun?: TaskRunRecord): Subtask["status"] {
  if (latestRun?.state && latestRun.state !== "COMPLETED") {
    return latestRun.state;
  }

  switch (task.status) {
    case "coding_completed":
      return "CODING_COMPLETED";
    case "completed":
      return "COMPLETED";
    case "in_progress":
      return "RUNNING";
    case "pending":
    default:
      return "PENDING";
  }
}

function toMergeIndicator(value: string | null): SubtaskMergeIndicator | undefined {
  switch (value) {
    case "CI":
    case "AUTOMERGE":
    case "MERGED":
    case "MERGE_BLOCKED":
    case "MERGE_CONFLICT":
      return value;
    default:
      return undefined;
  }
}

export class SprintExecutionStateService {
  constructor(
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly executionRepository: ExecutionRepository,
  ) {}

  resolveContext(args: SprintAgentArgs, settings: DashboardSettings): SprintExecutionContext {
    const project = this.resolveProject(args);
    const sprint = this.resolveSprint(project, args);
    const sprintNumber = sprint.number ?? args.sprint_number;

    if (typeof sprintNumber !== "number" || Number.isNaN(sprintNumber)) {
      throw new Error(`Sprint ${sprint.id} has no number configured. Assign a sprint number in the dashboard before starting orchestration.`);
    }

    const repoPath = path.resolve((args.repo_path && args.repo_path.trim()) || project.baseDir);
    const defaultBranch = project.defaultBranch?.trim() || settings.git.defaultBranch || "main";
    const featureBranch = args.feature_branch?.trim()
      || sprint.featureBranch?.trim()
      || formatSprintBranch(settings.git.sprintBranchScheme, sprintNumber);

    return {
      project,
      sprint,
      sprintNumber,
      repoPath,
      featureBranch,
      defaultBranch,
      sourceId: args.source_id?.trim() || undefined,
    };
  }

  async loadSubtasks(projectId: string, sprintId: string, sprintRunId?: string): Promise<Subtask[]> {
    const tasks = this.projectManagementRepository.listTasks(projectId, sprintId);
    const latestRuns = this.executionRepository.listLatestTaskRuns(tasks.map((task) => task.id), sprintRunId);
    const taskKeyById = new Map(tasks.map((task) => [task.id, task.taskKey]));

    return tasks.map((task) => {
      const latestRun = latestRuns.get(task.id);
      return {
        record_id: task.id,
        project_id: task.projectId,
        sprint_id: task.sprintId,
        id: task.taskKey,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: task.dependsOnTaskIds
          .map((dependencyId) => taskKeyById.get(dependencyId))
          .filter((dependencyKey): dependencyKey is string => typeof dependencyKey === "string"),
        status: mapTaskStatusToSubtaskStatus(task, latestRun),
        session_id: latestRun?.sessionId || undefined,
        session_name: latestRun?.sessionName || undefined,
        session_state: latestRun?.state || undefined,
        provider: latestRun?.provider as Subtask["provider"] | undefined,
        worker_branch: latestRun?.workerBranch || undefined,
        pr_url: latestRun?.prUrl || undefined,
        is_independent: task.isIndependent,
        is_merged: task.isMerged,
        merge_indicator: toMergeIndicator(task.mergeIndicator),
      };
    });
  }

  hasPlannedTasks(projectId: string, sprintId: string): boolean {
    return this.projectManagementRepository.listTasks(projectId, sprintId).length > 0;
  }

  private resolveProject(args: SprintAgentArgs): ProjectSummary {
    if (typeof args.project_id === "string" && args.project_id.trim().length > 0) {
      const project = this.projectManagementRepository.getProject(args.project_id.trim());
      if (project) {
        return project;
      }
      throw new Error(`Project not found: ${args.project_id}`);
    }

    if (typeof args.repo_path === "string" && args.repo_path.trim().length > 0) {
      const project = this.projectManagementRepository.findProjectByBaseDir(args.repo_path);
      if (project) {
        return project;
      }
    }

    const selectedProjectId = this.projectManagementRepository.getSelectedProjectId();
    if (selectedProjectId) {
      const project = this.projectManagementRepository.getProject(selectedProjectId);
      if (project) {
        return project;
      }
    }

    throw new Error("No project scope could be resolved. Provide `project_id`, `repo_path`, or select a project in the dashboard.");
  }

  private resolveSprint(project: ProjectSummary, args: SprintAgentArgs): SprintRecord {
    if (typeof args.sprint_id === "string" && args.sprint_id.trim().length > 0) {
      const sprint = this.projectManagementRepository.getSprint(args.sprint_id.trim());
      if (!sprint) {
        throw new Error(`Sprint not found: ${args.sprint_id}`);
      }
      if (sprint.projectId !== project.id) {
        throw new Error(`Sprint ${args.sprint_id} does not belong to project ${project.id}`);
      }
      return sprint;
    }

    if (typeof args.sprint_number === "number") {
      const sprint = this.projectManagementRepository.findSprintByProjectAndNumber(project.id, args.sprint_number);
      if (sprint) {
        return sprint;
      }
      throw new Error(`Sprint ${args.sprint_number} was not found for project ${project.name}.`);
    }

    throw new Error("No sprint scope could be resolved. Provide `sprint_id` or `sprint_number`.");
  }
}
