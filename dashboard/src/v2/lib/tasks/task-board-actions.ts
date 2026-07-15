import type { TaskStatus } from "../../types.js";
import { getTaskLane } from "../task-board-state.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateTask } from "../../i18n/messages/tasks.js";
import { getTaskStatusLabel } from "../tasks-constants.js";

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

export function getTaskDragInstruction(isReducedMotion: boolean, locale: DashboardLocale = "en"): string {
  return isReducedMotion
    ? translateTask(locale, "dropDisabledReducedMotion")
    : translateTask(locale, "dragPointerOnly");
}

export function getTaskDropFeedback(args: {
  isReducedMotion: boolean;
  isDragging: boolean;
  targetLane: TaskStatus;
  currentStatus?: TaskStatus;
  locale?: DashboardLocale;
}): string {
  const locale = args.locale ?? "en";
  if (args.isReducedMotion) {
    return getTaskDragInstruction(true, locale);
  }

  if (!args.isDragging || !args.currentStatus) {
    return translateTask(locale, "dropInactive");
  }

  const targetStatus = resolveTaskDropStatus(args.currentStatus, args.targetLane);
  if (!targetStatus) {
    return translateTask(locale, "dropCurrentLane");
  }

  return translateTask(locale, "dropMove", { status: getTaskStatusLabel(targetStatus, locale).toLocaleLowerCase(locale) });
}
