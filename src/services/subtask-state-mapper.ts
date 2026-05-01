import type { Subtask, SubtaskMergeIndicator, SubtaskStatus } from "../contracts/app-types.js";

type PlanningTaskStatus = "pending" | "in_progress" | "coding_completed" | "completed" | "QA_REVIEW_FAILED";
type TaskRunState = Exclude<SubtaskStatus, undefined>;

export function mapPlanningStatusToRuntimeStatus(status: PlanningTaskStatus): TaskRunState {
  switch (status) {
    case "QA_REVIEW_FAILED":
      return "QA_REVIEW_FAILED";
    case "coding_completed":
      return "CODING_COMPLETED";
    case "completed":
      return "COMPLETED";
    case "in_progress":
      return "RUNNING";
    case "pending":
    default:
      return "PENDING";
  }
}

export function mapRuntimeStatusToPlanningStatus(status: TaskRunState): PlanningTaskStatus | null {
  switch (status) {
    case "QA_REVIEW_FAILED":
      return "QA_REVIEW_FAILED";
    case "CODING_COMPLETED":
      return "coding_completed";
    case "RUNNING":
      return "in_progress";
    case "COMPLETED":
      return "completed";
    case "PENDING":
      return "pending";
    default:
      return null;
  }
}

export function normalizeImportedTaskStatus(status: string | undefined): PlanningTaskStatus {
  if (status === "QA_REVIEW_FAILED") {
    return "QA_REVIEW_FAILED";
  }
  if (status === "CODING_COMPLETED") {
    return "coding_completed";
  }
  if (status === "COMPLETED") {
    return "completed";
  }
  if (status === "RUNNING") {
    return "in_progress";
  }
  return "pending";
}

export function resolveSubtaskStatus(planningStatus: PlanningTaskStatus, latestRunState?: TaskRunState | string): Subtask["status"] {
  if (latestRunState && latestRunState !== "COMPLETED") {
    return latestRunState as Subtask["status"];
  }

  return mapPlanningStatusToRuntimeStatus(planningStatus);
}

export function toMergeIndicator(value: string | null | undefined): SubtaskMergeIndicator | undefined {
  switch (value) {
    case "CI":
    case "AUTOMERGE":
    case "MERGED":
    case "MERGE_BLOCKED":
    case "MERGE_CONFLICT":
    case "QA_PENDING":
      return value;
    default:
      return undefined;
  }
}
