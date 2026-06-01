import type { ProviderId, Subtask } from "../contracts/app-types.js";
import type { StartSprintDispatchResult } from "./sprint-task-dispatch-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { createPendingTaskRuntimeReset } from "../domain/sprint/task-reset-state.js";
import { commandRunner } from "../shared/subprocess/command-runner.js";

const VALID_PROVIDER_IDS = new Set<ProviderId>([
  "jules",
  "gemini",
  "codex",
  "claude-code",
  "qwen-code",
  "opencode",
  "antigravity",
]);

function normalizeProviderId(value: string | undefined): ProviderId | undefined {
  return VALID_PROVIDER_IDS.has(value as ProviderId) ? value as ProviderId : undefined;
}

export interface TaskRerunContext {
  task: Subtask;
  projectId: string;
  sprintId: string;
  sprintNumber: number;
  sourceId?: string;
  repoPath: string;
  featureBranch: string;
}

export interface TaskRerunOptions {
  provider?: ProviderId;
  providerConfigId?: string;
  model?: string;
  clearWorktree?: boolean;
  resetDependents?: boolean;
  undoMerge?: boolean;
}

export interface TaskRerunSprintRunResolution {
  sprintRunId: string;
  created: boolean;
}

export interface TaskRerunServiceDependencies {
  resolveTaskContext: (taskId: string) => TaskRerunContext | null;
  listSprintTaskDependencies?: (projectId: string, sprintId: string) => Array<{ taskId: string; dependsOnTaskIds: string[] }>;
  updateTaskPlanningStatus: (taskId: string, status: "pending" | "in_progress" | "coding_completed" | "completed") => void;
  resolveSprintRunId: (args: {
    projectId: string;
    sprintId: string;
    sprintNumber: number;
    featureBranch: string;
  }) => Promise<TaskRerunSprintRunResolution>;
  startTask: (args: {
    task: Subtask;
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    sourceId?: string;
    featureBranch: string;
    repoPath: string;
    sprintNumber: number;
    providerConfigId?: string;
    resumeWorkspaceSessionId?: string;
    resumeWorkerBranch?: string;
    forceFreshWorkspace?: boolean;
  }) => Promise<StartSprintDispatchResult>;
  resolveSessionName: (session: { id?: string; name?: string }) => string | undefined;
  extractSessionId: (session: { id?: string; name?: string }) => string | undefined;
  persistMergedFlag: (args: { taskId: string; merged: boolean }) => Promise<void>;
  clearTaskWorktree?: (args: { taskId: string; repoPath: string }) => Promise<void>;
  createResetTaskRun?: (args: {
    taskId: string;
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    reason: "task_rerun_reset" | "dependent_task_reset";
  }) => Promise<void>;
  resumeSprintRun?: (sprintRunId: string) => Promise<void>;
  resolveTaskAttention?: (args: { taskId: string; projectId: string }) => Promise<void>;
  updateTaskExecutorOverride?: (taskId: string, provider: ProviderId) => void;
  cancelActiveDispatch?: (taskId: string, projectId: string) => Promise<void>;
  logger?: Logger;
}

export class TaskRerunService {
  constructor(private readonly deps: TaskRerunServiceDependencies) {}

  async rerunTask(taskId: string, options?: TaskRerunOptions): Promise<Subtask> {
    const context = this.deps.resolveTaskContext(taskId);
    if (!context) {
      throw new Error("Cannot rerun task: sprint context is incomplete. Run orchestration/status first.");
    }

    if (options?.undoMerge) {
      await this.revertMerge(context);
    }

    const sprintRun = await this.deps.resolveSprintRunId({
      projectId: context.projectId,
      sprintId: context.sprintId,
      sprintNumber: context.sprintNumber,
      featureBranch: context.featureBranch,
    });

    const rootTaskId = context.task.record_id || taskId;
    const downstreamContexts = options?.resetDependents
      ? this.collectDependentContexts(context, rootTaskId)
      : [];

    for (const dependentContext of downstreamContexts) {
      await this.resetTaskForFreshRun(dependentContext, {
        clearWorktree: options?.clearWorktree,
        sprintRunId: sprintRun.sprintRunId,
        startTask: false,
        reason: "dependent_task_reset",
      });
    }

    return await this.resetTaskForFreshRun(context, {
      provider: options?.provider,
      providerConfigId: options?.providerConfigId,
      model: options?.model,
      clearWorktree: options?.clearWorktree,
      sprintRunId: sprintRun.sprintRunId,
      startTask: true,
      reason: "task_rerun_reset",
      resumeSprintRun: sprintRun.created,
    });
  }

  private collectDependentContexts(
    context: TaskRerunContext,
    rootTaskId: string,
  ): TaskRerunContext[] {
    if (!this.deps.listSprintTaskDependencies) {
      return [];
    }

    const dependencies = this.deps.listSprintTaskDependencies(context.projectId, context.sprintId);
    const dependentsByTaskId = new Map<string, string[]>();
    for (const entry of dependencies) {
      for (const dependencyId of entry.dependsOnTaskIds) {
        const next = dependentsByTaskId.get(dependencyId) || [];
        next.push(entry.taskId);
        dependentsByTaskId.set(dependencyId, next);
      }
    }

    const visited = new Set<string>();
    const queue = [...(dependentsByTaskId.get(rootTaskId) || [])];
    const contexts: TaskRerunContext[] = [];

    while (queue.length > 0) {
      const currentTaskId = queue.shift();
      if (!currentTaskId || visited.has(currentTaskId)) {
        continue;
      }
      visited.add(currentTaskId);

      const currentContext = this.deps.resolveTaskContext(currentTaskId);
      if (currentContext) {
        contexts.push(currentContext);
      }

      for (const dependentId of dependentsByTaskId.get(currentTaskId) || []) {
        if (!visited.has(dependentId)) {
          queue.push(dependentId);
        }
      }
    }

    return contexts;
  }

  private async resetTaskForFreshRun(
    context: TaskRerunContext,
    options: {
      provider?: ProviderId;
      providerConfigId?: string;
      model?: string;
      clearWorktree?: boolean;
      sprintRunId: string;
      startTask: boolean;
      resumeSprintRun?: boolean;
      reason: "task_rerun_reset" | "dependent_task_reset";
    },
  ): Promise<Subtask> {
    const taskId = context.task.record_id || context.task.id;
    const previousSessionId = context.task.session_id;
    const previousWorkerBranch = context.task.worker_branch;

    if (this.deps.cancelActiveDispatch) {
      try {
        await this.deps.cancelActiveDispatch(taskId, context.projectId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger?.warn("Failed to cancel active dispatch during task reset", { taskId, message });
      }
    }

    if (options.provider && options.startTask && this.deps.updateTaskExecutorOverride) {
      this.deps.updateTaskExecutorOverride(taskId, options.provider);
    }

    if (options.clearWorktree && this.deps.clearTaskWorktree) {
      try {
        await this.deps.clearTaskWorktree({
          taskId,
          repoPath: context.repoPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger?.warn("Failed to clear worktree during task reset", { taskId, message });
      }
    }

    const resetTask = createPendingTaskRuntimeReset(context.task);
    if (options.provider && options.startTask) {
      resetTask.provider = options.provider;
    }
    if (options.model && options.startTask) {
      resetTask.model = options.model;
    }
    this.deps.updateTaskPlanningStatus(taskId, "pending");

    try {
      await this.deps.persistMergedFlag({
        taskId,
        merged: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger?.warn("Failed to persist merged=false while resetting task", {
        taskId,
        message,
      });
    }

    if (this.deps.resolveTaskAttention) {
      try {
        await this.deps.resolveTaskAttention({
          taskId,
          projectId: context.projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger?.warn("Failed to resolve task attention during reset", { taskId, message });
      }
    }

    if (!options.startTask) {
      if (this.deps.createResetTaskRun) {
        try {
          await this.deps.createResetTaskRun({
            taskId,
            projectId: context.projectId,
            sprintId: context.sprintId,
            sprintRunId: options.sprintRunId,
            reason: options.reason,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.logger?.warn("Failed to create reset task run snapshot", { taskId, message });
        }
      }
      return resetTask;
    }

    const session = await this.deps.startTask({
      task: resetTask,
      projectId: context.projectId,
      sprintId: context.sprintId,
      sprintRunId: options.sprintRunId,
      sourceId: context.sourceId,
      featureBranch: context.featureBranch,
      repoPath: context.repoPath,
      sprintNumber: context.sprintNumber,
      providerConfigId: options.providerConfigId,
      resumeWorkspaceSessionId: options.clearWorktree ? undefined : previousSessionId,
      resumeWorkerBranch: options.clearWorktree ? undefined : previousWorkerBranch,
      forceFreshWorkspace: options.clearWorktree === true,
    });
    const restartedTask: Subtask = {
      ...resetTask,
      status: "RUNNING",
      session_name: this.deps.resolveSessionName(session),
      session_id: this.deps.extractSessionId(session),
      provider: normalizeProviderId(session.provider),
    };
    if (options.resumeSprintRun && this.deps.resumeSprintRun) {
      try {
        await this.deps.resumeSprintRun(options.sprintRunId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger?.warn("Failed to resume sprint orchestration after task rerun", {
          taskId,
          sprintRunId: options.sprintRunId,
          message,
        });
      }
    }
    return restartedTask;
  }

  private async revertMerge(context: TaskRerunContext): Promise<void> {
    const task = context.task;
    const repoPath = context.repoPath;
    const featureBranch = context.featureBranch;
    const prUrl = task.pr_url;
    const workerBranch = task.worker_branch;

    this.deps.logger?.info("Attempting to programmatically undo merge for task", {
      taskId: task.id,
      prUrl,
      workerBranch,
    });

    let prNumber: string | undefined;
    if (prUrl) {
      const match = prUrl.match(/(?:pull|pr)\/(\d+)/);
      if (match) {
        prNumber = match[1];
      }
    }

    // Checkout the feature branch
    await commandRunner.run("git", ["checkout", featureBranch], { cwd: repoPath });

    let commitHash: string | undefined;

    // Search by PR number first
    if (prNumber) {
      const grepPatterns = [
        `Merge pull request #${prNumber}`,
        `(#${prNumber})`,
        `PR #${prNumber}`,
      ];

      for (const pattern of grepPatterns) {
        const result = await commandRunner.run(
          "git",
          ["log", "--first-parent", `--grep=${pattern}`, "--format=%H", "-n", "1"],
          { cwd: repoPath }
        );
        const hash = result.stdout.trim();
        if (hash) {
          commitHash = hash;
          break;
        }
      }

      if (!commitHash) {
        const fallbackResult = await commandRunner.run(
          "git",
          ["log", "--first-parent", `--grep=#${prNumber}`, "--format=%H", "-n", "1"],
          { cwd: repoPath }
        );
        const hash = fallbackResult.stdout.trim();
        if (hash) {
          commitHash = hash;
        }
      }
    }

    // Fallback search by worker branch
    if (!commitHash && workerBranch) {
      const patterns = [
        `Merge branch '${workerBranch}'`,
        workerBranch,
      ];
      for (const pattern of patterns) {
        const result = await commandRunner.run(
          "git",
          ["log", "--first-parent", `--grep=${pattern}`, "--format=%H", "-n", "1"],
          { cwd: repoPath }
        );
        const hash = result.stdout.trim();
        if (hash) {
          commitHash = hash;
          break;
        }
      }
    }

    if (!commitHash) {
      throw new Error(`Could not locate the Git merge commit for task ${task.id} (PR #${prNumber || "unknown"}, branch ${workerBranch || "unknown"}) on branch ${featureBranch}.`);
    }

    this.deps.logger?.info("Found merge commit to revert", { taskId: task.id, commitHash });

    // Determine if it's a merge commit (has more than 1 parent)
    const checkParent = await commandRunner.run(
      "git",
      ["rev-parse", "--verify", `${commitHash}^2`],
      { cwd: repoPath }
    ).catch(() => ({ ok: false }));

    const isMerge = checkParent.ok;

    // Run git revert
    const revertArgs = isMerge
      ? ["revert", "--no-edit", "-m", "1", commitHash]
      : ["revert", "--no-edit", commitHash];

    const revertResult = await commandRunner.run("git", revertArgs, { cwd: repoPath });
    if (!revertResult.ok) {
      throw new Error(`Failed to revert merge commit ${commitHash}: ${revertResult.stderr || revertResult.stdout}`);
    }

    this.deps.logger?.info("Successfully reverted merge commit", { taskId: task.id, commitHash });

    // Check if remote exists and push
    const remoteCheck = await commandRunner.run("git", ["remote"], { cwd: repoPath });
    if (remoteCheck.ok && remoteCheck.stdout.trim().length > 0) {
      const pushResult = await commandRunner.run("git", ["push", "origin", featureBranch], { cwd: repoPath });
      if (!pushResult.ok) {
        this.deps.logger?.warn("Failed to push reverted merge to origin", {
          taskId: task.id,
          error: pushResult.stderr || pushResult.stdout,
        });
      }
    }
  }
}
