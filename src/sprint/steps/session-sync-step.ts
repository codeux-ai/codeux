import type { JulesActivity, JulesSession, Subtask } from "../../contracts/app-types.js";
import type { TaskRunRecord, TaskDispatchStatus, TaskRunState } from "../../contracts/execution-types.js";
import type { SessionSyncDependencies } from "../sprint-types.js";
import { buildTaskRunKey, extractTaskRunKeyFromTitle } from "../../services/task-run-key.js";
import type { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { applyPendingTaskRuntimeReset } from "../../domain/sprint/task-reset-state.js";
import { isCompletedTaskSettled } from "../../domain/sprint/task-merge-state.js";
import {
  extractProviderErrorCategory,
  isQuotaCooldownActive,
  isRetryAfterActive,
} from "../../shared/providers/provider-error-classifier.js";



const extractGitMetrics = (session: JulesSession): Record<string, unknown> | null => {
  const pullRequestOutput = Array.isArray(session.outputs)
    ? session.outputs.find((entry) => entry && typeof entry === "object" && "pullRequest" in entry)
    : undefined;
  const pr = pullRequestOutput && typeof pullRequestOutput.pullRequest === "object"
    ? pullRequestOutput.pullRequest as Record<string, unknown>
    : null;

  if (!pr) return null;

  const parseStat = (val: unknown) => typeof val === "number" && !isNaN(val) ? val : (typeof val === "string" && !isNaN(parseInt(val, 10)) ? parseInt(val, 10) : undefined);

  return {
    filesChanged: parseStat(pr.filesChanged),
    insertions: parseStat(pr.insertions),
    deletions: parseStat(pr.deletions),
    workerBranch: typeof pr.workerBranch === "string" ? pr.workerBranch : undefined,
    prUrl: typeof pr.url === "string" ? pr.url : undefined,
  };
};

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
  if (sessionState === "RATE_LIMITED") {
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

const resolveDispatchErrorMessage = (
  currentErrorMessage: string | null | undefined,
  nextRunState: TaskRunState,
  sessionState: string | undefined,
): string | null => {
  if (nextRunState === "FAILED") {
    return `Provider session ${sessionState || "FAILED"}`;
  }
  if (nextRunState === "BLOCKED") {
    return `Provider session requires attention: ${sessionState || "ACTION_REQUIRED"}`;
  }
  if (nextRunState === "QUOTA") {
    return currentErrorMessage || `Provider session ${sessionState || "QUOTA"}`;
  }
  return null;
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

const buildProviderActivityEventPayload = (
  activity: JulesActivity,
  sessionId: string | null,
  sessionName: string | null,
  provider: string | null,
): Record<string, unknown> => ({
  activityId: activity.id,
  activityName: activity.name,
  sessionId,
  sessionName,
  provider,
  kind: getActivityKind(activity),
  preview: getActivityPreview(activity),
  description: typeof activity.description === "string" ? activity.description : null,
  agentMessaged: activity.agentMessaged || null,
  userMessaged: activity.userMessaged || null,
  progressUpdated: activity.progressUpdated || null,
  planGenerated: activity.planGenerated || null,
  planApproved: activity.planApproved || null,
  sessionFailed: activity.sessionFailed || null,
  sessionCompleted: activity.sessionCompleted ?? null,
});

const isForeignSessionMatch = (
  deps: SessionSyncDependencies,
  task: Subtask,
  session: JulesSession,
): boolean => {
  if (
    !deps.executionRepository
    || typeof deps.executionRepository.getLatestTaskRunBySessionId !== "function"
    || !task.record_id
    || !task.project_id
    || !task.sprint_id
  ) {
    return false;
  }

  const sessionId = deps.extractSessionId(session)
    || deps.resolveSessionName(session)?.replace(/^sessions\//, "")
    || null;
  if (!sessionId) {
    return false;
  }

  const existingRun = deps.executionRepository.getLatestTaskRunBySessionId(sessionId);
  if (!existingRun) {
    return false;
  }

  return existingRun.projectId !== task.project_id
    || existingRun.sprintId !== task.sprint_id
    || existingRun.taskId !== task.record_id;
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

const syncExecutionRunState = async (
  deps: SessionSyncDependencies,
  task: Subtask,
  session: JulesSession,
  activities: JulesActivity[] | undefined,
): Promise<void> => {
  if (!deps.executionRepository || !deps.sprintRunId || !task.record_id) {
    return;
  }

  const taskRun = deps.executionRepository.getLatestTaskRun(task.record_id, deps.sprintRunId);
  if (!taskRun) {
    return;
  }

  const wasTerminal = taskRun.state === "COMPLETED" || taskRun.state === "FAILED";
  const currentDispatch = taskRun.dispatchId
    ? deps.executionRepository.getTaskDispatch(taskRun.dispatchId)
    : null;
  const wasDispatchTerminal = !currentDispatch || currentDispatch.finishedAt !== null;
  const nextRunState = mapSessionStateToTaskRunState(session.state, deps.isActionRequiredState);
  // A provider session can come back to life after it had finished — e.g. a
  // Jules session continued with QA follow-up work, or a task that was rerun.
  // When that happens the local run is terminal but the remote session is
  // active again (RUNNING / awaiting action), so we must NOT short-circuit;
  // otherwise the task is left showing its old completed status while a fresh
  // session is actively working (the stale-status-on-rerun bug). A genuinely
  // merged task is excluded — it is done for good and its session activity, if
  // any, is stale.
  const sessionReactivated = !task.is_merged
    && (nextRunState === "RUNNING" || nextRunState === "BLOCKED");

  if (wasTerminal && wasDispatchTerminal && !sessionReactivated) {
    return;
  }

  const sessionName = deps.resolveSessionName(session) || taskRun.sessionName;
  const sessionId = deps.extractSessionId(session) || taskRun.sessionId;
  const provider = session.provider || taskRun.provider;
  const workerBranch = resolveWorkerBranch(session) || taskRun.workerBranch;
  const prUrl = resolvePrUrl(session) || taskRun.prUrl;
  const now = new Date().toISOString();
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
      errorMessage: resolveDispatchErrorMessage(currentDispatch?.errorMessage, nextRunState, session.state),
    });
    if (nextRunState !== "RUNNING" && taskRun.sprintRunId) {
      deps.executionRepository.finalizeSprintRunCancellationIfIdle(taskRun.sprintRunId);
    }
  }

  const nextPlanningStatus = mapTaskRunStateToPlanningStatus(nextRunState);
  // Never let a stale provider session rewrite the planning status of a task a
  // human now owns. QA_REVIEW_FAILED means QA could not verify the task and it
  // was escalated; the backing Jules session usually still reports COMPLETED,
  // so without this guard session-sync would keep demoting it to
  // coding_completed and re-enter the QA loop it was deliberately taken out of.
  const skipStatusUpdate = task.status === "QA_REVIEW_FAILED"
    || (task.status === "COMPLETED" && !sessionReactivated && (nextPlanningStatus as string) !== "completed");

  if (!skipStatusUpdate) {
    const updatePayload: Record<string, any> = {
      status: nextPlanningStatus,
    };
    if (task.is_merged) {
      updatePayload.is_merged = true;
    }
    deps.projectManagementRepository?.updateTask(task.record_id, updatePayload);
  }

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
      ...buildProviderActivityEventPayload(activity, sessionId, sessionName, provider),
    }, {
      createdAt: typeof activity.createTime === "string" && activity.createTime.trim().length > 0 ? activity.createTime : undefined,
      sourceEventKey: `activity:${activity.id}`,
    });
  }

  const isTerminal = nextRunState === "COMPLETED" || nextRunState === "FAILED";
  const transitionedToTerminal = !wasTerminal && isTerminal;

  // Live invocation sync: while a Jules session is still active, refresh its
  // conversation transcript and running usage estimate so the dashboard shows
  // messages and token counts in real time (matching the CLI providers). The
  // service throttles per session, so calling this every sync tick is cheap.
  if (!isTerminal && deps.julesUsage?.syncLiveInvocation && task.project_id && task.record_id && sessionId) {
    deps.julesUsage.syncLiveInvocation(
      task.project_id,
      task.record_id,
      sessionId,
      session.prompt,
      extractGitMetrics(session) as { insertions?: number; deletions?: number; filesChanged?: number } | null,
    ).catch((err) => {
      deps.logger.warn("Failed non-blocking live Jules invocation sync", { error: err });
    });
  }

  if (transitionedToTerminal && deps.getSession && deps.listAllActivities) {
    try {
      const gitMetrics = extractGitMetrics(session);
      if (gitMetrics && (gitMetrics.filesChanged !== undefined || gitMetrics.insertions !== undefined || gitMetrics.deletions !== undefined)) {
        deps.executionRepository.appendTaskRunEvent(taskRun.id, "git_metrics", "provider", {
          ...gitMetrics
        }, {
          sourceEventKey: `git-metrics:${sessionId || sessionName || taskRun.id}`
        });
      }

      const existingUsage = deps.executionRepository.getLatestProviderInvocationUsageBySession(sessionId || sessionName || taskRun.id, "task_coding");

      if (existingUsage && existingUsage.status !== (nextRunState === "COMPLETED" ? "completed" : "failed")) {
          deps.executionRepository.updateProviderInvocationUsage(existingUsage.id, {
            status: nextRunState === "COMPLETED" ? "completed" : "failed",
            finishedAt: nextFinishedAt || now,
            durationMs: nextDurationMs,
          });
      }

      const hasCalculatedUsage = existingUsage && existingUsage.totalTokens !== undefined && existingUsage.totalTokens !== null && existingUsage.totalTokens > 0;

      if (!hasCalculatedUsage && deps.julesUsage && task.project_id && task.record_id && (sessionId || sessionName || taskRun.id)) {
        deps.julesUsage.calculateAndSaveUsageForTask(
          task.project_id,
          task.record_id,
          sessionId || sessionName || taskRun.id,
          session.prompt,
          gitMetrics
        ).catch((err) => {
          deps.logger.warn("Failed non-blocking token tracking", { error: err });
        });
      }
    } catch (e) {
      deps.logger.warn("Failed to extract git metrics and token usage from full session", { error: e });
    }
  }
};

export const runSessionSyncStep = async (
  subtasks: Subtask[],
  deps: SessionSyncDependencies,
  retryFailed: boolean,
  context: {
    repoPath: string;
    sprintNumber: number;
    maxQuotaRetriesWithoutTimer?: number;
    retryOnRateLimit?: boolean;
    maxRateLimitRetries?: number;
    githubMode?: "REMOTE" | "LOCAL";
  },
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
      if (isForeignSessionMatch(deps, task, match)) {
        deps.logger.warn("Skipping foreign provider session matched by task run key", {
          taskId: task.record_id || task.id,
          projectId: task.project_id,
          sprintId: task.sprint_id,
          sessionId: deps.extractSessionId(match),
          sessionName: deps.resolveSessionName(match),
        });
        continue;
      }

      const sessionName = deps.resolveSessionName(match);
      if (sessionName) {
        // Skip fetching activities if the session is already terminal locally
        let isFullySynced = false;
        if (deps.executionRepository) {
          if (typeof deps.executionRepository.isSessionTerminal === "function") {
            if (deps.executionRepository.isSessionTerminal(sessionName)) {
              isFullySynced = true;
            }
          } else if (task.record_id && deps.sprintRunId) {
            const taskRun = deps.executionRepository.getLatestTaskRun(task.record_id, deps.sprintRunId);
            if (taskRun && (taskRun.state === "COMPLETED" || taskRun.state === "FAILED")) {
              isFullySynced = true;
            }
          }
        }

        const isRemoteTerminal = match.state === "COMPLETED" || match.state === "FAILED";
        if (isFullySynced && isRemoteTerminal) {
          continue;
        }

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

    if (isForeignSessionMatch(deps, task, match)) {
      deps.logger.warn("Skipping foreign provider session matched by task run key", {
        taskId: task.record_id || task.id,
        projectId: task.project_id,
        sprintId: task.sprint_id,
        sessionId: deps.extractSessionId(match),
        sessionName: deps.resolveSessionName(match),
      });
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

    await syncExecutionRunState(
      deps,
      task,
      match,
      sessionName ? activitiesMap.get(sessionName) : undefined,
    );

    // A human now owns this task (QA could not verify it). Leave its status
    // alone — a stale session still reporting COMPLETED must not pull it back
    // into the coding/QA pipeline it was escalated out of.
    if (task.status === "QA_REVIEW_FAILED") {
      continue;
    }

    // Keep a settled completed task as-is unless its provider session has
    // reactivated (RUNNING / awaiting action again) — e.g. a no-PR task that was
    // rerun or continued. A merged task is never reactivated. This lets a live
    // re-run surface as RUNNING instead of staying stuck on "completed", while
    // genuinely-done (merged) tasks are left untouched.
    const liveRunState = mapSessionStateToTaskRunState(match.state, deps.isActionRequiredState);
    const reactivated = !task.is_merged && (liveRunState === "RUNNING" || liveRunState === "BLOCKED");
    if (task.status === "COMPLETED" && !reactivated && isCompletedTaskSettled(task, { githubMode: context.githubMode })) {
      continue;
    }

    if (match.state === "COMPLETED") {
      task.status = "CODING_COMPLETED";
      continue;
    }

    if (match.state === "FAILED") {
      if (retryFailed) {
        applyPendingTaskRuntimeReset(task, {
          preserveProvider: true,
        });
      } else {
        task.status = "FAILED";
      }
      continue;
    }

    const taskDispatches = task.record_id && task.project_id && deps.executionRepository
      ? deps.executionRepository.listTaskDispatches({
          projectId: task.project_id,
          taskId: task.record_id,
        })
      : null;
    const dispatchesWithError = taskDispatches ? taskDispatches.filter((d) => d.errorMessage) : null;

    if (match.state === "RATE_LIMITED") {
      let retryDelayActive = false;
      let rateLimitRetriesWithoutDelay = 0;
      if (taskDispatches && dispatchesWithError) {
        const latestError = dispatchesWithError.length > 0 ? dispatchesWithError[dispatchesWithError.length - 1].errorMessage : null;
        retryDelayActive = isRetryAfterActive(latestError);

        if (!retryDelayActive) {
          for (let i = dispatchesWithError.length - 1; i >= 0; i--) {
            const err = dispatchesWithError[i].errorMessage;
            if (!err || extractProviderErrorCategory(err) !== "RATE_LIMITED") {
              break;
            }
            if (isRetryAfterActive(err)) {
              break;
            }
            rateLimitRetriesWithoutDelay++;
          }
        }
      }

      const maxRetries = context.maxRateLimitRetries ?? 5;
      if (!context.retryOnRateLimit) {
        task.status = "FAILED";
      } else if (retryDelayActive) {
        task.status = "QUOTA";
      } else if (retryFailed && rateLimitRetriesWithoutDelay <= maxRetries) {
        applyPendingTaskRuntimeReset(task, {
          preserveProvider: true,
        });
      } else {
        task.status = "FAILED";
      }
      continue;
    }

    if (match.state === "QUOTA") {
      // Check if the quota cooldown has expired by looking at the latest dispatch error
      let cooldownActive = false;
      let quotaRetriesWithoutTimer = 0;
      if (taskDispatches && dispatchesWithError) {
        const latestError = dispatchesWithError.length > 0 ? dispatchesWithError[dispatchesWithError.length - 1].errorMessage : null;
        cooldownActive = isQuotaCooldownActive(latestError);

        // Count consecutive quota dispatches without a reset timer
        if (!cooldownActive && latestError && extractProviderErrorCategory(latestError) !== "RATE_LIMITED") {
          for (let i = dispatchesWithError.length - 1; i >= 0; i--) {
            const err = dispatchesWithError[i].errorMessage;
            if (!err || !err.toLowerCase().includes("quota")) break;
            if (extractProviderErrorCategory(err) === "RATE_LIMITED") break;
            if (isQuotaCooldownActive(err)) break;
            quotaRetriesWithoutTimer++;
          }
        }
      }

      const maxRetries = context.maxQuotaRetriesWithoutTimer ?? 5;
      if (cooldownActive) {
        task.status = "QUOTA";
      } else if (retryFailed && quotaRetriesWithoutTimer < maxRetries) {
        applyPendingTaskRuntimeReset(task, {
          preserveProvider: true,
        });
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
