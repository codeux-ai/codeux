import type { Subtask } from "../types.js";

export const normalizeSessionName = (task: Pick<Subtask, "session_name" | "session_id">): string | null => {
  if (task.session_name && task.session_name.startsWith("sessions/")) {
    return task.session_name;
  }
  if (task.session_id) {
    return `sessions/${String(task.session_id).replace(/^sessions\//, "")}`;
  }
  return null;
};
