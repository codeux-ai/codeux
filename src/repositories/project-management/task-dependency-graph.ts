import type { TaskRecord } from "../../contracts/project-management-types.js";

export function validateTaskDependencies(
  taskId: string,
  sprintId: string,
  proposedDependencies: string[],
  sprintTasks: TaskRecord[]
): void {
  // Reject self-dependencies
  if (proposedDependencies.includes(taskId)) {
    throw new Error(`Task ${taskId} cannot depend on itself`);
  }

  // Build a map of valid sprint tasks for quick lookup
  const sprintTaskMap = new Map<string, TaskRecord>();
  for (const task of sprintTasks) {
    if (task.sprintId === sprintId) {
      sprintTaskMap.set(task.id, task);
    }
  }

  // Verify all dependencies are in the same sprint
  for (const depId of proposedDependencies) {
    if (!sprintTaskMap.has(depId) && depId !== taskId) {
      throw new Error(`Dependency task ${depId} does not belong to the same sprint ${sprintId}`);
    }
  }

  // Check for cycles using DFS
  // We represent the graph as an adjacency list: Map<taskId, dependsOnTaskIds[]>
  const graph = new Map<string, string[]>();

  for (const task of sprintTasks) {
    if (task.id === taskId) {
      // Use proposed dependencies for the task being created/updated
      graph.set(task.id, proposedDependencies);
    } else {
      graph.set(task.id, task.dependsOnTaskIds);
    }
  }

  // If this is a create operation, the task might not be in sprintTasks yet
  if (!graph.has(taskId)) {
    graph.set(taskId, proposedDependencies);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(currentNode: string): boolean {
    if (recursionStack.has(currentNode)) {
      return true;
    }
    if (visited.has(currentNode)) {
      return false;
    }

    visited.add(currentNode);
    recursionStack.add(currentNode);

    const neighbors = graph.get(currentNode) || [];
    for (const neighbor of neighbors) {
      if (hasCycle(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(currentNode);
    return false;
  }

  // Start cycle detection from the task being modified/created
  // If adding this task/dependencies creates a cycle, it will be reachable from this node
  if (hasCycle(taskId)) {
    throw new Error(`Adding dependencies to task ${taskId} would create a circular dependency graph`);
  }
}
