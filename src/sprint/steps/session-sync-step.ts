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

  const uniqueSessionNames = new Set<string>();
  for (const task of subtasks) {
    const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
    const match = sessionMap.get(expectedRunKey);
    if (match) {
      const sessionName = deps.resolveSessionName(match);
      if (sessionName) {
        uniqueSessionNames.add(sessionName);
      }
    }
  }

  const activitiesMap = new Map<string, any[]>();
  const sessionNameArray = Array.from(uniqueSessionNames);
  const chunkSize = 5;

  for (let i = 0; i < sessionNameArray.length; i += chunkSize) {
    const chunk = sessionNameArray.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (sessionName) => {
        try {
          const activities = await deps.fetchRecentActivities(sessionName, 5);
          activitiesMap.set(sessionName, activities);
        } catch {
          deps.logger.warn("Could not fetch activities for session", { sessionName });
        }
      })
    );
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

    if (sessionName && activitiesMap.has(sessionName)) {
      task.activities = activitiesMap.get(sessionName);
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
