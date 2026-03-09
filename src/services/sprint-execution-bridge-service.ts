import * as fs from "fs/promises";
import * as path from "path";
import type { SprintAgentArgs } from "../sprint/sprint-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ProjectSummary, SprintRecord, TaskRecord } from "../contracts/project-management-types.js";
import type { DashboardStatus } from "../contracts/app-types.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../repositories/project-runtime-repository.js";
import { SubtaskParser } from "../infrastructure/repositories/subtask-parser.js";
import { getRepoSprintOsPath, getSprintSubtasksDir } from "../shared/config/sprint-os-paths.js";

export interface ResolvedSprintExecutionContext {
  project: ProjectSummary;
  sprint: SprintRecord;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  subtasksDir: string;
  taskCount: number;
}

interface SetTaskMergedFlagInput {
  repoPath: string;
  sprintNumber: number;
  taskId: string;
  merged: boolean;
}

function normalizePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return path.resolve(trimmed);
}

function buildFeatureBranch(project: ProjectSummary, sprint: SprintRecord, requestedBranch?: string): string {
  if (requestedBranch && requestedBranch.trim().length > 0) {
    return requestedBranch.trim();
  }

  if (sprint.featureBranch && sprint.featureBranch.trim().length > 0) {
    return sprint.featureBranch.trim();
  }

  const prefix = project.featureBranchPrefix?.trim() || "feature/";
  const sprintToken = sprint.number ?? sprint.slug;
  return `${prefix}sprint${sprintToken}-implementation`;
}

export class SprintExecutionBridgeService {
  constructor(
    private readonly projectRepository: ProjectManagementRepository,
    private readonly runtimeRepository: ProjectRuntimeRepository,
    private readonly logger?: Logger
  ) {}

  async resolveContext(args: SprintAgentArgs): Promise<ResolvedSprintExecutionContext | null> {
    const project = this.resolveProject(args);
    if (!project) {
      return null;
    }

    const sprint = this.resolveSprint(project.id, args);
    if (!sprint) {
      return null;
    }

    const repoPath = normalizePath(project.baseDir) || normalizePath(project.sourceRef) || normalizePath(args.repo_path);
    if (!repoPath) {
      throw new Error(`Project ${project.name} does not have a usable repository path.`);
    }

    const taskCount = this.projectRepository.listTasks(project.id, sprint.id).length;
    const subtasksDir = typeof sprint.number === "number"
      ? getSprintSubtasksDir(repoPath, sprint.number)
      : getRepoSprintOsPath(repoPath, "sprints", `${sprint.slug}-subtasks`);

    return {
      project,
      sprint,
      repoPath,
      featureBranch: buildFeatureBranch(project, sprint, args.feature_branch),
      defaultBranch: project.defaultBranch?.trim() || "main",
      subtasksDir,
      taskCount,
    };
  }

  async materializeSubtasks(context: ResolvedSprintExecutionContext): Promise<void> {
    const status = this.runtimeRepository.getSprintStatus(context.project.id, context.sprint.id);
    await fs.mkdir(context.subtasksDir, { recursive: true });

    const nextFileNames = new Set<string>();
    for (const subtask of status.subtasks) {
      const fileName = `${subtask.id}.md`;
      nextFileNames.add(fileName);
      const filePath = path.join(context.subtasksDir, fileName);
      await fs.writeFile(filePath, SubtaskParser.stringify(subtask), "utf-8");
    }

    const existingEntries = await fs.readdir(context.subtasksDir, { withFileTypes: true }).catch(() => []);
    for (const entry of existingEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || nextFileNames.has(entry.name)) {
        continue;
      }
      await fs.rm(path.join(context.subtasksDir, entry.name), { force: true });
    }
  }

  async setTaskMergedFlag(input: SetTaskMergedFlagInput): Promise<boolean> {
    const resolvedRepoPath = normalizePath(input.repoPath);
    if (!resolvedRepoPath) {
      return false;
    }

    const context = this.resolveContext({
      sprint_number: input.sprintNumber,
      repo_path: resolvedRepoPath,
      action: "status",
    });

    const awaitedContext = await context;
    if (!awaitedContext) {
      return false;
    }

    const task = this.projectRepository
      .listTasks(awaitedContext.project.id, awaitedContext.sprint.id)
      .find((candidate) => candidate.taskKey === input.taskId);

    if (!task) {
      return false;
    }

    this.projectRepository.updateTask(task.id, {
      isMerged: input.merged,
      mergeIndicator: input.merged ? "MERGED" : null,
    });

    try {
      await this.materializeSubtasks(awaitedContext);
    } catch (error) {
      this.logger?.warn("Failed to rematerialize sprint subtasks after merged flag update", {
        repoPath: resolvedRepoPath,
        sprintId: awaitedContext.sprint.id,
        taskId: input.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  }

  buildPlanningBlockerText(context: ResolvedSprintExecutionContext): string {
    return [
      `### Sprint ${context.sprint.number ?? context.sprint.name} Planning Missing`,
      "",
      `Project \`${context.project.name}\` is selected, but sprint \`${context.sprint.name}\` has no tasks in Sprint OS yet.`,
      "",
      "Use the v2 dashboard Tasks page or markdown import to define the sprint tasks before orchestration can begin.",
    ].join("\n");
  }

  async buildPlanningActionText(context: ResolvedSprintExecutionContext, planningGuideBlock: string): Promise<string> {
    if (context.taskCount > 0) {
      return [
        `### Sprint ${context.sprint.number ?? context.sprint.name} Already Planned`,
        "",
        `Project \`${context.project.name}\` / sprint \`${context.sprint.name}\` already has ${context.taskCount} task${context.taskCount === 1 ? "" : "s"} in the Sprint OS database.`,
        "",
        "Continue planning in the v2 dashboard or run `sprint_agent(action: \"status\")` / `sprint_agent(action: \"orchestrate\")` to execute the current sprint state.",
      ].join("\n");
    }

    return [
      `### Planning Phase For ${context.project.name} / ${context.sprint.name}`,
      "",
      `Sprint OS will orchestrate sprint \`${context.sprint.name}\` from the database-backed v2 project model.`,
      planningGuideBlock,
      "",
      "**Instructions for the calling Agent:**",
      "1. Open the selected project and sprint in the v2 dashboard.",
      "2. Create or import the sprint tasks into Sprint OS.",
      "3. Set task dependencies and prompts.",
      "4. Run `sprint_agent(action: \"orchestrate\", wait: true)` once the sprint is planned.",
    ].join("\n");
  }

  private resolveProject(args: SprintAgentArgs): ProjectSummary | null {
    if (args.project_id) {
      return this.projectRepository.getProject(args.project_id) || null;
    }

    const normalizedRepoPath = normalizePath(args.repo_path);
    if (normalizedRepoPath) {
      const match = this.projectRepository.listProjects().projects.find((project) => {
        return normalizePath(project.baseDir) === normalizedRepoPath || normalizePath(project.sourceRef) === normalizedRepoPath;
      });
      if (match) {
        return match;
      }
    }

    const selectedProjectId = this.projectRepository.getSelectedProjectId();
    if (selectedProjectId) {
      return this.projectRepository.getProject(selectedProjectId) || null;
    }

    return this.projectRepository.listProjects().projects[0] || null;
  }

  private resolveSprint(projectId: string, args: SprintAgentArgs): SprintRecord | null {
    if (args.sprint_id) {
      const sprint = this.projectRepository.getSprint(args.sprint_id);
      return sprint?.projectId === projectId ? sprint : null;
    }

    const sprints = this.projectRepository.listSprints(projectId);
    const exact = sprints.find((sprint) => sprint.number === args.sprint_number);
    if (exact) {
      return exact;
    }

    return sprints[0] || null;
  }
}
