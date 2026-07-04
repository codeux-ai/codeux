import type { TaskStatus } from "../../types.js";
import { getTaskLane } from "../task-board-state.js";

const DROP_TARGET_STATUS_BY_LANE: Record<"pending" | "in_progress" | "completed", TaskStatus> = {
  pending: "pending",
  in_progress: "in_progress",
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
