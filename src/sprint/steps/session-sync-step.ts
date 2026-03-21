import type { JulesActivity, JulesSession, Subtask } from "../../contracts/app-types.js";
import type { TaskRunRecord, TaskDispatchStatus, TaskRunState } from "../../contracts/execution-types.js";
import type { SessionSyncDependencies } from "../sprint-types.js";
import { buildTaskRunKey, extractTaskRunKeyFromTitle } from "../../services/task-run-key.js";
import { isQuotaCooldownActive } from "../../shared/providers/provider-error-classifier.js";

const mapSessionStateToTaskRunState = (
  sessionState: string | undefined,
  isActionRequiredState: SessionSyncDependencies["isActionRequiredState"],
): TaskRunState => {
  if (sessionState === "COMPLETED") {
    return "COMPLETED";
  }
  if (sessionState === "FAILED") {
    return "FAILED";
  }
  if (sessionState === "QUOTA") {
    return "QUOTA";
  }
  if (isActionRequiredState(sessionState)) {
    return "BLOCKED";
  }
  return "RUNNING";
};

const mapTaskRunStateToDispatchStatus = (state: TaskRunState): TaskDispatchStatus => {
  switch (state) {
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "QUOTA":
      return "quota";
    case "BLOCKED":
      return "blocked";
    case "RUNNING":
    case "PENDING":
    default:
      return "running";
  }
};

const mapTaskRunStateToPlanningStatus = (state: TaskRunState): "pending" | "in_progress" | "coding_completed" => {
  switch (state) {
    case "COMPLETED":
      return "coding_completed";
    case "RUNNING":
      return "in_progress";
    case "FAILED":
    case "BLOCKED":
    case "PENDING":
    default:
      return "pending";
  }
};

const mergeDispatchStatus = (
  currentStatus: TaskDispatchStatus | null,
  nextRunState: TaskRunState,
): TaskDispatchStatus => {
  if (currentStatus === "cancel_requested" && nextRunState === "RUNNING") {
    return "cancel_requested";
  }
  return mapTaskRunStateToDispatchStatus(nextRunState);
};

const getActivityPreview = (activity: JulesActivity): string => {
  if (typeof activity.agentMessaged?.agentMessage === "string" && activity.agentMessaged.agentMessage.trim()) {
    return activity.agentMessaged.agentMessage.trim();
  }
  if (typeof activity.userMessaged?.userMessage === "string" && activity.userMessaged.userMessage.trim()) {
    return activity.userMessaged.userMessage.trim();
  }
  if (typeof activity.progressUpdated?.title === "string" && activity.progressUpdated.title.trim()) {
    return activity.progressUpdated.title.trim();
  }
  if (typeof activity.progressUpdated?.description === "string" && activity.progressUpdated.description.trim()) {
    return activity.progressUpdated.description.trim();
  }
  if (typeof activity.description === "string" && activity.description.trim()) {
    return activity.description.trim();
  }
  return "Activity updated";
};

const getActivityKind = (activity: JulesActivity): string => {
  if (activity.sessionCompleted) return "session_completed";
  if (activity.sessionFailed) return "session_failed";
  if (activity.planApproved) return "plan_approved";
  if (activity.planGenerated) return "plan_generated";
  if (activity.progressUpdated) return "progress_updated";
  if (activity.agentMessaged) return "agent_message";
  if (activity.userMessaged) return "user_message";
  return "activity";
};

const resolveWorkerBranch = (session: JulesSession): string | null => {
  const output = Array.isArray(session.outputs)
    ? session.outputs.find((entry) => entry && typeof entry === "object" && "pullRequest" in entry)
    : undefined;
  const branch = output && typeof output.pullRequest === "object"
    ? (output.pullRequest as Record<string, unknown>).workerBranch
    : null;
  return typeof branch === "string" && branch.trim().length > 0 ? branch : null;
};

const resolvePrUrl = (session: JulesSession): string | null => {
  const output = Array.isArray(session.outputs)
    ? session.outputs.find((entry) => entry && typeof entry === "object" && "pullRequest" in entry)
    : undefined;
  const url = output && typeof output.pullRequest === "object"
    ? (output.pullRequest as Record<string, unknown>).url
    : null;
  return typeof url === "string" && url.trim().length > 0 ? url : null;
};

const syncExecutionRunState = (
  deps: SessionSyncDependencies,
  task: Subtask,
  session: JulesSession,
  activities: JulesActivity[] | undefined,
): void => {
  if (!deps.executionRepository || !deps.sprintRunId || !task.record_id) {
    return;
  }

  const taskRun = deps.executionRepository.getLatestTaskRun(task.record_id, deps.sprintRunId);
  if (!taskRun) {
    return;
  }

  const sessionName = deps.resolveSessionName(session) || taskRun.sessionName;
  const sessionId = deps.extractSessionId(session) || taskRun.sessionId;
  const provider = session.provider || taskRun.provider;
  const workerBranch = resolveWorkerBranch(session) || taskRun.workerBranch;
  const prUrl = resolvePrUrl(session) || taskRun.prUrl;
  const nextRunState = mapSessionStateToTaskRunState(session.state, deps.isActionRequiredState);
  const now = new Date().toISOString();
  const currentDispatch = taskRun.dispatchId
    ? deps.executionRepository.getTaskDispatch(taskRun.dispatchId)
    : null;
  const nextFinishedAt = nextRunState === "RUNNING"
    ? null
    : (taskRun.finishedAt || currentDispatch?.finishedAt || now);
  const nextDurationMs = nextRunState === "RUNNING" || !taskRun.startedAt
    ? null
    : Math.max(0, new Date(nextFinishedAt || now).getTime() - new Date(taskRun.startedAt).getTime());

  deps.executionRepository.updateTaskRun(taskRun.id, {
    sessionId,
    sessionName,
    provider,
    workerBranch,
    prUrl,
    state: nextRunState,
    startedAt: taskRun.startedAt || now,
    finishedAt: nextFinishedAt,
    durationMs: nextDurationMs,
  });

  if (taskRun.dispatchId) {
    deps.executionRepository.updateTaskDispatch(taskRun.dispatchId, {
      status: mergeDispatchStatus(currentDispatch?.status || null, nextRunState),
      startedAt: taskRun.startedAt || now,
      finishedAt: nextRunState === "RUNNING" ? null : (currentDispatch?.finishedAt || nextFinishedAt),
      lastHeartbeatAt: now,
      errorMessage: nextRunState === "FAILED"
        ? `Provider session ${session.state || "FAILED"}`
        : nextRunState === "BLOCKED"
          ? `Provider session requires attention: ${session.state || "ACTION_REQUIRED"}`
          : null,
    });
    if (nextRunState !== "RUNNING" && taskRun.sprintRunId) {
      deps.executionRepository.finalizeSprintRunCancellationIfIdle(taskRun.sprintRunId);
    }
  }

  deps.projectManagementRepository?.updateTask(task.record_id, {
    status: mapTaskRunStateToPlanningStatus(nextRunState),
  });

  const sessionSyncKey = [
    "session-sync",
    sessionId || sessionName || taskRun.id,
    session.state || "RUNNING",
    provider || "",
    workerBranch || "",
    prUrl || "",
  ].join(":");
  deps.executionRepository.appendTaskRunEvent(taskRun.id, "session_state_synced", "provider", {
    sessionState: session.state || null,
    taskRunState: nextRunState,
    provider,
    sessionId,
    sessionName,
    workerBranch,
    prUrl,
  }, {
    sourceEventKey: sessionSyncKey,
  });

  for (const activity of activities || []) {
    if (!activity || typeof activity !== "object" || typeof activity.id !== "string") {
      continue;
    }

    deps.executionRepository.appendTaskRunEvent(taskRun.id, "provider_activity", activity.originator || "provider", {
      activityId: activity.id,
      sessionId,
      sessionName,
      provider,
      kind: getActivityKind(activity),
      preview: getActivityPreview(activity),
      description: typeof activity.description === "string" ? activity.description : null,
    }, {
      createdAt: typeof activity.createTime === "string" && activity.createTime.trim().length > 0 ? activity.createTime : undefined,
      sourceEventKey: `activity:${activity.id}`,
    });
  }
};

export const runSessionSyncStep = async (
  subtasks: Subtask[],
  deps: SessionSyncDependencies,
  retryFailed: boolean,
  context: { repoPath: string; sprintNumber: number },
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

  const activitiesMap = new Map<string, JulesActivity[]>();
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

    syncExecutionRunState(
      deps,
      task,
      match,
      sessionName ? activitiesMap.get(sessionName) : undefined,
    );

    if (match.state === "COMPLETED") {
      task.status = "CODING_COMPLETED";
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

    if (match.state === "QUOTA") {
      // Check if the quota cooldown has expired by looking at the latest dispatch error
      let cooldownActive = true;
      if (task.record_id && task.project_id && deps.executionRepository) {
        const dispatches = deps.executionRepository.listTaskDispatches({
          projectId: task.project_id,
          taskId: task.record_id,
        });
        const withError = dispatches.filter((d) => d.errorMessage);
        const latestError = withError.length > 0 ? withError[withError.length - 1].errorMessage : null;
        cooldownActive = isQuotaCooldownActive(latestError);
      }
      if (cooldownActive) {
        task.status = "QUOTA";
      } else if (retryFailed) {
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
