import type { ExecutionAttentionItemSummary, ExecutionDashboardSnapshot, ExecutionTaskDispatchSummary, SubtaskMergeIndicator } from "../../types.js";
import type { Sprint, Task } from "../types.js";
import {
  deriveTaskCiStatusPresentation,
  type CiStatusPresentation,
} from "./ci-status-presentation.js";
import { findActiveTaskHumanIntervention } from "./workflow-status-presentation.js";

const MERGE_INDICATORS = new Set<SubtaskMergeIndicator>([
  "CI",
  "AUTOMERGE",
  "MERGED",
  "MERGE_BLOCKED",
  "MERGE_CONFLICT",
  "PR_ONLY",
  "QA_PENDING",
]);

const normalizeMergeIndicator = (value: string | null): SubtaskMergeIndicator | undefined => (
  value && MERGE_INDICATORS.has(value as SubtaskMergeIndicator)
    ? value as SubtaskMergeIndicator
    : undefined
);

const dispatchRecency = (dispatch: ExecutionTaskDispatchSummary): string => (
  dispatch.finishedAt
  || dispatch.startedAt
  || dispatch.claimedAt
  || dispatch.queuedAt
  || ""
);

const latestTaskDispatch = (
  task: Task,
  dispatches: readonly ExecutionTaskDispatchSummary[],
): ExecutionTaskDispatchSummary | null => {
  let latest: ExecutionTaskDispatchSummary | null = null;
  for (const dispatch of dispatches) {
    if (
      dispatch.sprintId !== task.sprintId
      || (dispatch.taskId !== task.recordId && dispatch.taskKey !== task.id)
    ) {
      continue;
    }
    if (!latest || dispatchRecency(dispatch).localeCompare(dispatchRecency(latest)) >= 0) {
      latest = dispatch;
    }
  }
  return latest;
};

export type OverviewTaskFilter = "all" | "running" | "queued" | "completed";

/**
 * Derives active sprint IDs from a list of sprints.
 * Sprints are considered active if their status is "active".
 */
export function deriveActiveSprintIds(sprints: Sprint[]): Set<string> {
  return new Set(sprints.filter(sprint => sprint.status === "running").map(sprint => sprint.id));
}

/**
 * Filters a list of tasks to only include those belonging to active sprints.
 */
export function filterTasksToActiveSprints(tasks: Task[], activeSprintIds: Set<string>): Task[] {
  if (activeSprintIds.size === 0) {
    return [];
  }
  return tasks.filter(task => activeSprintIds.has(task.sprintId));
}

export function filterOverviewTasks(tasks: Task[], filter: OverviewTaskFilter): Task[] {
  if (filter === "all") {
    return tasks;
  }
  const status = filter === "running"
    ? "in_progress"
    : filter === "queued"
      ? "pending"
      : "completed";
  return tasks.filter((task) => task.status === status);
}

/**
 * Projects the same task CI/merge evidence used by the Tasks and Live surfaces
 * into the compact Overview task rows. The execution snapshot is realtime, so
 * this keeps the interactive workflow badge on the current PR/CI/merge stage
 * instead of falling back to the persisted task lifecycle alone.
 */
export function deriveOverviewTaskCiPresentations(
  tasks: readonly Task[],
  execution: ExecutionDashboardSnapshot | undefined,
): Map<string, CiStatusPresentation> {
  const presentations = new Map<string, CiStatusPresentation>();
  if (!execution) {
    return presentations;
  }

  for (const task of tasks) {
    const latestDispatch = latestTaskDispatch(task, execution.taskDispatches);
    const presentation = deriveTaskCiStatusPresentation({
      task: {
        record_id: task.recordId,
        id: task.id,
        sprint_id: task.sprintId,
        merge_indicator: normalizeMergeIndicator(task.mergeIndicator),
        is_merged: task.isMerged,
        pr_url: latestDispatch?.prUrl ?? undefined,
      },
      events: execution.recentEvents,
      attentionItems: execution.attentionItems,
    });
    if (presentation) {
      presentations.set(task.recordId, presentation);
    }
  }

  return presentations;
}

export function deriveOverviewTaskHumanInterventions(
  tasks: readonly Task[],
  execution: ExecutionDashboardSnapshot | undefined,
): Map<string, ExecutionAttentionItemSummary> {
  const interventions = new Map<string, ExecutionAttentionItemSummary>();
  if (!execution) return interventions;

  for (const task of tasks) {
    const latestDispatch = latestTaskDispatch(task, execution.taskDispatches);
    const intervention = findActiveTaskHumanIntervention(execution.attentionItems, {
      recordId: task.recordId,
      taskKey: task.id,
      sprintId: task.sprintId,
      dispatchId: latestDispatch?.id,
    });
    if (intervention) interventions.set(task.recordId, intervention);
  }
  return interventions;
}
