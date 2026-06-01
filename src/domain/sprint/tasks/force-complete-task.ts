import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../../../repositories/project-management-repository.js";
import type { ActiveDispatchRegistry } from "../../../services/active-dispatch-registry.js";
import type { Logger } from "../../../shared/logging/logger.js";

export interface ForceCompleteTaskArgs {
  projectId: string;
  taskId: string;
  reason: string;
  userId?: string;
}

export interface ForceCompleteTaskDependencies {
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  activeDispatchRegistry: ActiveDispatchRegistry;
  logger?: Logger;
}

/**
 * Force-completes a live task by terminating active execution and setting its state to COMPLETED.
 */
export async function forceCompleteTask(
  deps: ForceCompleteTaskDependencies,
  args: ForceCompleteTaskArgs,
): Promise<void> {
  const { projectId, taskId, reason, userId = "system" } = args;
  const { executionRepository, projectManagementRepository, activeDispatchRegistry, logger } = deps;

  logger?.info("Force-completing task", { projectId, taskId, reason, userId });

  // 1. Find and terminate active dispatches for this task
  const dispatches = executionRepository.listTaskDispatches({ projectId, taskId });
  const activeDispatches = dispatches.filter((d) =>
    ["queued", "claimed", "running", "cancel_requested"].includes(d.status)
  );

  const now = new Date().toISOString();

  for (const dispatch of activeDispatches) {
    if (dispatch.status === "running") {
      await activeDispatchRegistry.requestStop(dispatch.id, `Task force-completed: ${reason}`).catch((err) => {
        logger?.warn("Failed to request stop for running dispatch during force-complete", {
          dispatchId: dispatch.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    executionRepository.updateTaskDispatch(dispatch.id, {
      status: "cancelled",
      finishedAt: now,
      errorMessage: `Task force-completed: ${reason}`,
    });

    const taskRun = executionRepository.getTaskRunByDispatchId(dispatch.id);
    if (taskRun) {
      executionRepository.updateTaskRun(taskRun.id, {
        state: "COMPLETED",
        finishedAt: now,
        durationMs: taskRun.startedAt
          ? Math.max(0, new Date(now).getTime() - new Date(taskRun.startedAt).getTime())
          : null,
      });

      executionRepository.appendTaskRunEvent(taskRun.id, "task_force_completed", userId, {
        reason,
        dispatchId: dispatch.id,
      }, {
        sourceEventKey: `force-complete:${taskId}:${dispatch.id}:${now}`,
      });
    }
  }

  // 2. Update task state in project management repository
  const task = projectManagementRepository.getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.projectId !== projectId) {
    throw new Error(`Task ${taskId} does not belong to project ${projectId}`);
  }

  projectManagementRepository.updateTask(taskId, {
    status: "completed",
    isMerged: true,
  });

  // 3. Record event in sprint run if available
  const activeSprintRun = executionRepository.findActiveSprintRun(projectId, task.sprintId);
  if (activeSprintRun) {
    executionRepository.appendSprintRunEvent(activeSprintRun.id, "task_force_completed", userId, {
      taskId,
      taskKey: task.taskKey,
      reason,
    }, {
      sourceEventKey: `sprint-force-complete:${taskId}:${activeSprintRun.id}:${now}`,
    });
  }

  logger?.info("Task force-completed successfully", { projectId, taskId });
}
