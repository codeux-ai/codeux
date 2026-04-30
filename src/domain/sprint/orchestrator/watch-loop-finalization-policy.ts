import type { WatchLoopDecision } from "./watch-loop-policies.js";

export type FinalizationTransitionResult =
  | { type: "failed"; failedTaskCount: number }
  | { type: "paused_awaiting_merge"; awaitingMergeCount: number }
  | { type: "cancelled_empty" }
  | {
      type: "paused_manual_attention";
      runningTaskIds: string[];
      readyTaskIds: string[];
      blockedTaskIds: string[];
    }
  | { type: "completed"; completedTaskCount: number }
  | { type: "unhandled" };

export function decideFinalizationTransition(
  decision: WatchLoopDecision
): FinalizationTransitionResult {
  if (decision.terminalState === "failed") {
    return {
      type: "failed",
      failedTaskCount: decision.failedTaskCount!,
    };
  }

  if (decision.terminalState === "paused" && decision.pauseReason === "awaiting_merge") {
    return {
      type: "paused_awaiting_merge",
      awaitingMergeCount: decision.pausePayload?.awaitingMergeCount as number,
    };
  }

  if (decision.terminalState === "cancelled" && decision.pauseReason === "empty") {
    return {
      type: "cancelled_empty",
    };
  }

  if (decision.terminalState === "paused" && decision.pauseReason === "manual_attention") {
    return {
      type: "paused_manual_attention",
      runningTaskIds: decision.pausePayload?.runningTaskIds as string[],
      readyTaskIds: decision.pausePayload?.readyTaskIds as string[],
      blockedTaskIds: decision.pausePayload?.blockedTaskIds as string[],
    };
  }

  if (decision.terminalState === "completed") {
    return {
      type: "completed",
      completedTaskCount: decision.completedTaskCount || 0,
    };
  }

  // Fallback, though we expect one of the above.
  return {
    type: "unhandled",
  };
}
