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
    model: options?.preserveProvider ? task.model : undefined,
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

/**
 * Clears the merge projection on an in-memory task that is re-entering the
 * coding stage (QA follow-up, retry). A task that is coding again must not carry
 * a stale CI / QA / MERGED indicator or a merged flag. The worker branch / PR
 * are preserved so a continued run can keep building on the same branch.
 */
export function clearMergeProjectionForRerun(task: Subtask): void {
  task.merge_indicator = undefined;
  task.is_merged = false;
  task.intervention_owner = undefined;
  task.intervention_hint = undefined;
}

/** The persisted equivalent of {@link clearMergeProjectionForRerun}. */
export const MERGE_PROJECTION_RESET = {
  isMerged: false,
  mergeIndicator: null,
} as const;
