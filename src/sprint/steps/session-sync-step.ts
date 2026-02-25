import type { JulesSession, Subtask } from "../../types.js";
import type { SessionSyncDependencies } from "../types.js";

export const runSessionSyncStep = async (
  subtasks: Subtask[],
  deps: SessionSyncDependencies,
  retryFailed: boolean
): Promise<{ subtasks: Subtask[]; sessions: JulesSession[] }> => {
  const sessionsResponse = await deps.listSessions();
  const sessions = sessionsResponse.sessions || [];

  sessions.sort((a, b) => {
    if (!a.createTime || !b.createTime) return 0;
    return new Date(b.createTime).getTime() - new Date(a.createTime).getTime();
  });

  for (const task of subtasks) {
    const match = sessions.find((session) => session.title?.includes(`[${task.id}]`));
    if (!match) {
      continue;
    }

    const sessionName = deps.resolveSessionName(match);
    const sessionId = deps.extractSessionId(match);
    task.session_name = sessionName;
    task.session_id = sessionId;
    task.session_state = match.state;

    if (sessionName) {
      try {
        task.activities = await deps.fetchRecentActivities(sessionName, 5);
      } catch {
        console.error(`Warning: Could not fetch activities for task ${task.id}`);
      }
    }

    if (match.state === "COMPLETED") {
      task.status = "COMPLETED";
      continue;
    }

    if (match.state === "FAILED") {
      if (retryFailed) {
        task.status = "PENDING";
      } else {
        task.status = "FAILED";
      }
      continue;
    }

    if (deps.isActionRequiredState(match.state)) {
      task.status = "BLOCKED";
      continue;
    }

    task.status = "RUNNING";
  }

  return { subtasks, sessions };
};
