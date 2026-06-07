import type { DashboardStats, JulesActivity, Subtask } from "../types.js";
import { normalizeSessionName } from "./session.js";
import { getTaskProgressPhase } from "./task-progress.js";

export interface ProcessedTasksResult {
  tasks: Subtask[];
  stats: DashboardStats;
}

export const processDashboardTasks = (
  tasks: Subtask[],
  liveBySession?: Record<string, JulesActivity[]> | null,
): ProcessedTasksResult => {
  const stats: DashboardStats = {
    total: tasks.length,
    running: 0,
    codingCompleted: 0,
    completed: 0,
    failed: 0,
    ci: 0,
    qa: 0,
    automerge: 0,
    merged: 0,
    mergeBlocked: 0,
    mergeConflicts: 0,
  };

  const processedTasks: Subtask[] = [];

  for (const task of tasks) {
    const phase = getTaskProgressPhase(task);

    if (phase === "RUNNING") stats.running += 1;
    else if (phase === "CODING_COMPLETED") stats.codingCompleted += 1;
    else if (phase === "COMPLETED") stats.completed += 1;
    else if (phase === "FAILED") stats.failed += 1;

    if (task.merge_indicator === "CI") stats.ci += 1;
    else if (task.merge_indicator === "QA_PENDING") stats.qa += 1;
    else if (task.merge_indicator === "AUTOMERGE") stats.automerge += 1;
    else if (task.merge_indicator === "MERGE_BLOCKED") stats.mergeBlocked += 1;
    else if (task.merge_indicator === "MERGE_CONFLICT") stats.mergeConflicts += 1;

    if (task.merge_indicator === "MERGED" || task.is_merged) {
      stats.merged += 1;
    }

    if (!liveBySession) {
      processedTasks.push(task);
      continue;
    }

    const sessionName = normalizeSessionName(task);
    if (!sessionName) {
      processedTasks.push(task);
      continue;
    }

    const liveActivities = liveBySession[sessionName];
    if (!liveActivities) {
      processedTasks.push(task);
      continue;
    }

    processedTasks.push({ ...task, session_name: sessionName, activities: liveActivities });
  }

  return { tasks: processedTasks, stats };
};

export const mergeLiveActivities = (tasks: Subtask[], liveBySession: Record<string, JulesActivity[]>): Subtask[] => {
  return processDashboardTasks(tasks, liveBySession).tasks;
};

export const computeStats = (tasks: Subtask[]): DashboardStats => {
  return processDashboardTasks(tasks).stats;
};
