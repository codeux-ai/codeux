import type { Subtask } from "../../contracts/app-types.js";

type MergeStateTask = Pick<Subtask, "status" | "is_merged" | "merge_indicator" | "worker_branch" | "pr_url">;

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
