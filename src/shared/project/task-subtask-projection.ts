import { AppDbStorage } from "../../repositories/app-db-storage.js";
import type { SubtaskStatus, SubtaskMergeIndicator } from "../../contracts/app-types.js";
import type { TaskRecord } from "../../contracts/project-management-types.js";

interface DependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

export function inflateTaskDependencies(storage: AppDbStorage, taskIds: string[]): Map<string, string[]> {
  const dependencyRows = storage.executeChunkedInQuery<DependencyRow>({
    sqlPrefix: "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id",
    sqlSuffix: "ORDER BY depends_on_task_id ASC",
    items: taskIds,
  });

  const dependencyMap = new Map<string, string[]>();
  for (const row of dependencyRows) {
    const current = dependencyMap.get(row.task_id) || [];
    current.push(row.depends_on_task_id);
    dependencyMap.set(row.task_id, current);
  }

  return dependencyMap;
}

export function mapPlanningStatusToRuntimeStatus(status: TaskRecord["status"]): Exclude<SubtaskStatus, undefined> {
  switch (status) {
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

export function mapRuntimeStatusToPlanningStatus(status: Exclude<SubtaskStatus, undefined>): TaskRecord["status"] | null {
  switch (status) {
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

export function toMergeIndicator(value: string | null | undefined): SubtaskMergeIndicator | undefined {
  switch (value) {
    case "CI":
    case "AUTOMERGE":
    case "MERGED":
    case "MERGE_BLOCKED":
    case "MERGE_CONFLICT":
      return value;
    default:
      return undefined;
  }
}
