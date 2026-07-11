import type { SubtaskMergeIndicator, SubtaskStatus } from "../../contracts/app-types.js";
import type { TaskRecord, TaskStatus } from "../../contracts/project-management-types.js";

export interface SprintProgressTask {
  status: TaskStatus | SubtaskStatus;
  isMerged?: boolean;
  mergeIndicator?: TaskRecord["mergeIndicator"] | SubtaskMergeIndicator;
  /** Tool calls from task-coding provider invocations only. */
  toolCallCount?: number | null;
}

const CODING_TOOL_CALL_WEIGHT = 0.005;
const MAX_CODING_TOOL_CALLS = 100;
const CODING_COMPLETED_WEIGHT = 0.5;
const POST_CODING_WEIGHT = 0.75;
const COMPLETED_WEIGHT = 1;

const SETTLED_MERGE_INDICATORS = new Set<string>([
  "AUTOMERGE",
  "MERGED",
  "PR_ONLY",
] satisfies SubtaskMergeIndicator[]);

const POST_CODING_MERGE_INDICATORS = new Set<string>([
  "CI",
  "QA_PENDING",
  "MERGE_BLOCKED",
  "MERGE_CONFLICT",
] satisfies SubtaskMergeIndicator[]);

function normalizedStatus(status: SprintProgressTask["status"]): string {
  return status.toUpperCase();
}

function codingToolCallWeight(toolCallCount: number | null | undefined): number {
  if (
    typeof toolCallCount !== "number" ||
    !Number.isFinite(toolCallCount) ||
    !Number.isInteger(toolCallCount) ||
    toolCallCount <= 0
  ) {
    return 0;
  }

  const count = Math.min(toolCallCount, MAX_CODING_TOOL_CALLS);
  return count * CODING_TOOL_CALL_WEIGHT;
}

/**
 * Calculates a task's contribution to sprint progress without changing task state.
 */
export function calculateTaskProgress(task: SprintProgressTask): number {
  const status = normalizedStatus(task.status);
  const mergeIndicator = task.mergeIndicator;

  if (
    status === "COMPLETED" ||
    task.isMerged === true ||
    (mergeIndicator !== null && mergeIndicator !== undefined && SETTLED_MERGE_INDICATORS.has(mergeIndicator))
  ) {
    return COMPLETED_WEIGHT;
  }

  if (
    mergeIndicator !== null &&
    mergeIndicator !== undefined &&
    POST_CODING_MERGE_INDICATORS.has(mergeIndicator)
  ) {
    return POST_CODING_WEIGHT;
  }

  if (status === "CODING_COMPLETED") {
    return CODING_COMPLETED_WEIGHT;
  }

  if (status === "PENDING") {
    return 0;
  }

  return codingToolCallWeight(task.toolCallCount);
}

/**
 * Calculates weighted sprint completion as a percentage rounded to one decimal place.
 */
export function calculateSprintProgress(tasks: readonly SprintProgressTask[]): number {
  if (tasks.length === 0) {
    return 0;
  }

  const totalWeight = tasks.reduce((total, task) => total + calculateTaskProgress(task), 0);
  return Math.round((totalWeight / tasks.length) * 1000) / 10;
}
