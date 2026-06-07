import type { Subtask } from "../../../contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import { isCompletedTaskSettled } from "../task-merge-state.js";

export function isMainMergeAttentionItem(item: {
  attentionType: string;
  payload: Record<string, unknown> | null;
}): boolean {
  const payload = item.payload || {};
  const isMainMergeConflict = item.attentionType === "merge_conflict" && payload.mergeStage === "main";
  const isMainMergeConflictHandoff = (
    (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
    && payload.sourceAttentionType === "merge_conflict"
    && payload.mergeStage === "main"
  );
  return isMainMergeConflict || isMainMergeConflictHandoff;
}

export function partitionSubtasksByStatus(subtasks: Subtask[]) {
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

export function evaluateSprintRunState(params: {
  subtasks: Subtask[];
  manualMergeTasks: Subtask[];
  workerEscalatedMergeConflictTasks: Subtask[];
  activeProjectAttentionItems: ProjectAttentionItemRecord[];
  sprintRunId: string;
  githubMode?: "REMOTE" | "LOCAL";
}) {
  const { subtasks, manualMergeTasks, workerEscalatedMergeConflictTasks, activeProjectAttentionItems, sprintRunId, githubMode } = params;

  const { tasksByStatus, statusCounts } = partitionSubtasksByStatus(subtasks);

  const runningTasks = tasksByStatus.get("RUNNING") || [];
  const readyTasks = tasksByStatus.get("PENDING") || [];
  const qaPendingTasks = subtasks.filter((task) => task.merge_indicator === "QA_PENDING");
  const activeWorkerAttentionItems = activeProjectAttentionItems.filter((item) => item.ownerType === "worker");
  const activeWorkerMergeConflictAttention = activeWorkerAttentionItems.some((item) => item.attentionType === "merge_conflict");
  const activeMainMergeAttentionItems = activeProjectAttentionItems.filter((item) => (
    item.sprintRunId === sprintRunId && isMainMergeAttentionItem(item)
  ));

  let settledCount = 0;
  for (const task of subtasks) {
    if (isCompletedTaskSettled(task, { githubMode })) {
      settledCount++;
    }
  }

  const allTerminal = subtasks.length > 0 && ((statusCounts["FAILED"] || 0) + settledCount) === subtasks.length;
  const quotaTasks = tasksByStatus.get("QUOTA") || [];
  const noMoreActionPossible = runningTasks.length === 0
    && readyTasks.length === 0
    && quotaTasks.length === 0
    && qaPendingTasks.length === 0;
  const needsManualMerge = manualMergeTasks.length > 0;
  const waitingOnWorkerAttention = workerEscalatedMergeConflictTasks.length > 0
    || activeWorkerMergeConflictAttention
    || activeWorkerAttentionItems.length > 0;

  const allFinished = allTerminal || ((needsManualMerge || noMoreActionPossible) && !waitingOnWorkerAttention);

  return {
    runningTasks,
    readyTasks,
    activeWorkerAttentionItems,
    activeWorkerMergeConflictAttention,
    activeMainMergeAttentionItems,
    qaPendingTasks,
    allTerminal,
    quotaTasks,
    noMoreActionPossible,
    needsManualMerge,
    waitingOnWorkerAttention,
    allFinished,
  };
}
