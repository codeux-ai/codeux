import type { Subtask } from "../../contracts/app-types.js";
import { isQuotaCooldownActive } from "../../shared/providers/provider-error-classifier.js";

interface DeriveStatusOptions {
  retryFailed: boolean;
  isActionRequiredState: (state?: string) => boolean;
  getTaskErrorMessage?: (task: Subtask) => string | null | undefined;
}

const areDependenciesMet = (subtasks: Subtask[], task: Subtask): boolean => {
  return task.depends_on.every((depId) => {
    const dep = subtasks.find((candidate) => candidate.id === depId);
    return dep?.status === "COMPLETED" && dep?.is_merged;
  });
};

export const runStatusDerivationStep = (subtasks: Subtask[], options: DeriveStatusOptions): Subtask[] => {
  for (const task of subtasks) {
    if (task.session_state === "QUOTA") {
      const errorMsg = options.getTaskErrorMessage?.(task);
      if (!isQuotaCooldownActive(errorMsg)) {
        task.status = areDependenciesMet(subtasks, task) ? "PENDING" : "BLOCKED";
        task.session_state = undefined;
      } else {
        task.status = "QUOTA";
      }
      continue;
    }

    if (task.session_state === "FAILED" && options.retryFailed) {
      task.status = areDependenciesMet(subtasks, task) ? "PENDING" : "BLOCKED";
      continue;
    }

    if (task.session_state && options.isActionRequiredState(task.session_state)) {
      task.status = "BLOCKED";
      continue;
    }

    if (task.status === "RUNNING" || task.status === "COMPLETED" || task.status === "FAILED" || task.status === "QUOTA") {
      continue;
    }

    if (!task.is_independent && task.depends_on.length === 0) {
      task.status = "BLOCKED";
      continue;
    }

    task.status = areDependenciesMet(subtasks, task) ? "PENDING" : "BLOCKED";
  }

  return subtasks;
};
