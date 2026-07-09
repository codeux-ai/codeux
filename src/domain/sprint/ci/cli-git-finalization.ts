import type { TaskRunRecord } from "../../../contracts/execution-types.js";

export interface TaskRunEventLike {
  eventType: string;
}

export const CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT = 500;

export function isCliTaskRun(taskRun: TaskRunRecord | null): boolean {
  if (!taskRun || taskRun.provider === "jules") {
    return false;
  }
  if (!taskRun.provider && !taskRun.mode && !taskRun.sessionId && !taskRun.sessionName) {
    return false;
  }
  return Boolean(
    taskRun.mode?.includes("cli")
    || taskRun.sessionId?.startsWith("cli-")
    || taskRun.sessionName?.includes("/cli-")
  );
}

export function hasCliGitFinalized(
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): boolean {
  if (!isCliTaskRun(taskRun)) {
    return false;
  }
  if (!taskRun?.id || !listTaskRunEvents) {
    return taskRun?.state === "COMPLETED";
  }
  const events = listTaskRunEvents(taskRun.id, CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT);
  return events.some((event) => (
    event.eventType === "cli_git_pushed"
    || event.eventType === "cli_git_no_changes"
  ));
}

export function isCliTaskRunAwaitingGitFinalization(
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): boolean {
  return isCliTaskRun(taskRun) && !hasCliGitFinalized(taskRun, listTaskRunEvents);
}
