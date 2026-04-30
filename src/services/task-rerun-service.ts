import type { ProviderId, Subtask } from "../contracts/app-types.js";
import type { StartSprintDispatchResult } from "./sprint-task-dispatch-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { createPendingTaskRuntimeReset } from "../domain/sprint/task-reset-state.js";

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
  clearWorktree?: boolean;
  resetDependents?: boolean;
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
      clearWorktree?: boolean;
      sprintRunId: string;
      startTask: boolean;
      resumeSprintRun?: boolean;
      reason: "task_rerun_reset" | "dependent_task_reset";
    },
  ): Promise<Subtask> {
    const taskId = context.task.record_id || context.task.id;

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
    });
    const restartedTask: Subtask = {
      ...resetTask,
      status: "RUNNING",
      session_name: this.deps.resolveSessionName(session),
      session_id: this.deps.extractSessionId(session),
      provider:
        session.provider === "jules" || session.provider === "gemini" || session.provider === "codex" || session.provider === "claude-code"
          ? session.provider
          : undefined,
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
}
