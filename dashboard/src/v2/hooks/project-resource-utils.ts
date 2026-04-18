import type { Sprint, TaskRecord } from "../types.js";

export function shouldUseForegroundLoading(hasLoaded: boolean, silent = false): boolean {
  return !silent && !hasLoaded;
}

export function areSprintListsEqual(current: Sprint[], next: Sprint[]): boolean {
  if (current === next) {
    return true;
  }

  if (current.length !== next.length) {
    return false;
  }

  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    
    if (left.id !== right.id) {
      return false;
    }

    // If both have updatedAt, we can use it for a fast comparison
    if (left.updatedAt && right.updatedAt) {
      if (left.updatedAt !== right.updatedAt) {
        return false;
      }
      continue;
    }

    // Fallback for missing updatedAt
    if (
      left.projectId !== right.projectId ||
      left.number !== right.number ||
      left.slug !== right.slug ||
      left.name !== right.name ||
      left.goal !== right.goal ||
      left.status !== right.status ||
      left.showcasePinned !== right.showcasePinned ||
      left.startDate !== right.startDate ||
      left.endDate !== right.endDate ||
      left.featureBranch !== right.featureBranch ||
      left.tasksCount !== right.tasksCount ||
      left.completion !== right.completion ||
      left.createdAt !== right.createdAt ||
      left.date !== right.date
    ) {
      return false;
    }
  }

  return true;
}

export function areTaskRecordListsEqual(current: TaskRecord[], next: TaskRecord[]): boolean {
  if (current === next) {
    return true;
  }

  if (current.length !== next.length) {
    return false;
  }

  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    
    if (left.id !== right.id) {
      return false;
    }

    // If both have updatedAt, we can use it for a fast comparison
    if (left.updatedAt && right.updatedAt) {
      if (left.updatedAt !== right.updatedAt) {
        return false;
      }
      continue;
    }

    // Fallback for missing updatedAt
    if (
      left.projectId !== right.projectId ||
      left.sprintId !== right.sprintId ||
      left.taskKey !== right.taskKey ||
      left.title !== right.title ||
      left.promptMarkdown !== right.promptMarkdown ||
      left.description !== right.description ||
      left.status !== right.status ||
      left.priority !== right.priority ||
      left.executorType !== right.executorType ||
      left.sortOrder !== right.sortOrder ||
      left.isIndependent !== right.isIndependent ||
      left.isMerged !== right.isMerged ||
      left.mergeIndicator !== right.mergeIndicator ||
      left.sourceType !== right.sourceType ||
      left.sourcePath !== right.sourcePath ||
      left.createdAt !== right.createdAt
    ) {
      return false;
    }

    if (left.dependsOnTaskIds.length !== right.dependsOnTaskIds.length) {
      return false;
    }

    for (let dependencyIndex = 0; dependencyIndex < left.dependsOnTaskIds.length; dependencyIndex += 1) {
      if (left.dependsOnTaskIds[dependencyIndex] !== right.dependsOnTaskIds[dependencyIndex]) {
        return false;
      }
    }
  }

  return true;
}
