import type { Subtask } from "../../contracts/app-types.js";

interface ResetTaskRuntimeStateOptions {
  preserveProvider?: boolean;
  preserveMergeState?: boolean;
}

export function createResetTaskRuntimeState(
  task: Subtask,
  options?: ResetTaskRuntimeStateOptions,
): Subtask {
  return {
    ...task,
    session_id: undefined,
    session_name: undefined,
    session_state: undefined,
    provider: options?.preserveProvider ? task.provider : undefined,
    worker_branch: undefined,
    pr_url: undefined,
    activities: [],
    is_merged: options?.preserveMergeState ? task.is_merged : false,
    merge_indicator: options?.preserveMergeState ? task.merge_indicator : undefined,
    intervention_owner: undefined,
    intervention_hint: undefined,
  };
}

export function createPendingTaskRuntimeReset(
  task: Subtask,
  options?: ResetTaskRuntimeStateOptions,
): Subtask {
  return {
    ...createResetTaskRuntimeState(task, options),
    status: "PENDING",
  };
}

export function applyPendingTaskRuntimeReset(
  task: Subtask,
  options?: ResetTaskRuntimeStateOptions,
): Subtask {
  const reset = createPendingTaskRuntimeReset(task, options);
  Object.assign(task, reset);
  return task;
}
