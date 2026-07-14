import type { TaskStatus } from "../../types.js";
import { getTaskLane } from "../task-board-state.js";

const DROP_TARGET_STATUS_BY_LANE: Record<TaskStatus, TaskStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  coding_completed: "in_progress",
  QA_REVIEW_FAILED: "in_progress",
  completed: "completed",
};

export function resolveTaskDropStatus(
  currentStatus: TaskStatus,
  targetLane: TaskStatus
): TaskStatus | null {
  const currentLane = getTaskLane(currentStatus);
  const normalizedTargetLane = getTaskLane(targetLane);

  if (currentLane === normalizedTargetLane) {
    return null;
  }

  return DROP_TARGET_STATUS_BY_LANE[normalizedTargetLane];
}

export function getTaskDragInstruction(isReducedMotion: boolean): string {
  return isReducedMotion
    ? "Drag disabled because reduced motion is enabled."
    : "Pointer drag only. Keyboard reordering is not supported.";
}

export function getTaskDropFeedback(args: {
  isReducedMotion: boolean;
  isDragging: boolean;
  targetLane: TaskStatus;
  currentStatus?: TaskStatus;
}): string {
  if (args.isReducedMotion) {
    return getTaskDragInstruction(true);
  }

  if (!args.isDragging || !args.currentStatus) {
    return "Drop target inactive.";
  }

  const targetStatus = resolveTaskDropStatus(args.currentStatus, args.targetLane);
  if (!targetStatus) {
    return "Drop target is the current lane.";
  }

  return `Drop will move task to ${targetStatus.replace(/_/g, " ")}.`;
}
