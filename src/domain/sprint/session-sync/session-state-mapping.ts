import type { TaskDispatchStatus, TaskRunState } from "../../../contracts/execution-types.js";

export type ActionRequiredStatePredicate = (state?: string) => boolean;
export type SessionSyncPlanningStatus = "pending" | "in_progress" | "coding_completed";

const isCancelledSessionState = (sessionState: string | undefined): boolean => sessionState === "CANCELLED";

export function mapSessionStateToTaskRunState(
  sessionState: string | undefined,
  isActionRequiredState: ActionRequiredStatePredicate,
  actionRequiredReplyPending = false,
): TaskRunState {
  if (sessionState === "COMPLETED") {
    return "COMPLETED";
  }
  if (sessionState === "FAILED" || sessionState === "CANCELLED") {
    return "FAILED";
  }
  if (sessionState === "QUOTA") {
    return "QUOTA";
  }
  if (sessionState === "RATE_LIMITED") {
    return "QUOTA";
  }
  if (isActionRequiredState(sessionState)) {
    return actionRequiredReplyPending ? "RUNNING" : "BLOCKED";
  }
  return "RUNNING";
}

export function mapTaskRunStateToDispatchStatus(
  state: TaskRunState,
  sessionState?: string,
): TaskDispatchStatus {
  if (state === "FAILED" && isCancelledSessionState(sessionState)) {
    return "cancelled";
  }
  switch (state) {
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "QUOTA":
      return "quota";
    case "BLOCKED":
      return "blocked";
    case "RUNNING":
    case "PENDING":
    default:
      return "running";
  }
}

export function mapTaskRunStateToPlanningStatus(state: TaskRunState): SessionSyncPlanningStatus {
  switch (state) {
    case "COMPLETED":
      return "coding_completed";
    case "RUNNING":
      return "in_progress";
    case "FAILED":
    case "BLOCKED":
    case "PENDING":
    default:
      return "pending";
  }
}

export function mergeDispatchStatus(
  currentStatus: TaskDispatchStatus | null,
  nextRunState: TaskRunState,
  sessionState?: string,
): TaskDispatchStatus {
  if (currentStatus === "cancel_requested" && nextRunState === "RUNNING") {
    return "cancel_requested";
  }
  return mapTaskRunStateToDispatchStatus(nextRunState, sessionState);
}

export function resolveDispatchErrorMessage(
  currentErrorMessage: string | null | undefined,
  nextRunState: TaskRunState,
  sessionState: string | undefined,
): string | null {
  if (nextRunState === "FAILED" && isCancelledSessionState(sessionState)) {
    return null;
  }
  if (nextRunState === "FAILED") {
    return `Provider session ${sessionState || "FAILED"}`;
  }
  if (nextRunState === "BLOCKED") {
    return `Provider session requires attention: ${sessionState || "ACTION_REQUIRED"}`;
  }
  if (nextRunState === "QUOTA") {
    return currentErrorMessage || `Provider session ${sessionState || "QUOTA"}`;
  }
  return null;
}
