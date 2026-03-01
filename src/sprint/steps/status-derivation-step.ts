import type { Subtask } from "../../contracts/app-types.js";

interface DeriveStatusOptions {
  retryFailed: boolean;
  isActionRequiredState: (state?: string) => boolean;
}

const areDependenciesMet = (subtasks: Subtask[], task: Subtask): boolean => {
  return task.depends_on.every((depId) => {
    const dep = subtasks.find((candidate) => candidate.id === depId);
    return dep?.status === "COMPLETED" && dep?.is_merged;
  });
};

export const runStatusDerivationStep = (subtasks: Subtask[], options: DeriveStatusOptions): Subtask[] => {
  for (const task of subtasks) {
    if (task.session_state === "FAILED" && options.retryFailed) {
      task.status = areDependenciesMet(subtasks, task) ? "PENDING" : "BLOCKED";
      continue;
    }

    if (task.session_state && options.isActionRequiredState(task.session_state)) {
      task.status = "BLOCKED";
      continue;
    }

    if (task.status === "RUNNING" || task.status === "COMPLETED" || task.status === "FAILED") {
      continue;
    }

    if (!task.is_independent) {
      task.status = "BLOCKED";
      continue;
    }

    task.status = areDependenciesMet(subtasks, task) ? "PENDING" : "BLOCKED";
  }

  return subtasks;
};
