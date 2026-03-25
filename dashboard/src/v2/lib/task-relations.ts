import type { Task, TaskStatus } from "../types.js";

export interface DependentTaskMetadata {
  recordId: string;
  id: string; // The display key (e.g. T-1)
  title: string;
  status: TaskStatus;
}

export type TaskDependenciesMap = Record<string, DependentTaskMetadata[]>;

/**
 * Builds a map of dependent tasks keyed by the parent task's recordId.
 * This indicates which tasks downstream rely on a given task to complete.
 *
 * @param tasks The full collection of tasks to analyze.
 * @returns A dictionary where the key is the task recordId and the value is a list of tasks that depend on it.
 */
export function buildDependentTasksMap(tasks: Task[]): TaskDependenciesMap {
  const map: TaskDependenciesMap = {};

  // Initialize the map for all tasks
  for (const task of tasks) {
    map[task.recordId] = [];
  }

  // Populate map with downstream dependents
  for (const task of tasks) {
    if (task.dependsOnTaskIds && Array.isArray(task.dependsOnTaskIds)) {
      for (const dependencyId of task.dependsOnTaskIds) {
        if (map[dependencyId]) {
          map[dependencyId].push({
            recordId: task.recordId,
            id: task.id,
            title: task.title,
            status: task.status,
          });
        }
      }
    }
  }

  return map;
}
