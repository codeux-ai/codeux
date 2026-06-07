import type { Subtask } from "../../contracts/app-types.js";
import { isCompletedTaskSettled } from "../../domain/sprint/task-merge-state.js";
import { applyPendingTaskRuntimeReset } from "../../domain/sprint/task-reset-state.js";

interface DeriveStatusOptions {
  retryFailed: boolean;
  isActionRequiredState: (state?: string) => boolean;
  githubMode?: "REMOTE" | "LOCAL";
}

const areDependenciesMet = (subtasks: Subtask[], task: Subtask, githubMode?: "REMOTE" | "LOCAL"): boolean => {
  return task.depends_on.every((depId) => {
    const dep = subtasks.find((candidate) => candidate.id === depId);
    return dep ? isCompletedTaskSettled(dep, { githubMode }) : false;
  });
};

export const runStatusDerivationStep = (subtasks: Subtask[], options: DeriveStatusOptions): Subtask[] => {
  for (const task of subtasks) {
    if (task.session_state === "QUOTA" || task.session_state === "RATE_LIMITED" || task.status === "QUOTA") {
      task.status = "QUOTA";
      continue;
    }

    if (task.session_state === "BLOCKED") {
      task.status = "BLOCKED";
      continue;
    }

    if (task.session_state === "FAILED" && options.retryFailed) {
      applyPendingTaskRuntimeReset(task, {
        preserveProvider: true,
      });
      task.status = areDependenciesMet(subtasks, task, options.githubMode) ? "PENDING" : "BLOCKED";
      continue;
    }

    if (task.session_state && options.isActionRequiredState(task.session_state)) {
      task.status = "BLOCKED";
      continue;
    }

    if (task.status === "RUNNING" || task.status === "CODING_COMPLETED" || task.status === "COMPLETED" || task.status === "FAILED") {
      continue;
    }

    if (!task.is_independent && task.depends_on.length === 0) {
      task.status = "BLOCKED";
      continue;
    }

    task.status = areDependenciesMet(subtasks, task, options.githubMode) ? "PENDING" : "BLOCKED";
  }

  return subtasks;
};
