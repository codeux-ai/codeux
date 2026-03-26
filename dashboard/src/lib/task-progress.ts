import type { ExecutionTaskDispatchSummary, Subtask } from "../types.js";

export type TaskProgressPhase = NonNullable<Subtask["status"]>;

const POST_CODING_RUNNING_INDICATORS = new Set([
  "CI",
  "AUTOMERGE",
  "MERGE_BLOCKED",
  "MERGE_CONFLICT",
]);

function taskHasMergeEvidence(task: Pick<Subtask, "worker_branch" | "pr_url">): boolean {
  const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch.trim() : "";
  const prUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

function isMergeSettled(task: Pick<Subtask, "is_merged" | "merge_indicator">): boolean {
  return Boolean(task.is_merged) || task.merge_indicator === "MERGED" || task.merge_indicator === "AUTOMERGE";
}

function resolveTaskProgressPhase(
  rawStatus: TaskProgressPhase,
  hasMergeEvidence: boolean,
  mergeSettled: boolean,
): TaskProgressPhase {
  if (rawStatus !== "CODING_COMPLETED" && rawStatus !== "COMPLETED") {
    return rawStatus;
  }

  return mergeSettled || !hasMergeEvidence
    ? "COMPLETED"
    : "CODING_COMPLETED";
}

function resolveDisplayStatusFromMergeIndicator(
  rawStatus: TaskProgressPhase,
  mergeIndicator: Subtask["merge_indicator"] | undefined,
): TaskProgressPhase {
  if (rawStatus !== "RUNNING") {
    return rawStatus;
  }

  if (mergeIndicator === "MERGED") {
    return "COMPLETED";
  }

  return POST_CODING_RUNNING_INDICATORS.has(mergeIndicator ?? "")
    ? "CODING_COMPLETED"
    : rawStatus;
}

function resolveRunningPostCodingPhase(
  rawStatus: TaskProgressPhase,
  mergeIndicator: Subtask["merge_indicator"] | undefined,
): TaskProgressPhase | null {
  if (rawStatus !== "RUNNING") {
    return null;
  }

  if (mergeIndicator === "MERGED") {
    return "COMPLETED";
  }

  return POST_CODING_RUNNING_INDICATORS.has(mergeIndicator ?? "")
    ? "CODING_COMPLETED"
    : null;
}

export function getTaskProgressPhase(task: Subtask): TaskProgressPhase {
  const initialRawStatus = task.status || "PENDING";
  const runningPostCodingPhase = resolveRunningPostCodingPhase(initialRawStatus, task.merge_indicator);
  if (runningPostCodingPhase) {
    return runningPostCodingPhase;
  }

  const rawStatus = resolveDisplayStatusFromMergeIndicator(initialRawStatus, task.merge_indicator);
  return resolveTaskProgressPhase(
    rawStatus,
    taskHasMergeEvidence(task),
    isMergeSettled(task),
  );
}

export interface LiveTaskProgressPhaseArgs {
  task: Subtask;
  dispatch?: Pick<ExecutionTaskDispatchSummary, "status" | "taskRunState" | "finishedAt" | "workerBranch" | "prUrl"> | null;
  runtimeTerminalPhase?: TaskProgressPhase | null;
  runtimeMergeSettled?: boolean;
}

function dispatchHasMergeEvidence(
  dispatch: LiveTaskProgressPhaseArgs["dispatch"],
): boolean {
  const workerBranch = typeof dispatch?.workerBranch === "string" ? dispatch.workerBranch.trim() : "";
  const prUrl = typeof dispatch?.prUrl === "string" ? dispatch.prUrl.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

function resolveTerminalExecutionPhase(
  dispatch: LiveTaskProgressPhaseArgs["dispatch"],
  runtimeTerminalPhase: TaskProgressPhase | null | undefined,
): TaskProgressPhase | null {
  if (
    runtimeTerminalPhase === "COMPLETED"
    || runtimeTerminalPhase === "FAILED"
    || runtimeTerminalPhase === "BLOCKED"
    || runtimeTerminalPhase === "QUOTA"
  ) {
    return runtimeTerminalPhase;
  }

  switch (dispatch?.status) {
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "blocked":
      return "BLOCKED";
    case "quota":
      return "QUOTA";
    default:
      break;
  }

  if (dispatch?.finishedAt) {
    switch (dispatch.taskRunState) {
      case "COMPLETED":
        return "COMPLETED";
      case "FAILED":
        return "FAILED";
      case "BLOCKED":
        return "BLOCKED";
      case "QUOTA":
        return "QUOTA";
      default:
        return "COMPLETED";
    }
  }

  return null;
}

export function getLiveTaskProgressPhase(args: LiveTaskProgressPhaseArgs): TaskProgressPhase {
  const initialRawStatus = resolveTerminalExecutionPhase(args.dispatch, args.runtimeTerminalPhase)
    ?? args.task.status
    ?? "PENDING";
  const runningPostCodingPhase = resolveRunningPostCodingPhase(initialRawStatus, args.task.merge_indicator);
  if (runningPostCodingPhase) {
    return runningPostCodingPhase;
  }

  const rawStatus = resolveDisplayStatusFromMergeIndicator(initialRawStatus, args.task.merge_indicator);
  const hasMergeEvidence = taskHasMergeEvidence(args.task) || dispatchHasMergeEvidence(args.dispatch);
  const mergeSettled = isMergeSettled(args.task) || args.runtimeMergeSettled === true;

  return resolveTaskProgressPhase(rawStatus, hasMergeEvidence, mergeSettled);
}

export function isTaskCodingCompleted(task: Subtask): boolean {
  return getTaskProgressPhase(task) === "CODING_COMPLETED";
}

export function isTaskCompleted(task: Subtask): boolean {
  return getTaskProgressPhase(task) === "COMPLETED";
}
