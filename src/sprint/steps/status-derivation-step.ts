import type { Subtask } from "../../contracts/app-types.js";
import { applyPendingTaskRuntimeReset } from "../../domain/sprint/task-reset-state.js";
import { decideTaskStatusDerivation } from "../../domain/sprint/task-transition-state.js";

interface DeriveStatusOptions {
  retryFailed: boolean;
  isActionRequiredState: (state?: string) => boolean;
  githubMode?: "REMOTE" | "LOCAL";
  localCliPushedTaskIds?: ReadonlySet<string>;
  localCliSettledTaskIds?: ReadonlySet<string>;
}

export const runStatusDerivationStep = (subtasks: Subtask[], options: DeriveStatusOptions): Subtask[] => {
  for (const task of subtasks) {
    const decision = decideTaskStatusDerivation(task, subtasks, options);
    if (decision.resetRuntime) {
      applyPendingTaskRuntimeReset(task, {
        preserveProvider: true,
      });
    }
    task.status = decision.status;
  }

  return subtasks;
};
