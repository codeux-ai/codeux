import type { Subtask } from "../types.js";

export type TaskProgressPhase = NonNullable<Subtask["status"]>;

function taskHasMergeEvidence(task: Pick<Subtask, "worker_branch" | "pr_url">): boolean {
  const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch.trim() : "";
  const prUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

function isMergeSettled(task: Pick<Subtask, "is_merged" | "merge_indicator">): boolean {
  return Boolean(task.is_merged) || task.merge_indicator === "MERGED";
}

export function getTaskProgressPhase(task: Subtask): TaskProgressPhase {
  const rawStatus = task.status || "PENDING";
  if (rawStatus !== "CODING_COMPLETED" && rawStatus !== "COMPLETED") {
    return rawStatus;
  }

  return isMergeSettled(task) || !taskHasMergeEvidence(task)
    ? "COMPLETED"
    : "CODING_COMPLETED";
}

export function isTaskCodingCompleted(task: Subtask): boolean {
  return getTaskProgressPhase(task) === "CODING_COMPLETED";
}

export function isTaskCompleted(task: Subtask): boolean {
  return getTaskProgressPhase(task) === "COMPLETED";
}
