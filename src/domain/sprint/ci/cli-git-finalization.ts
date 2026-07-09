import type { TaskRunRecord } from "../../../contracts/execution-types.js";

export interface TaskRunEventLike {
  eventType: string;
  payload?: Record<string, unknown> | null;
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

export function hasCliGitNoChanges(
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): boolean {
  if (!isCliTaskRun(taskRun) || !taskRun?.id || !listTaskRunEvents) {
    return false;
  }
  const events = listTaskRunEvents(taskRun.id, CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT);
  return events.some((event) => event.eventType === "cli_git_no_changes");
}

export function hasCliGitPushed(
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): boolean {
  if (!isCliTaskRun(taskRun) || !taskRun?.id || !listTaskRunEvents) {
    return false;
  }
  const events = listTaskRunEvents(taskRun.id, CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT);
  return events.some((event) => event.eventType === "cli_git_pushed");
}

export function resolveCliGitPushedWorkerBranch(
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): string | null {
  if (!isCliTaskRun(taskRun) || !taskRun?.id || !listTaskRunEvents) {
    return null;
  }
  const events = listTaskRunEvents(taskRun.id, CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT);
  for (const event of events) {
    if (event.eventType !== "cli_git_pushed") continue;
    const payload = event.payload ?? {};
    const branch = typeof payload.pushedBranch === "string"
      ? payload.pushedBranch.trim()
      : typeof payload.workerBranch === "string"
        ? payload.workerBranch.trim()
        : "";
    if (branch) {
      return branch;
    }
  }
  return null;
}

export function isCliTaskRunAwaitingGitFinalization(
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): boolean {
  return isCliTaskRun(taskRun) && !hasCliGitFinalized(taskRun, listTaskRunEvents);
}
