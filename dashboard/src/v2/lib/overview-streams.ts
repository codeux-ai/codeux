import type { Sprint, Task } from "../types.js";

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
