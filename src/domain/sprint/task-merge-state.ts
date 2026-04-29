import type { Subtask } from "../../contracts/app-types.js";

type MergeStateTask = Pick<Subtask, "status" | "is_merged" | "merge_indicator" | "worker_branch" | "pr_url">;
type TaskPreCiGateState = Pick<
  Subtask,
  "status" | "is_merged" | "merge_indicator" | "worker_branch" | "pr_url" | "intervention_owner" | "intervention_hint"
>;

export interface PreCiGateTransition {
  status: Subtask["status"];
  merge_indicator: Subtask["merge_indicator"];
  intervention_owner: Subtask["intervention_owner"];
  intervention_hint: Subtask["intervention_hint"];
}

export function isTaskCodeComplete(task: Pick<Subtask, "status">): boolean {
  return task.status === "CODING_COMPLETED" || task.status === "COMPLETED";
}

export function taskHasMergeEvidence(task: Pick<Subtask, "worker_branch" | "pr_url">): boolean {
  const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch.trim() : "";
  const prUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

function isMergeSettled(task: Pick<Subtask, "is_merged" | "merge_indicator">): boolean {
  return Boolean(task.is_merged) || task.merge_indicator === "MERGED" || task.merge_indicator === "AUTOMERGE" || task.merge_indicator === "PR_ONLY";
}

export function isCompletedTaskAwaitingMerge(task: MergeStateTask): boolean {
  return isTaskCodeComplete(task) && !isMergeSettled(task) && taskHasMergeEvidence(task);
}

export function isCompletedTaskSettled(task: MergeStateTask): boolean {
  return isTaskCodeComplete(task) && (isMergeSettled(task) || !taskHasMergeEvidence(task));
}

export function normalizeTaskMergeIndicator(task: Pick<Subtask, "is_merged" | "merge_indicator" | "worker_branch" | "pr_url">): Subtask["merge_indicator"] {
  if (task.is_merged) {
    return task.merge_indicator === "AUTOMERGE" ? "AUTOMERGE" : "MERGED";
  }
  if (task.merge_indicator === "MERGE_CONFLICT") {
    return "MERGE_CONFLICT";
  }
  return taskHasMergeEvidence(task) ? task.merge_indicator : undefined;
}

export function evaluatePreCiGateTransition(task: TaskPreCiGateState): PreCiGateTransition {
  const merge_indicator = normalizeTaskMergeIndicator(task);

  let status = task.status;
  if (status === "COMPLETED" && taskHasMergeEvidence(task) && !task.is_merged) {
    status = "CODING_COMPLETED";
  } else if (status === "CODING_COMPLETED" && isCompletedTaskSettled({ ...task, status, merge_indicator })) {
    status = "COMPLETED";
  }

  const clearIntervention = status === "CODING_COMPLETED" || status === "COMPLETED";

  return {
    status,
    merge_indicator,
    intervention_owner: clearIntervention ? undefined : task.intervention_owner,
    intervention_hint: clearIntervention ? undefined : task.intervention_hint,
  };
}
