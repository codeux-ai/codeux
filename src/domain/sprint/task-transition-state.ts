import type { Subtask, SubtaskStatus } from "../../contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";
import {
  isCompletedTaskAwaitingMerge,
  isCompletedTaskSettled,
  resolveTaskPipelineStage,
  type TaskPipelineStage,
} from "./task-pipeline-stage.js";

export interface TaskTransitionOptions {
  githubMode?: "REMOTE" | "LOCAL";
  localCliPushedTaskIds?: ReadonlySet<string>;
  localCliSettledTaskIds?: ReadonlySet<string>;
}

export interface TaskTransitionClassification {
  pipelineStage: TaskPipelineStage;
  dependenciesMet: boolean;
  unmetDependencyIds: string[];
  failedDependencyIds: string[];
  isSettled: boolean;
  isTerminal: boolean;
  isFailed: boolean;
  isMergeRequired: boolean;
  isQaPending: boolean;
  isRunning: boolean;
  isReady: boolean;
  isQuota: boolean;
}

export interface TaskStatusDerivationDecision {
  status: SubtaskStatus;
  resetRuntime: boolean;
}

export interface TaskStatusDerivationOptions extends TaskTransitionOptions {
  retryFailed: boolean;
  isActionRequiredState: (state?: string) => boolean;
}

export interface SprintTransitionStateParams extends TaskTransitionOptions {
  subtasks: Subtask[];
  manualMergeTasks: Subtask[];
  workerEscalatedMergeConflictTasks: Subtask[];
  activeProjectAttentionItems: ProjectAttentionItemRecord[];
  sprintRunId: string;
}

export interface SprintTransitionState {
  tasksByStatus: Map<string, Subtask[]>;
  statusCounts: Record<string, number>;
  runningTasks: Subtask[];
  readyTasks: Subtask[];
  activeWorkerAttentionItems: ProjectAttentionItemRecord[];
  activeWorkerMergeConflictAttention: boolean;
  activeMainMergeAttentionItems: ProjectAttentionItemRecord[];
  qaPendingTasks: Subtask[];
  quotaTasks: Subtask[];
  failedTasks: Subtask[];
  settledTasks: Subtask[];
  mergeRequiredTasks: Subtask[];
  allTerminal: boolean;
  noMoreActionPossible: boolean;
  needsManualMerge: boolean;
  waitingOnWorkerAttention: boolean;
  allFinished: boolean;
}

export function isMainMergeAttentionItem(item: {
  attentionType: string;
  payload: Record<string, unknown> | null;
}): boolean {
  const payload = item.payload || {};
  const isMainMergeConflict = item.attentionType === "merge_conflict" && payload.mergeStage === "main";
  const isMainMergeCiFix = item.attentionType === "ci_fix_required" && payload.mergeStage === "main";
  const isMainMergeHandoff = (
    (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
    && (payload.sourceAttentionType === "merge_conflict" || payload.sourceAttentionType === "ci_fix_required")
    && payload.mergeStage === "main"
  );
  return isMainMergeConflict || isMainMergeCiFix || isMainMergeHandoff;
}

function collectHumanEscalatedMergeConflictTaskIds(items: ProjectAttentionItemRecord[]): Set<string> {
  return new Set(
    items
      .filter((item) => (
        item.ownerType === "human"
        && (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
        && item.payload?.sourceAttentionType === "merge_conflict"
      ))
      .map((item) => item.taskId?.trim())
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
}

function isLocalCliTaskAwaitingBranchEvidence(
  task: Subtask,
  options?: TaskTransitionOptions,
): boolean {
  const githubMode = options?.githubMode;
  const taskIds = [task.record_id?.trim(), task.id?.trim()].filter((id): id is string => Boolean(id));
  const hasUnsettledPushedGitWork = githubMode === "LOCAL"
    && taskIds.some((taskId) => options?.localCliPushedTaskIds?.has(taskId))
    && !taskIds.some((taskId) => options?.localCliSettledTaskIds?.has(taskId));

  return githubMode === "LOCAL"
    && (task.status === "CODING_COMPLETED" || (task.status === "COMPLETED" && hasUnsettledPushedGitWork))
    && (task.session_state === "COMPLETED" || hasUnsettledPushedGitWork)
    && task.provider !== "jules"
    && !task.is_merged
    && !task.merge_indicator
    && !task.worker_branch?.trim()
    && !task.pr_url?.trim();
}

export function partitionSubtasksByStatus(subtasks: Subtask[]): {
  tasksByStatus: Map<string, Subtask[]>;
  statusCounts: Record<string, number>;
} {
  const tasksByStatus = new Map<string, Subtask[]>();
  const statusCounts: Record<string, number> = {};
  for (const task of subtasks) {
    const status = task.status || "UNKNOWN";
    let list = tasksByStatus.get(status);
    if (!list) {
      list = [];
      tasksByStatus.set(status, list);
    }
    list.push(task);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return { tasksByStatus, statusCounts };
}

export function classifyTaskTransition(
  task: Subtask,
  subtasks: Subtask[],
  options?: TaskTransitionOptions,
): TaskTransitionClassification {
  const pipeline = resolveTaskPipelineStage({
    status: task.status,
    isMerged: Boolean(task.is_merged),
    mergeIndicator: task.merge_indicator,
    workerBranch: task.worker_branch,
    prUrl: task.pr_url,
  }, options);
  const unmetDependencyIds: string[] = [];
  const failedDependencyIds: string[] = [];

  for (const depId of task.depends_on ?? []) {
    const dependency = subtasks.find((candidate) => candidate.id === depId);
    if (!dependency) {
      unmetDependencyIds.push(depId);
      continue;
    }
    if (dependency.status === "FAILED") {
      failedDependencyIds.push(depId);
    }
    if (!isCompletedTaskSettled(dependency, options)) {
      unmetDependencyIds.push(depId);
    }
  }

  const isSettled = pipeline.stage === "COMPLETED";
  const isFailed = task.status === "FAILED";
  const isMergeRequired = isCompletedTaskAwaitingMerge(task, options);
  const isQaPending = pipeline.stage === "QA";

  return {
    pipelineStage: pipeline.stage,
    dependenciesMet: unmetDependencyIds.length === 0,
    unmetDependencyIds,
    failedDependencyIds,
    isSettled,
    isTerminal: isSettled || isFailed,
    isFailed,
    isMergeRequired,
    isQaPending,
    isRunning: task.status === "RUNNING",
    isReady: task.status === "PENDING",
    isQuota: task.status === "QUOTA",
  };
}

export function decideTaskStatusDerivation(
  task: Subtask,
  subtasks: Subtask[],
  options: TaskStatusDerivationOptions,
): TaskStatusDerivationDecision {
  if ((task.session_state === "FAILED" || task.session_state === "CANCELLED") && options.retryFailed) {
    const classification = classifyTaskTransition(task, subtasks, options);
    return {
      status: classification.dependenciesMet ? "PENDING" : "BLOCKED",
      resetRuntime: true,
    };
  }

  if (task.session_state === "QUOTA" || task.session_state === "RATE_LIMITED" || task.status === "QUOTA") {
    return { status: "QUOTA", resetRuntime: false };
  }

  if (task.session_state === "BLOCKED") {
    return { status: "BLOCKED", resetRuntime: false };
  }

  if (task.session_state && options.isActionRequiredState(task.session_state)) {
    return { status: "BLOCKED", resetRuntime: false };
  }

  if (task.status === "CODING_COMPLETED" || task.status === "COMPLETED") {
    const projection = resolveTaskPipelineStage({
      status: task.status,
      isMerged: Boolean(task.is_merged),
      mergeIndicator: task.merge_indicator,
      workerBranch: task.worker_branch,
      prUrl: task.pr_url,
    }, options);
    return { status: projection.status, resetRuntime: false };
  }

  if (
    task.status === "RUNNING"
    || task.status === "FAILED"
    || task.status === "QA_REVIEW_FAILED"
  ) {
    return { status: task.status, resetRuntime: false };
  }

  if (!task.is_independent && task.depends_on.length === 0) {
    return { status: "BLOCKED", resetRuntime: false };
  }

  const classification = classifyTaskTransition(task, subtasks, options);
  return {
    status: classification.dependenciesMet ? "PENDING" : "BLOCKED",
    resetRuntime: false,
  };
}

export function evaluateSprintTransitionState(params: SprintTransitionStateParams): SprintTransitionState {
  const { subtasks, manualMergeTasks, workerEscalatedMergeConflictTasks, activeProjectAttentionItems, sprintRunId, githubMode } = params;
  const { tasksByStatus, statusCounts } = partitionSubtasksByStatus(subtasks);
  const classifications = subtasks.map((task) => ({
    task,
    classification: classifyTaskTransition(task, subtasks, params),
  }));

  const runningTasks = tasksByStatus.get("RUNNING") || [];
  const readyTasks = tasksByStatus.get("PENDING") || [];
  const qaPendingTasks = classifications
    .filter(({ classification }) => classification.isQaPending)
    .map(({ task }) => task);
  const quotaTasks = tasksByStatus.get("QUOTA") || [];
  const failedTasks = classifications
    .filter(({ classification }) => classification.isFailed)
    .map(({ task }) => task);
  const settledTasks = classifications
    .filter(({ classification }) => classification.isSettled)
    .map(({ task }) => task);
  const humanEscalatedMergeConflictTaskIds = collectHumanEscalatedMergeConflictTaskIds(activeProjectAttentionItems);
  const mergeRequiredTasks = classifications
    .filter(({ task, classification }) => (
      (classification.isMergeRequired && !humanEscalatedMergeConflictTaskIds.has(task.record_id?.trim() || task.id))
      || isLocalCliTaskAwaitingBranchEvidence(task, params)
    ))
    .map(({ task }) => task);
  const activeWorkerAttentionItems = activeProjectAttentionItems.filter((item) => item.ownerType === "worker");
  const activeWorkerMergeConflictAttention = activeWorkerAttentionItems.some((item) => item.attentionType === "merge_conflict");
  const workerMergeConflictTasksStillActive = workerEscalatedMergeConflictTasks.filter((task) => {
    const taskId = task.record_id?.trim();
    return !taskId || !humanEscalatedMergeConflictTaskIds.has(taskId);
  });
  const activeMainMergeAttentionItems = activeProjectAttentionItems.filter((item) => (
    item.sprintRunId === sprintRunId && isMainMergeAttentionItem(item)
  ));

  const hasLocalTasksAwaitingBranchEvidence = classifications.some(({ task }) => isLocalCliTaskAwaitingBranchEvidence(task, params));
  const allTerminal = subtasks.length > 0
    && !hasLocalTasksAwaitingBranchEvidence
    && classifications.every(({ classification }) => classification.isTerminal);
  const noMoreActionPossible = runningTasks.length === 0
    && readyTasks.length === 0
    && quotaTasks.length === 0
    && qaPendingTasks.length === 0
    && mergeRequiredTasks.length === 0;
  const needsManualMerge = manualMergeTasks.length > 0;
  const waitingOnWorkerAttention = workerMergeConflictTasksStillActive.length > 0
    || activeWorkerMergeConflictAttention
    || activeWorkerAttentionItems.length > 0;
  const allFinished = allTerminal || ((needsManualMerge || noMoreActionPossible) && !waitingOnWorkerAttention);

  return {
    tasksByStatus,
    statusCounts,
    runningTasks,
    readyTasks,
    activeWorkerAttentionItems,
    activeWorkerMergeConflictAttention,
    activeMainMergeAttentionItems,
    qaPendingTasks,
    quotaTasks,
    failedTasks,
    settledTasks,
    mergeRequiredTasks,
    allTerminal,
    noMoreActionPossible,
    needsManualMerge,
    waitingOnWorkerAttention,
    allFinished,
  };
}
