import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import type { Subtask, CiIntelligenceSettings } from "../../../contracts/app-types.js";
import { partitionSubtasksByStatus } from "../task-transition-state.js";

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

/**
 * Returns true when the attention item requires a human to act — i.e. it has escalated
 * beyond worker ownership. Items still assigned to a worker do not block the sprint.
 */
export function isHumanEscalatedAttentionItem(item: { attentionType: string; ownerType?: string }): boolean {
  // An item is human-escalated when it is explicitly owned by a human, or when its type
  // signals that the worker could not resolve it automatically.
  if (item.ownerType === "human") {
    return true;
  }
  // human_escalation_required and dashboard_reply_required are created only after a worker
  // has tried and failed — they always require human action.
  if (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required") {
    return true;
  }
  // Worker-owned merge conflict items mean the worker is actively handling the conflict.
  return false;
}

export function decideMainMergeWaitOrPause(params: {
  mergeFeedback: MergeFeedbackResult;
  attentionItems: Array<{ id: string; attentionType: string; ownerType?: string }>;
  mainMergeMode: CiIntelligenceSettings["mainBranchAutoMergeMode"];
  sprintNumber: number;
}): WatchLoopDecision | null {
  const { mergeFeedback, attentionItems, mainMergeMode, sprintNumber } = params;

  // Separate items that require human action from those that a worker is still handling.
  // Worker-owned items indicate the sprint system is actively resolving the conflict;
  // only human-escalated items (or raw merge-state blockers without an assigned worker)
  // should cause the sprint to pause.
  const humanEscalatedItems = attentionItems.filter(isHumanEscalatedAttentionItem);
  const workerHandledItems = attentionItems.filter((item) => !isHumanEscalatedAttentionItem(item));
  const hasWorkerHandlingMainMergeBlocker = workerHandledItems.length > 0;

  // Pause only when a human must act: either an explicit escalation item exists, or
  // the merge state itself is blocked without any worker taking over (no attention item
  // was opened because the worker feature is disabled or not yet assigned).
  const shouldPauseForMainMergeBlocker =
    humanEscalatedItems.length > 0 ||
    (!hasWorkerHandlingMainMergeBlocker && (
      mergeFeedback.state === "merge_conflict" ||
      mergeFeedback.state === "failed_checks" ||
      mergeFeedback.state === "review_blocked"
    ));

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

  // A worker is actively handling the main-merge blocker — keep the sprint alive and wait.
  if (hasWorkerHandlingMainMergeBlocker) {
    return {
      status: "wait",
      reportModifier: "\n⏳ **Sprint Still Active:** A worker is resolving the main-branch merge blocker. Waiting for the worker to complete before finishing the sprint.\n",
    };
  }

  const shouldWaitForMainMerge =
    (mainMergeMode === "WHEN_GREEN" || mainMergeMode === "ALWAYS") &&
    (mergeFeedback.state === "missing_pr" ||
      mergeFeedback.state === "pending_checks" ||
      mergeFeedback.state === "ready_for_merge" ||
      mergeFeedback.state === "automerge_succeeded" ||
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
