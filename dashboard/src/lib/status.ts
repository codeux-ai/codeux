import type { DashboardStats, JulesActivity, Subtask } from "../types.js";
import { normalizeSessionName } from "./session.js";

export const mergeLiveActivities = (tasks: Subtask[], liveBySession: Record<string, JulesActivity[]>): Subtask[] => {
  return tasks.map((task) => {
    const sessionName = normalizeSessionName(task);
    if (!sessionName) return task;
    const liveActivities = liveBySession[sessionName];
    if (!liveActivities) return task;
    return { ...task, session_name: sessionName, activities: liveActivities };
  });
};

export const computeStats = (tasks: Subtask[]): DashboardStats => ({
  total: tasks.length,
  running: tasks.filter((task) => task.status === "RUNNING").length,
  completed: tasks.filter((task) => task.status === "COMPLETED").length,
  failed: tasks.filter((task) => task.status === "FAILED").length,
  ci: tasks.filter((task) => task.merge_indicator === "CI").length,
  automerge: tasks.filter((task) => task.merge_indicator === "AUTOMERGE").length,
  merged: tasks.filter((task) => task.merge_indicator === "MERGED" || task.is_merged).length,
  mergeBlocked: tasks.filter((task) => task.merge_indicator === "MERGE_BLOCKED").length,
});
