import type { DashboardStats, JulesActivity, Subtask } from "../types.js";
import { normalizeSessionName } from "./session.js";
import { getTaskProgressPhase } from "./task-progress.js";

export interface ProcessedTasksResult {
  tasks: Subtask[];
  stats: DashboardStats;
}

export const processDashboardTasks = (
  tasks: Subtask[],
  liveBySession?: Record<string, JulesActivity[]> | null
): ProcessedTasksResult => {
  const stats: DashboardStats = {
    total: tasks.length,
    running: 0,
    codingCompleted: 0,
    completed: 0,
    failed: 0,
    ci: 0,
    automerge: 0,
    merged: 0,
    mergeBlocked: 0,
    mergeConflicts: 0,
  };

  const processedTasks: Subtask[] = [];

  for (const task of tasks) {
    const phase = getTaskProgressPhase(task);
    if (phase === "RUNNING") stats.running++;
    else if (phase === "CODING_COMPLETED") stats.codingCompleted++;
    else if (phase === "COMPLETED") stats.completed++;
    else if (phase === "FAILED") stats.failed++;

    if (task.merge_indicator === "CI") stats.ci++;
    if (task.merge_indicator === "AUTOMERGE") stats.automerge++;
    if (task.merge_indicator === "MERGED" || task.is_merged) stats.merged++;
    if (task.merge_indicator === "MERGE_BLOCKED") stats.mergeBlocked++;
    if (task.merge_indicator === "MERGE_CONFLICT") stats.mergeConflicts++;

    let finalTask = task;
    if (liveBySession) {
      const sessionName = normalizeSessionName(task);
      if (sessionName) {
        const liveActivities = liveBySession[sessionName];
        if (liveActivities) {
          finalTask = { ...task, session_name: sessionName, activities: liveActivities };
        }
      }
    }
    processedTasks.push(finalTask);
  }

  return { tasks: processedTasks, stats };
};

export const mergeLiveActivities = (tasks: Subtask[], liveBySession: Record<string, JulesActivity[]>): Subtask[] => {
  return processDashboardTasks(tasks, liveBySession).tasks;
};

export const computeStats = (tasks: Subtask[]): DashboardStats => {
  return processDashboardTasks(tasks).stats;
};
