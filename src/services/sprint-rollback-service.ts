import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type {
  CreateSprintRollbackInput,
  CreateSprintRollbackResult,
  ProjectSummary,
  SprintRecord,
  SprintRollbackAssessment,
  SprintRollbackMode,
} from "../contracts/project-management-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { ValidationError } from "../repositories/repository-utils.js";
import { runCommandStrict, type CommandResult } from "./cli-process-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks, type GitHttpAuthOptions } from "./git-http-auth.js";

const GIT_IDENTITY_ARGS = [
  "-c", "user.name=Code UX",
  "-c", "user.email=agents@codeux.ai",
];

export type SprintRollbackGitRunner = (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => Promise<CommandResult>;

interface SprintRollbackServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  settingsRepository: SettingsRepository;
  orchestrateSprint: (projectId: string, sprintId: string) => Promise<unknown>;
  gitRunner?: SprintRollbackGitRunner;
  getGitAuth?: () => GitHttpAuthOptions;
  logger?: Logger;
}

interface RollbackPlan {
  project: ProjectSummary;
  sourceSprint: SprintRecord;
  defaultBranch: string;
  githubMode: "REMOTE" | "LOCAL";
  integrationCommitSha: string | null;
  assessment: SprintRollbackAssessment;
}

export class SprintRollbackService {
  private readonly gitRunner: SprintRollbackGitRunner;

  constructor(private readonly deps: SprintRollbackServiceDeps) {
    this.gitRunner = deps.gitRunner ?? ((command, args, cwd, env) => (
      runCommandStrict(command, args, cwd, env ?? process.env, { timeout: 60_000 })
    ));
  }

  async assess(projectId: string, sourceSprintId: string): Promise<SprintRollbackAssessment> {
    return (await this.buildPlan(projectId, sourceSprintId)).assessment;
  }

  async create(
    projectId: string,
    sourceSprintId: string,
    input: CreateSprintRollbackInput = {},
  ): Promise<CreateSprintRollbackResult> {
    const plan = await this.buildPlan(projectId, sourceSprintId);
    if (!plan.assessment.eligible) {
      throw new ValidationError(plan.assessment.reasons.join(" "));
    }

    const instructions = input.instructions?.trim() || "";
    if (instructions.length > 6000) {
      throw new ValidationError("Rollback instructions must be 6000 characters or fewer.");
    }
    const requestedMode: SprintRollbackMode = instructions
      ? "agent_assisted"
      : plan.assessment.recommendedMode;
    const rollbackBranch = this.buildRollbackBranch(plan.sourceSprint);
    let mode = requestedMode;
    let reasons = [...plan.assessment.reasons];

    const rollbackSprint = this.deps.projectManagementRepository.createSprint(projectId, {
      name: `Rollback Sprint ${plan.sourceSprint.number ?? plan.sourceSprint.slug}`,
      goal: this.buildRollbackGoal(plan.sourceSprint, instructions),
      originalPrompt: instructions || null,
      kind: "rollback",
      rollbackSourceSprintId: plan.sourceSprint.id,
      rollbackMode: mode,
      rollbackInstructions: instructions || null,
      rollbackSafetyReason: reasons.join(" ") || null,
      featureBranch: rollbackBranch,
      status: "idle",
      showcasePinned: true,
    });

    if (mode === "automatic" && plan.integrationCommitSha) {
      try {
        await this.createAutomatedRollbackBranch({
          repoPath: plan.project.baseDir,
          defaultBranch: plan.defaultBranch,
          githubMode: plan.githubMode,
          rollbackBranch,
          integrationCommitSha: plan.integrationCommitSha,
        });
        this.createAutomatedTask(plan.sourceSprint, rollbackSprint, plan.githubMode);
      } catch (error) {
        mode = "agent_assisted";
        const detail = error instanceof Error ? error.message : String(error);
        reasons = [...reasons, `The automated revert dry run was not clean: ${detail}`];
        this.deps.projectManagementRepository.updateSprint(rollbackSprint.id, {
          rollbackMode: mode,
          rollbackSafetyReason: reasons.join(" "),
        });
        this.createAgentTask(plan.sourceSprint, rollbackSprint, instructions, reasons, plan.githubMode);
      }
    } else {
      this.createAgentTask(plan.sourceSprint, rollbackSprint, instructions, reasons, plan.githubMode);
    }

    await this.deps.orchestrateSprint(projectId, rollbackSprint.id);
    const persisted = this.deps.projectManagementRepository.getSprint(rollbackSprint.id) ?? rollbackSprint;
    const finalAssessment: SprintRollbackAssessment = {
      ...plan.assessment,
      recommendedMode: mode,
      reasons,
    };
    this.deps.logger?.info("Created sprint rollback", {
      projectId,
      sourceSprintId,
      rollbackSprintId: rollbackSprint.id,
      mode,
    });
    return { rollbackSprint: persisted, mode, assessment: finalAssessment };
  }

  private async buildPlan(projectId: string, sourceSprintId: string): Promise<RollbackPlan> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    const sourceSprint = this.deps.projectManagementRepository.getSprint(sourceSprintId);
    if (!project || !sourceSprint || sourceSprint.projectId !== projectId) {
      throw new ValidationError(`Sprint ${sourceSprintId} was not found in project ${projectId}.`);
    }

    const settings = this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sourceSprintId).settings;
    const defaultBranch = settings.git.defaultBranch || project.defaultBranch || "main";
    const githubMode = settings.git.githubMode;
    const reasons: string[] = [];
    let eligible = true;

    if (sourceSprint.kind === "rollback") {
      eligible = false;
      reasons.push("Rollback sprints cannot be used as rollback sources; select the original sprint instead.");
    }
    if (sourceSprint.status !== "completed") {
      eligible = false;
      reasons.push("Only completed sprints can be rolled back.");
    }
    if (!project.baseDir || !sourceSprint.featureBranch) {
      eligible = false;
      reasons.push("The source repository path and sprint feature branch must both be available.");
    }

    const sprints = this.deps.projectManagementRepository.listSprints(projectId).sprints;
    const existingRollback = sprints.find((sprint) => (
      sprint.kind === "rollback"
      && sprint.rollbackSourceSprintId === sourceSprintId
      && sprint.status !== "failed"
      && sprint.status !== "cancelled"
    ));
    if (existingRollback) {
      eligible = false;
      reasons.push(`Rollback sprint ${existingRollback.number ?? existingRollback.slug} already covers this source sprint.`);
    }

    const laterWork = sprints.filter((sprint) => (
      sprint.kind === "standard"
      && sprint.id !== sourceSprint.id
      && sprint.number !== null
      && sourceSprint.number !== null
      && sprint.number > sourceSprint.number
      && sprint.status !== "idle"
      && sprint.status !== "cancelled"
    ));
    if (laterWork.length > 0) {
      reasons.push("Later sprint work exists, so an agent must preserve dependent changes while removing the requested behavior.");
    }

    let integrationCommitSha: string | null = null;
    if (eligible && laterWork.length === 0) {
      try {
        integrationCommitSha = await this.resolveSafeHeadMerge(
          project.baseDir,
          defaultBranch,
          sourceSprint.featureBranch!,
          githubMode,
        );
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error));
      }
    }

    const recommendedMode: SprintRollbackMode = eligible
      && laterWork.length === 0
      && integrationCommitSha
      ? "automatic"
      : "agent_assisted";
    if (eligible && recommendedMode === "automatic") {
      reasons.push("The source sprint is the latest isolated merge on the default branch and is eligible for a clean automated revert.");
    } else if (eligible && reasons.length === 0) {
      reasons.push("The rollback requires an agent to isolate the safe change set.");
    }

    return {
      project,
      sourceSprint,
      defaultBranch,
      githubMode,
      integrationCommitSha,
      assessment: { sourceSprintId, eligible, recommendedMode, reasons },
    };
  }

  private async resolveSafeHeadMerge(
    repoPath: string,
    defaultBranch: string,
    featureBranch: string,
    githubMode: "REMOTE" | "LOCAL",
  ): Promise<string> {
    const defaultBranchRef = githubMode === "REMOTE"
      ? `refs/remotes/origin/${defaultBranch}`
      : `refs/heads/${defaultBranch}`;
    const featureBranchRef = githubMode === "REMOTE"
      ? `refs/remotes/origin/${featureBranch}`
      : `refs/heads/${featureBranch}`;
    if (githubMode === "REMOTE") {
      const authEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, this.deps.getGitAuth?.() ?? {});
      await this.gitRunner("git", ["fetch", "--prune", "origin", defaultBranch], repoPath, authEnv);
    }
    const head = (await this.gitRunner(
      "git",
      ["rev-parse", "--verify", `${defaultBranchRef}^{commit}`],
      repoPath,
    )).stdout.trim();
    const details = (await this.gitRunner(
      "git",
      ["show", "-s", "--format=%P%x00%s%x00%b", head],
      repoPath,
    )).stdout;
    const [parentText = "", subject = "", body = ""] = details.split("\0");
    const parents = parentText.trim().split(/\s+/).filter(Boolean);
    if (parents.length < 2) {
      throw new Error("The latest default-branch commit is not an isolated merge commit, so an agent must determine the safe rollback range.");
    }

    const messageMatches = `${subject}\n${body}`.includes(featureBranch);
    let branchTipMatches = false;
    try {
      const branchTip = (await this.gitRunner(
        "git",
        ["rev-parse", "--verify", `${featureBranchRef}^{commit}`],
        repoPath,
      )).stdout.trim();
      branchTipMatches = parents.slice(1).includes(branchTip);
    } catch {
      branchTipMatches = false;
    }
    if (!messageMatches && !branchTipMatches) {
      throw new Error("The latest default-branch merge cannot be proven to belong to this sprint, so an agent must inspect the history.");
    }
    return head;
  }

  private async createAutomatedRollbackBranch(args: {
    repoPath: string;
    defaultBranch: string;
    githubMode: "REMOTE" | "LOCAL";
    rollbackBranch: string;
    integrationCommitSha: string;
  }): Promise<void> {
    const worktreeRoot = path.join(args.repoPath, ".worktrees");
    await mkdir(worktreeRoot, { recursive: true });
    const worktreePath = await mkdtemp(path.join(worktreeRoot, "code-ux-rollback-"));
    let worktreeAdded = false;
    try {
      const defaultBranchRef = args.githubMode === "REMOTE"
        ? `refs/remotes/origin/${args.defaultBranch}`
        : `refs/heads/${args.defaultBranch}`;
      await this.gitRunner("git", [
        "worktree", "add", "--detach", worktreePath,
        defaultBranchRef,
      ], args.repoPath);
      worktreeAdded = true;
      // Keep every worktree command rooted at the source repository. Git commands
      // run in the containerized Git helper, where the source checkout is always
      // mounted at /workspace. Running a later command with the host worktree as
      // cwd remounts that directory as /workspace and invalidates the .git pointer
      // written by `git worktree add` (for example /workspace/.git/worktrees/0).
      // `git -C` preserves one mount context while still operating on the worktree.
      await this.gitRunner("git", ["-C", worktreePath, "switch", "-c", args.rollbackBranch], args.repoPath);
      await this.gitRunner("git", [
        "-C", worktreePath,
        ...GIT_IDENTITY_ARGS,
        "revert", "--no-edit", "-m", "1", args.integrationCommitSha,
      ], args.repoPath);
      if (args.githubMode === "REMOTE") {
        const authEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(args.repoPath, this.deps.getGitAuth?.() ?? {});
        await this.gitRunner("git", [
          "-C", worktreePath,
          "push", "--set-upstream", "origin", `HEAD:refs/heads/${args.rollbackBranch}`,
        ], args.repoPath, authEnv);
      }
    } finally {
      if (worktreeAdded) {
        await this.gitRunner("git", ["worktree", "remove", "--force", worktreePath], args.repoPath).catch(() => undefined);
        await this.gitRunner("git", ["worktree", "prune"], args.repoPath).catch(() => undefined);
      }
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private createAutomatedTask(
    source: SprintRecord,
    rollbackSprint: SprintRecord,
    githubMode: "REMOTE" | "LOCAL",
  ): void {
    const delivery = githubMode === "REMOTE" ? "created and pushed" : "created locally";
    this.deps.projectManagementRepository.createTask(source.projectId, {
      sprintId: rollbackSprint.id,
      taskKey: "ROLLBACK",
      title: `Revert sprint ${source.number ?? source.slug}`,
      description: `Deterministic rollback commit ${delivery} by Code UX.`,
      promptMarkdown: "The source sprint integration merge was reverted automatically in a detached worktree. No provider invocation was used.",
      status: "completed",
      priority: "critical",
      isIndependent: true,
      isMerged: true,
      mergeIndicator: "MERGED",
      sourceType: "sprint_rollback",
      sourcePath: source.id,
    });
  }

  private createAgentTask(
    source: SprintRecord,
    rollbackSprint: SprintRecord,
    instructions: string,
    reasons: string[],
    githubMode: "REMOTE" | "LOCAL",
  ): void {
    const requestedScope = instructions || "Fully revert the source sprint while preserving all later compatible work.";
    const prompt = [
      "# Sprint rollback",
      "",
      `Rollback source sprint: ${source.number ?? source.slug}`,
      `Source feature branch: ${source.featureBranch || "unavailable"}`,
      `Rollback branch: ${rollbackSprint.featureBranch || "unavailable"}`,
      "",
      "## Requested scope",
      requestedScope,
      "",
      "## Safety context",
      ...reasons.map((reason) => `- ${reason}`),
      "",
      "## Required outcome",
      "- Inspect the source sprint diff and all later dependent changes before editing.",
      "- Remove only the requested behavior and preserve compatible later work.",
      "- Resolve conflicts conservatively and explain anything that cannot be safely removed.",
      "- Add or update tests for the resulting behavior.",
      githubMode === "REMOTE"
        ? "- Commit and push the rollback changes on the provided rollback branch."
        : "- Commit the rollback changes on the provided local rollback branch; do not push or create a pull request.",
      githubMode === "REMOTE"
        ? "- Do not merge into the default branch; Code UX will create and gate the rollback pull request."
        : "- Do not merge into the default branch; Code UX will merge the rollback branch locally during sprint finalization.",
    ].join("\n");
    this.deps.projectManagementRepository.createTask(source.projectId, {
      sprintId: rollbackSprint.id,
      taskKey: "ROLLBACK",
      title: `Safely rollback sprint ${source.number ?? source.slug}`,
      description: requestedScope,
      promptMarkdown: prompt,
      status: "pending",
      priority: "critical",
      executorType: "auto",
      isIndependent: true,
      sourceType: "sprint_rollback",
      sourcePath: source.id,
    });
  }

  private buildRollbackGoal(source: SprintRecord, instructions: string): string {
    const scope = instructions || "Fully revert the sprint's integrated changes.";
    return `Rollback source sprint ${source.number ?? source.slug} through a dedicated rollback branch. ${scope}`;
  }

  private buildRollbackBranch(source: SprintRecord): string {
    const sourceKey = String(source.number ?? source.slug)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "sprint";
    return `rollback/${sourceKey}-${randomUUID().slice(0, 8)}`;
  }
}
