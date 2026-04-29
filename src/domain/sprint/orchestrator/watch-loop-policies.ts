import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import type { Subtask, CiIntelligenceSettings } from "../../../contracts/app-types.js";

export type WatchLoopDecisionStatus = "wait" | "exit" | "continue";

export interface WatchLoopDecision {
  status: WatchLoopDecisionStatus;
  reportModifier?: string;
  terminalState?: "completed" | "failed" | "cancelled" | "paused";
  pauseReason?: "awaiting_merge" | "empty" | "manual_attention" | "main_merge_blocked";
  pausePayload?: Record<string, unknown>;
  failedTaskCount?: number;
  completedTaskCount?: number;
}

export function decideMainMergeWaitOrPause(params: {
  mergeFeedback: MergeFeedbackResult;
  attentionItems: Array<{ id: string; attentionType: string }>;
  mainMergeMode: CiIntelligenceSettings["mainBranchAutoMergeMode"];
  sprintNumber: number;
}): WatchLoopDecision | null {
  const { mergeFeedback, attentionItems, mainMergeMode, sprintNumber } = params;

  const shouldPauseForMainMergeBlocker =
    attentionItems.length > 0 ||
    mergeFeedback.state === "merge_conflict" ||
    mergeFeedback.state === "failed_checks" ||
    mergeFeedback.state === "review_blocked";

  if (shouldPauseForMainMergeBlocker) {
    return {
      status: "exit",
      reportModifier: "\n⏸️ **Sprint Paused:** Main-branch merge is blocked by a conflict, failed checks, or unresolved review state. Resolve the blocker and resume the sprint.\n",
      terminalState: "paused",
      pauseReason: "main_merge_blocked",
      pausePayload: {
        sprintNumber,
        mainMergeState: mergeFeedback.state,
        prNumber: mergeFeedback.prNumber,
        prUrl: mergeFeedback.prUrl,
        hasMergeConflict: mergeFeedback.hasMergeConflict,
        attentionItemIds: attentionItems.map((item) => item.id),
        attentionTypes: attentionItems.map((item) => item.attentionType),
      },
    };
  }

  const shouldWaitForMainMerge =
    (mainMergeMode === "WHEN_GREEN" || mainMergeMode === "ALWAYS") &&
    (mergeFeedback.state === "missing_pr" ||
      mergeFeedback.state === "pending_checks" ||
      mergeFeedback.state === "ready_for_merge" ||
      mergeFeedback.state === "automerge_scheduled" ||
      mergeFeedback.state === "automerge_failed");

  if (shouldWaitForMainMerge) {
    return {
      status: "wait",
      reportModifier: "\n⏳ **Sprint Still Active:** Waiting for the final main-branch merge to finish before completing the sprint.\n",
    };
  }

  return null;
}

function partitionSubtasksByStatus(subtasks: Subtask[]) {
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

export function decideTerminalCompletion(params: {
  subtasks: Subtask[];
  manualMergeTasks: Subtask[];
}): WatchLoopDecision {
  const { subtasks, manualMergeTasks } = params;

  const { tasksByStatus, statusCounts } = partitionSubtasksByStatus(subtasks);
  const failedTaskCount = statusCounts["FAILED"] || 0;

  if (failedTaskCount > 0) {
    return {
      status: "continue",
      terminalState: "failed",
      failedTaskCount,
    };
  }

  if (manualMergeTasks.length > 0) {
    return {
      status: "continue",
      terminalState: "paused",
      pauseReason: "awaiting_merge",
      pausePayload: {
        awaitingMergeCount: manualMergeTasks.length,
      },
    };
  }

  if (subtasks.length === 0) {
    return {
      status: "continue",
      terminalState: "cancelled",
      pauseReason: "empty",
    };
  }

  return {
    status: "continue",
    terminalState: "paused",
    pauseReason: "manual_attention",
    pausePayload: {
      runningTaskIds: (tasksByStatus.get("RUNNING") || []).map((task) => task.record_id || task.id),
      readyTaskIds: (tasksByStatus.get("PENDING") || []).map((task) => task.record_id || task.id),
      blockedTaskIds: (tasksByStatus.get("BLOCKED") || []).map((task) => task.record_id || task.id),
    },
  };
}
