import type { SprintBranchUpdateResult } from "../contracts/project-management-types.js";
import { formatSprintBranch } from "../domain/sprint/branch-name-generator.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { prepareBranchForOrchestration } from "../sprint/steps/branch-preflight-step.js";

interface SprintBranchServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  settingsRepository: SettingsRepository;
  logger?: Logger;
}

export class SprintBranchService {
  constructor(private readonly deps: SprintBranchServiceDeps) {}

  async updateFromDefault(projectId: string, sprintId: string): Promise<SprintBranchUpdateResult> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }

    const taskIds = this.deps.projectManagementRepository
      .listTasks(projectId, sprintId)
      .map((task) => task.id);
    if (this.deps.executionRepository.listLatestTaskRuns(taskIds).size > 0) {
      throw new Error("The sprint branch cannot be updated after task work has started.");
    }

    const settings = this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings;
    const defaultBranch = settings.git.defaultBranch?.trim() || project.defaultBranch?.trim() || "main";
    const featureBranch = sprint.featureBranch?.trim() || formatSprintBranch(settings.git.sprintBranchScheme, {
      sprint_key_prefix: settings.git.sprintKeyPrefix,
      sprint_number: sprint.number ?? 0,
      sprint_name: sprint.name || "",
      sprint_id: sprint.slug || "",
      planning_agent: settings.agents.routing.planning.agentPresetId || "default",
      agent_routing: settings.agents.routing.taskCoding.mode,
      worker_agent: settings.agents.routing.taskCoding.agentPresetId || "default",
      worker_provider: settings.workers.virtualWorkerProvider,
      worker_model: settings.workers.model,
    });

    const preparation = await prepareBranchForOrchestration(
      project.baseDir,
      featureBranch,
      defaultBranch,
      settings.git.githubMode === "LOCAL"
        ? {
          localOnly: true,
          fastForwardFromDefault: true,
          ...(sprint.baseCommitSha
            ? { expectedFeatureCommitSha: sprint.baseCommitSha }
            : {}),
        }
        : {
          githubToken: settings.git.githubToken,
          gitlabToken: settings.git.gitlabToken,
          fastForwardFromDefault: true,
          ...(sprint.baseCommitSha
            ? { expectedFeatureCommitSha: sprint.baseCommitSha }
            : {}),
        },
    );

    if (!preparation.existsLocal || (preparation.hasRemoteOrigin && !preparation.existsRemote)) {
      throw new Error(`Could not prepare sprint branch ${featureBranch}.`);
    }
    if (preparation.defaultBranchSync === "preserved_feature_changes") {
      throw new Error("The sprint branch has commits that are not on the default branch, so it cannot be fast-forwarded safely.");
    }
    if (preparation.defaultBranchSync === "failed" || !preparation.defaultBranchSync || !preparation.baseCommitSha) {
      throw new Error(`Could not fast-forward sprint branch ${featureBranch} from ${defaultBranch}.`);
    }

    this.deps.projectManagementRepository.updateSprint(sprintId, {
      featureBranch,
      baseCommitSha: preparation.baseCommitSha,
    });
    this.deps.logger?.info("Updated an unstarted sprint branch from its default branch.", {
      projectId,
      sprintId,
      featureBranch,
      defaultBranch,
      result: preparation.defaultBranchSync,
    });

    return {
      status: preparation.defaultBranchSync,
      featureBranch,
      defaultBranch,
      commitSha: preparation.baseCommitSha,
    };
  }
}
