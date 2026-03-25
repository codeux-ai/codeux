import type { DashboardStats, JulesActivity, Subtask } from "../types.js";
import { normalizeSessionName } from "./session.js";
import { getTaskProgressPhase, isTaskCompleted } from "./task-progress.js";

export const mergeLiveActivities = (tasks: Subtask[], liveBySession: Record<string, JulesActivity[]>): Subtask[] => {
  return tasks.map((task) => {
    const sessionName = normalizeSessionName(task);
    if (!sessionName) return task;
    const liveActivities = liveBySession[sessionName];
    if (!liveActivities) return task;
    return { ...task, session_name: sessionName, activities: liveActivities };
  });
};

export const computeStats = (tasks: Subtask[]): DashboardStats => {
  return tasks.reduce(
    (stats, task) => {
      const phase = getTaskProgressPhase(task);
      if (phase === "RUNNING") stats.running++;
      if (phase === "CODING_COMPLETED") stats.codingCompleted++;
      if (isTaskCompleted(task)) stats.completed++;
      if (phase === "FAILED") stats.failed++;

      if (task.merge_indicator === "CI") stats.ci++;
      if (task.merge_indicator === "AUTOMERGE") stats.automerge++;
      if (task.merge_indicator === "MERGED" || task.is_merged) stats.merged++;
      if (task.merge_indicator === "MERGE_BLOCKED") stats.mergeBlocked++;
      if (task.merge_indicator === "MERGE_CONFLICT") stats.mergeConflicts++;

      return stats;
    },
    {
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
    }
  );
};
