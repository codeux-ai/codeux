import type { JulesSession, Subtask } from "../../contracts/app-types.js";
import type { SessionSyncDependencies } from "../sprint-types.js";
import { buildTaskRunKey, extractTaskRunKeyFromTitle } from "../../services/task-run-key.js";

export const runSessionSyncStep = async (
  subtasks: Subtask[],
  deps: SessionSyncDependencies,
  retryFailed: boolean,
  context: { repoPath: string; sprintNumber: number }
): Promise<{ subtasks: Subtask[]; sessions: JulesSession[] }> => {
  const sessionsResponse = await deps.listSessions();
  const sessions = sessionsResponse.sessions || [];

  sessions.sort((a, b) => {
    if (!a.createTime || !b.createTime) return 0;
    return new Date(b.createTime).getTime() - new Date(a.createTime).getTime();
  });

  const sessionMap = new Map<string, JulesSession>();
  for (const session of sessions) {
    const runKey = extractTaskRunKeyFromTitle(session.title);
    if (runKey && !sessionMap.has(runKey)) {
      sessionMap.set(runKey, session);
    }
  }

  for (const task of subtasks) {
    const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
    const match = sessionMap.get(expectedRunKey);
    if (!match) {
      continue;
    }

    const sessionName = deps.resolveSessionName(match);
    const sessionId = deps.extractSessionId(match);
    task.session_name = sessionName;
    task.session_id = sessionId;
    task.session_state = match.state;
    if (match.provider) {
      task.provider = match.provider;
    }

    const pullRequestOutput = Array.isArray(match.outputs)
      ? match.outputs.find((entry) => entry && typeof entry === "object" && "pullRequest" in entry)
      : undefined;
    const pullRequestData = pullRequestOutput && typeof pullRequestOutput.pullRequest === "object"
      ? pullRequestOutput.pullRequest as Record<string, unknown>
      : null;
    if (pullRequestData) {
      if (typeof pullRequestData.url === "string") {
        task.pr_url = pullRequestData.url;
      }
      if (typeof pullRequestData.workerBranch === "string") {
        task.worker_branch = pullRequestData.workerBranch;
      }
    }

    if (sessionName) {
      try {
        task.activities = await deps.fetchRecentActivities(sessionName, 5);
      } catch {
        deps.logger.warn("Could not fetch activities for task", { taskId: task.id });
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
