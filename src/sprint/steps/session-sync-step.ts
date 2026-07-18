import type { JulesSession, Subtask } from "../../contracts/app-types.js";
import type { TaskRunRecord } from "../../contracts/execution-types.js";
import type { SessionSyncDependencies } from "../sprint-types.js";
import { buildTaskRunKey, extractTaskRunKeyFromTitle } from "../../services/task-run-key.js";
import type { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { applyPendingTaskRuntimeReset } from "../../domain/sprint/task-reset-state.js";
import { isCompletedTaskSettled } from "../../domain/sprint/task-merge-state.js";
import { failStaleProviderInvocation } from "../../domain/runtime/provider-invocation-recovery.js";
import { isNotFoundError } from "../../integrations/jules-api-client.js";
import {
  extractProviderErrorCategory,
  isQuotaCooldownActive,
  isRetryAfterActive,
} from "../../shared/providers/provider-error-classifier.js";
import {
  mapSessionStateToTaskRunState,
  mapTaskRunStateToDispatchStatus,
  mapTaskRunStateToPlanningStatus,
  mergeDispatchStatus,
  resolveDispatchErrorMessage,
} from "../../domain/sprint/session-sync/session-state-mapping.js";

const LOCAL_CLI_SESSION_PROVIDERS = new Set([
  "antigravity",
  "claude-code",
  "codex",
  "gemini",
  "mockup-cli",
  "opencode",
  "qwen-code",
]);

const TERMINAL_DISPATCH_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "blocked",
  "quota",
]);

const DISPATCH_HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_CLARIFICATION_EVENT_TYPES = [
  "worker_clarification_requested",
  "worker_clarification_continued",
  "worker_clarification_replied",
] as const;

type WorkerClarificationSyncStatus = "none" | "pending" | "answered" | "settled" | "cancelled_run";

interface WorkerClarificationSyncProjection {
  clarificationId: string | null;
  status: WorkerClarificationSyncStatus;
  providerReplyPending?: boolean;
  actionRequiredEpoch?: string | null;
}

const NO_WORKER_CLARIFICATION: WorkerClarificationSyncProjection = {
  clarificationId: null,
  status: "none",
};

const PROVIDER_ACTION_EVENT_TYPES = [
  "session_state_synced",
  "action_required_auto_approved",
  "action_required_auto_replied",
  "action_required_auto_resumed",
  "action_required_user_reply_pending",
  "action_required_auto_reply_unresolved",
] as const;

interface ProviderActionSyncProjection {
  epoch: string | null;
  replyPending: boolean;
  needsCheckpoint: boolean;
}

const resolveProviderActionProjection = (
  deps: SessionSyncDependencies,
  taskRun: TaskRunRecord,
  session: JulesSession,
): ProviderActionSyncProjection => {
  if (!deps.isActionRequiredState(session.state) || !deps.executionRepository) {
    return { epoch: null, replyPending: false, needsCheckpoint: false };
  }
  if (typeof deps.executionRepository.listTaskRunEvents !== "function") {
    return {
      epoch: `${session.state || "ACTION_REQUIRED"}:${session.updateTime || "unversioned"}`,
      replyPending: false,
      needsCheckpoint: false,
    };
  }
  const events = deps.executionRepository.listTaskRunEvents(taskRun.id, 500, {
    eventTypes: [...PROVIDER_ACTION_EVENT_TYPES],
    skipValidation: true,
  });
  const latestStateEvent = events.find((event) => event.eventType === "session_state_synced");
  const latestState = latestStateEvent?.payload || {};
  const sameActionEpisode = latestState.sessionState === session.state
    && typeof latestState.actionRequiredEpoch === "string"
    && latestState.actionRequiredEpoch.trim().length > 0;
  const epoch = sameActionEpisode
    ? String(latestState.actionRequiredEpoch)
    : `${session.state || "ACTION_REQUIRED"}:${session.updateTime || new Date().toISOString()}`;

  const matchingEvents = events.filter((event) => event.payload?.actionRequiredEpoch === epoch);
  const latestResolution = matchingEvents.find((event) => (
    event.eventType === "action_required_auto_approved"
    || event.eventType === "action_required_auto_replied"
    || event.eventType === "action_required_auto_resumed"
    || event.eventType === "action_required_user_reply_pending"
    || event.eventType === "action_required_auto_reply_unresolved"
  ));
  return {
    epoch,
    replyPending: latestResolution?.eventType === "action_required_auto_approved"
      || latestResolution?.eventType === "action_required_auto_replied"
      || latestResolution?.eventType === "action_required_auto_resumed"
      || latestResolution?.eventType === "action_required_user_reply_pending",
    needsCheckpoint: !sameActionEpisode,
  };
};

const resolveWorkerClarificationProjection = (
  deps: SessionSyncDependencies,
  taskRun: TaskRunRecord,
): WorkerClarificationSyncProjection => {
  if (
    !deps.executionRepository
    || typeof deps.executionRepository.listTaskRunEvents !== "function"
  ) {
    return NO_WORKER_CLARIFICATION;
  }

  const lifecycleEvents = deps.executionRepository.listTaskRunEvents(taskRun.id, 500, {
    eventTypes: [...WORKER_CLARIFICATION_EVENT_TYPES],
    skipValidation: true,
  });
  const byClarificationId = new Map<string, {
    latestEventType: string;
    requestedAt: string;
    requestPayload: Record<string, unknown> | null;
  }>();

  for (const event of lifecycleEvents) {
    const payload = event.payload || {};
    const clarificationId = typeof payload.clarificationId === "string"
      ? payload.clarificationId.trim()
      : "";
    if (!clarificationId) {
      continue;
    }
    const existing = byClarificationId.get(clarificationId);
    if (!existing) {
      byClarificationId.set(clarificationId, {
        latestEventType: event.eventType,
        requestedAt: "",
        requestPayload: null,
      });
    }
    if (event.eventType === "worker_clarification_requested") {
      const entry = byClarificationId.get(clarificationId)!;
      entry.requestedAt = event.createdAt;
      entry.requestPayload = payload;
    }
  }

  const scopedRequests = Array.from(byClarificationId.entries())
    .filter(([, entry]) => entry.requestPayload !== null)
    .filter(([, entry]) => {
      const payload = entry.requestPayload!;
      const eventTaskRunId = typeof payload.taskRunId === "string" ? payload.taskRunId : null;
      const eventDispatchId = typeof payload.dispatchId === "string" ? payload.dispatchId : null;
      const eventSessionId = typeof payload.sessionId === "string" ? normalizeSessionRef(payload.sessionId) : null;
      return (!eventTaskRunId || eventTaskRunId === taskRun.id)
        && (!eventDispatchId || !taskRun.dispatchId || eventDispatchId === taskRun.dispatchId)
        && (!eventSessionId || !taskRun.sessionId || eventSessionId === normalizeSessionRef(taskRun.sessionId));
    })
    .sort((left, right) => right[1].requestedAt.localeCompare(left[1].requestedAt));
  const latestRequest = scopedRequests.find(([, entry]) => (
    entry.latestEventType === "worker_clarification_requested"
  )) || scopedRequests[0];

  if (!latestRequest) {
    return NO_WORKER_CLARIFICATION;
  }

  const [clarificationId, entry] = latestRequest;
  if (entry.latestEventType === "worker_clarification_requested") {
    return { clarificationId, status: "pending" };
  }
  if (
    entry.latestEventType === "worker_clarification_continued"
    || entry.latestEventType === "worker_clarification_replied"
  ) {
    return { clarificationId, status: "answered" };
  }
  return { clarificationId, status: "settled" };
};

const shouldRefreshDispatchHeartbeat = (lastHeartbeatAt: string | null, now: string): boolean => {
  if (!lastHeartbeatAt) {
    return true;
  }
  const lastHeartbeatMs = new Date(lastHeartbeatAt).getTime();
  const nowMs = new Date(now).getTime();
  return !Number.isFinite(lastHeartbeatMs) || !Number.isFinite(nowMs)
    || nowMs - lastHeartbeatMs >= DISPATCH_HEARTBEAT_INTERVAL_MS;
};

const taskAlreadyHasPlanningStatus = (
  taskStatus: Subtask["status"],
  planningStatus: ReturnType<typeof mapTaskRunStateToPlanningStatus>,
): boolean => (
  (taskStatus === "RUNNING" && planningStatus === "in_progress")
  || (taskStatus === "CODING_COMPLETED" && planningStatus === "coding_completed")
  || (taskStatus !== "RUNNING" && taskStatus !== "CODING_COMPLETED" && planningStatus === "pending")
);

const isLocalCliSessionProvider = (provider: string | null | undefined): boolean => (
  LOCAL_CLI_SESSION_PROVIDERS.has(String(provider || ""))
);

const isFinishedLocalCliTaskRun = (
  taskRun: TaskRunRecord,
  provider: string | null | undefined,
): boolean => (
  isLocalCliSessionProvider(provider)
  && taskRun.finishedAt !== null
);

const isTerminalSessionState = (state: string | null | undefined): boolean => {
  const normalized = String(state || "").toUpperCase();
  return normalized === "COMPLETED" || normalized === "FAILED" || normalized === "CANCELLED";
};

const shouldSkipTerminalLocalCliSessionPolling = (subtasks: Subtask[]): boolean => {
  let sawTerminalLocalCliSession = false;

  for (const task of subtasks) {
    const sessionId = resolveTaskSessionId(task);
    if (!sessionId) {
      continue;
    }

    if (!isLocalCliSessionProvider(task.provider)) {
      return false;
    }
    if (!isTerminalSessionState(task.session_state)) {
      return false;
    }
    if (task.status === "RUNNING" || task.status === "BLOCKED" || task.status === "QUOTA") {
      return false;
    }
    if (
      task.status === "CODING_COMPLETED"
      && !task.is_merged
      && !task.worker_branch
      && !task.pr_url
    ) {
      return false;
    }

    sawTerminalLocalCliSession = true;
  }

  return sawTerminalLocalCliSession;
};

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

const normalizeSessionRef = (sessionRef: string | null | undefined): string | null => {
  if (typeof sessionRef !== "string") {
    return null;
  }
  const normalized = sessionRef.trim().replace(/^sessions\//, "");
  return normalized.length > 0 ? normalized : null;
};

interface SessionSyncSessionMetadata {
  sessionId: string | null;
  sessionName: string | null;
  latestTaskRunBySessionId: TaskRunRecord | null;
  provider: string | null;
  isLocallyTerminal: boolean;
}

interface SessionMetadataLookup {
  getForSession: (session: JulesSession) => SessionSyncSessionMetadata;
  getForSessionRef: (sessionRef: string) => SessionSyncSessionMetadata;
}

const createSessionMetadataLookup = (deps: SessionSyncDependencies): SessionMetadataLookup => {
  const cache = new Map<string, SessionSyncSessionMetadata>();
  const sessionObjectCache = new WeakMap<JulesSession, SessionSyncSessionMetadata>();

  const readLocalTerminalState = (sessionName: string | null): boolean => {
    return Boolean(
      sessionName
      && deps.executionRepository
      && typeof deps.executionRepository.isSessionTerminal === "function"
      && deps.executionRepository.isSessionTerminal(sessionName),
    );
  };

  const cacheAliases = (metadata: SessionSyncSessionMetadata): SessionSyncSessionMetadata => {
    for (const alias of [metadata.sessionId, metadata.sessionName]) {
      const key = normalizeSessionRef(alias);
      if (key) {
        cache.set(key, metadata);
      }
    }
    return metadata;
  };

  const resolveMetadata = (
    sessionRef: string | null,
    session?: JulesSession,
  ): SessionSyncSessionMetadata => {
    if (session) {
      const cachedByObject = sessionObjectCache.get(session);
      if (cachedByObject) {
        return cachedByObject;
      }
    }

    const sessionName = session ? deps.resolveSessionName(session) || null : null;
    const sessionId = normalizeSessionRef(
      (session ? deps.extractSessionId(session) : null)
      || sessionRef
      || sessionName,
    );
    const key = sessionId || normalizeSessionRef(sessionName) || normalizeSessionRef(sessionRef);

    if (key) {
      const cached = cache.get(key);
      if (cached) {
        const sessionProvider = typeof session?.provider === "string" && session.provider.trim().length > 0
          ? session.provider
          : null;
        if (
          (sessionName && cached.sessionName !== sessionName)
          || (sessionProvider && cached.provider !== sessionProvider)
        ) {
          const updatedMetadata = cacheAliases({
            ...cached,
            sessionName: cached.sessionName || sessionName,
            provider: sessionProvider || cached.provider,
            isLocallyTerminal: cached.isLocallyTerminal || readLocalTerminalState(cached.sessionName || sessionName),
          });
          if (session) {
            sessionObjectCache.set(session, updatedMetadata);
          }
          return updatedMetadata;
        }
        if (session) {
          sessionObjectCache.set(session, cached);
        }
        return cached;
      }
    }

    const latestTaskRunBySessionId = sessionId
      && deps.executionRepository
      && typeof deps.executionRepository.getLatestTaskRunBySessionId === "function"
        ? deps.executionRepository.getLatestTaskRunBySessionId(sessionId)
        : null;
    const provider = typeof session?.provider === "string" && session.provider.trim().length > 0
      ? session.provider
      : latestTaskRunBySessionId?.provider || latestTaskRunBySessionId?.mode || null;
    const resolvedSessionName = sessionName
      || latestTaskRunBySessionId?.sessionName
      || (sessionRef && sessionRef.startsWith("sessions/") ? sessionRef : null);
    const isLocallyTerminal = readLocalTerminalState(resolvedSessionName);

    const metadata = cacheAliases({
      sessionId,
      sessionName: resolvedSessionName,
      latestTaskRunBySessionId,
      provider,
      isLocallyTerminal,
    });
    if (session) {
      sessionObjectCache.set(session, metadata);
    }
    return metadata;
  };

  return {
    getForSession: (session) => resolveMetadata(null, session),
    getForSessionRef: (sessionRef) => resolveMetadata(sessionRef),
  };
};

const isForeignSessionMatch = (
  sessionMetadataLookup: SessionMetadataLookup,
  task: Subtask,
  session: JulesSession,
): boolean => {
  if (
    !task.record_id
    || !task.project_id
    || !task.sprint_id
  ) {
    return false;
  }

  const existingRun = sessionMetadataLookup.getForSession(session).latestTaskRunBySessionId;
  if (!existingRun) {
    return false;
  }

  return existingRun.projectId !== task.project_id
    || existingRun.sprintId !== task.sprint_id
    || existingRun.taskId !== task.record_id;
};

const isRetiredSessionForPendingRetry = (
  sessionMetadataLookup: SessionMetadataLookup,
  task: Subtask,
  session: JulesSession,
): boolean => {
  if (
    String(task.status || "").toUpperCase() !== "PENDING"
    || !task.record_id
    || !task.project_id
    || !task.sprint_id
  ) {
    return false;
  }

  const existingRun = sessionMetadataLookup.getForSession(session).latestTaskRunBySessionId;
  return existingRun?.state === "FAILED"
    && existingRun.projectId === task.project_id
    && existingRun.sprintId === task.sprint_id
    && existingRun.taskId === task.record_id;
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

const resolveTaskSessionId = (task: Subtask): string | null => {
  if (typeof task.session_id === "string" && task.session_id.trim().length > 0) {
    return normalizeSessionRef(task.session_id);
  }
  if (typeof task.session_name === "string" && task.session_name.trim().length > 0) {
    return normalizeSessionRef(task.session_name);
  }
  return null;
};

const isJulesRecordedSession = (
  deps: SessionSyncDependencies,
  sessionMetadataLookup: SessionMetadataLookup,
  task: Subtask,
  sessionId: string,
): boolean => {
  const taskProvider = typeof task.provider === "string" ? task.provider.toLowerCase() : "";
  if (taskProvider) {
    return taskProvider === "jules";
  }
  if (!deps.executionRepository || !task.record_id) {
    return false;
  }

  const taskRun = sessionMetadataLookup.getForSessionRef(sessionId).latestTaskRunBySessionId
    || (deps.sprintRunId
      ? deps.executionRepository.getLatestTaskRun(task.record_id, deps.sprintRunId)
      : deps.executionRepository.getLatestTaskRun(task.record_id));
  return taskRun?.provider === "jules" || taskRun?.mode === "jules";
};

const calculateDurationMs = (startedAt: string | null | undefined, finishedAt: string): number | null => {
  const startedAtMs = Date.parse(startedAt || "");
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return null;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
};

const recoverMissingRecordedSession = (
  deps: SessionSyncDependencies,
  task: Subtask,
  sessionId: string,
  retryFailed: boolean,
): void => {
  if (!deps.executionRepository || !task.record_id) {
    return;
  }

  const now = new Date().toISOString();
  const message = `Recovered stale Jules task runtime after recorded session ${sessionId} was no longer available from the provider API.`;
  const taskRun = deps.sprintRunId
    ? deps.executionRepository.getLatestTaskRun(task.record_id, deps.sprintRunId)
    : deps.executionRepository.getLatestTaskRun(task.record_id);

  const providerInvocation = deps.executionRepository.getLatestProviderInvocationUsageBySession(sessionId, "task_coding");
  if (providerInvocation?.status === "running") {
    if (providerInvocation.provider === "jules") {
      failStaleProviderInvocation(
        deps.executionRepository,
        providerInvocation,
        deps.executionRepository.listExecutionInvocationsByProviderInvocationId(providerInvocation.id),
        {
          reconciledAt: now,
          recoveryReason: "session_sync_missing_recorded_session",
          systemMessage: message,
        },
      );
    }
  }

  if (taskRun && taskRun.state !== "COMPLETED" && taskRun.state !== "FAILED") {
    deps.executionRepository.updateTaskRun(taskRun.id, {
      state: "FAILED",
      finishedAt: now,
      durationMs: calculateDurationMs(taskRun.startedAt, now),
    });
    deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_run_recovered_missing_session", "system", {
      sessionId,
      retryFailed,
      message,
    }, {
      sourceEventKey: `session-sync:missing-session:${taskRun.id}:${sessionId}`,
    });

    if (taskRun.dispatchId) {
      const dispatch = deps.executionRepository.getTaskDispatch(taskRun.dispatchId);
      deps.executionRepository.updateTaskDispatch(taskRun.dispatchId, {
        status: "failed",
        startedAt: dispatch?.startedAt || taskRun.startedAt || now,
        finishedAt: now,
        lastHeartbeatAt: now,
        errorMessage: message,
      });
    }
  }

  task.intervention_hint = message;
  if (retryFailed) {
    applyPendingTaskRuntimeReset(task, {
      preserveProvider: true,
    });
    deps.projectManagementRepository?.updateTask(task.record_id, {
      status: "pending",
      isMerged: false,
      mergeIndicator: null,
    });
  }
};

const syncExecutionRunState = async (
  deps: SessionSyncDependencies,
  sessionMetadataLookup: SessionMetadataLookup,
  task: Subtask,
  session: JulesSession,
): Promise<WorkerClarificationSyncProjection> => {
  if (!deps.executionRepository || !deps.sprintRunId || !task.record_id) {
    return NO_WORKER_CLARIFICATION;
  }

  let taskRun = deps.executionRepository.getLatestTaskRun(task.record_id, deps.sprintRunId);
  if (!taskRun) {
    const sessionMetadata = sessionMetadataLookup.getForSession(session);
    const sessionId = sessionMetadata.sessionId;
    const persistedTaskRun = sessionId
      ? sessionMetadata.latestTaskRunBySessionId
      : deps.executionRepository.getLatestTaskRun(task.record_id);

    if (
      persistedTaskRun
      && persistedTaskRun.projectId === task.project_id
      && persistedTaskRun.sprintId === task.sprint_id
      && persistedTaskRun.taskId === task.record_id
    ) {
      taskRun = deps.executionRepository.reassignTaskRunSprintRun(persistedTaskRun.id, deps.sprintRunId);
      if (taskRun.dispatchId) {
        deps.executionRepository.reassignTaskDispatchSprintRun(taskRun.dispatchId, deps.sprintRunId);
      }
      const usage = sessionId
        ? deps.executionRepository.getLatestProviderInvocationUsageBySession(sessionId, "task_coding")
        : null;
      if (usage && usage.provider === persistedTaskRun.provider) {
        deps.executionRepository.associateProviderInvocationRuntime(usage.id, {
          sprintRunId: deps.sprintRunId,
          dispatchId: taskRun.dispatchId,
          taskRunId: taskRun.id,
        });
      }
      deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_run_rehydrated", "system", {
        reason: "session_sync_resumed_sprint_run",
        previousSprintRunId: persistedTaskRun.sprintRunId,
        sprintRunId: deps.sprintRunId,
        sessionId,
      }, {
        sourceEventKey: `session-sync:rehydrate:${taskRun.id}:${deps.sprintRunId}`,
      });
    } else {
      return NO_WORKER_CLARIFICATION;
    }
  }

  const currentDispatch = taskRun.dispatchId
    ? deps.executionRepository.getTaskDispatch(taskRun.dispatchId)
    : null;
  const clarificationProjection = resolveWorkerClarificationProjection(deps, taskRun);
  if (
    clarificationProjection.status === "pending"
    && (
      taskRun.state === "PAUSED"
      || currentDispatch?.status === "paused"
      || currentDispatch?.status === "cancel_requested"
      || currentDispatch?.status === "cancelled"
    )
  ) {
    return { ...clarificationProjection, status: "cancelled_run" };
  }
  const wasDispatchTerminal = !currentDispatch
    || currentDispatch.finishedAt !== null
    || TERMINAL_DISPATCH_STATUSES.has(currentDispatch.status);
  const providerActionProjection = resolveProviderActionProjection(deps, taskRun, session);
  task.action_required_epoch = providerActionProjection.epoch || undefined;
  const actionRequiredReplyPending = providerActionProjection.replyPending
    || clarificationProjection.status === "answered";
  const combinedProjection: WorkerClarificationSyncProjection = {
    ...clarificationProjection,
    providerReplyPending: providerActionProjection.replyPending,
    actionRequiredEpoch: providerActionProjection.epoch,
  };
  const nextRunState = clarificationProjection.status === "pending"
    ? "BLOCKED"
    : mapSessionStateToTaskRunState(session.state, deps.isActionRequiredState, actionRequiredReplyPending);
  const sessionProvider = session.provider || taskRun.provider;
  const isFinishedLocalCliRun = isFinishedLocalCliTaskRun(taskRun, sessionProvider);
  const wasTerminal = taskRun.state === "COMPLETED"
    || taskRun.state === "FAILED"
    || isFinishedLocalCliRun;
  // A provider session can come back to life after it had finished — e.g. a
  // Jules session continued with QA follow-up work, or a task that was rerun.
  // When that happens the local run is terminal but the remote session is
  // active again (RUNNING / awaiting action), so we must NOT short-circuit;
  // otherwise the task is left showing its old completed status while a fresh
  // session is actively working (the stale-status-on-rerun bug). A genuinely
  // merged task is excluded — it is done for good and its session activity, if
  // any, is stale.
  const sessionReactivated = !isLocalCliSessionProvider(sessionProvider)
    && !task.is_merged
    && (nextRunState === "RUNNING" || nextRunState === "BLOCKED");

  if (wasTerminal && wasDispatchTerminal && !sessionReactivated) {
    if (currentDispatch && taskRun.dispatchId) {
      const preserveCancelledDispatch = isFinishedLocalCliRun && currentDispatch.status === "cancelled";
      const expectedStatus = preserveCancelledDispatch
        ? "cancelled"
        : mapTaskRunStateToDispatchStatus(taskRun.state, session.state);
      const expectedErrorMessage = preserveCancelledDispatch
        ? currentDispatch.errorMessage
        : resolveDispatchErrorMessage(currentDispatch.errorMessage, taskRun.state, session.state);
      if (
        currentDispatch.status !== expectedStatus
        || currentDispatch.errorMessage !== expectedErrorMessage
        || currentDispatch.startedAt === null
        || currentDispatch.finishedAt === null
      ) {
        deps.executionRepository.updateTaskDispatch(taskRun.dispatchId, {
          status: expectedStatus,
          startedAt: currentDispatch.startedAt || taskRun.startedAt || new Date().toISOString(),
          finishedAt: currentDispatch.finishedAt || taskRun.finishedAt || new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          errorMessage: expectedErrorMessage,
        });
      }
    }
    return combinedProjection;
  }

  const sessionMetadata = sessionMetadataLookup.getForSession(session);
  const sessionName = sessionMetadata.sessionName || taskRun.sessionName;
  const sessionId = sessionMetadata.sessionId || taskRun.sessionId;
  const provider = sessionProvider;
  const workerBranch = resolveWorkerBranch(session) || taskRun.workerBranch;
  const prUrl = resolvePrUrl(session) || taskRun.prUrl;
  const now = new Date().toISOString();
  const nextFinishedAt = nextRunState === "RUNNING"
    ? null
    : (taskRun.finishedAt || currentDispatch?.finishedAt || now);
  const nextDurationMs = nextRunState === "RUNNING" || !taskRun.startedAt
    ? null
    : Math.max(0, new Date(nextFinishedAt || now).getTime() - new Date(taskRun.startedAt).getTime());
  const nextStartedAt = taskRun.startedAt || now;

  const taskRunChanged = taskRun.sessionId !== sessionId
    || taskRun.sessionName !== sessionName
    || taskRun.provider !== provider
    || taskRun.workerBranch !== workerBranch
    || taskRun.prUrl !== prUrl
    || taskRun.state !== nextRunState
    || taskRun.startedAt !== nextStartedAt
    || taskRun.finishedAt !== nextFinishedAt
    || taskRun.durationMs !== nextDurationMs;
  if (taskRunChanged) {
    deps.executionRepository.updateTaskRun(taskRun.id, {
      sessionId,
      sessionName,
      provider,
      workerBranch,
      prUrl,
      state: nextRunState,
      startedAt: nextStartedAt,
      finishedAt: nextFinishedAt,
      durationMs: nextDurationMs,
    });
  }

  if (taskRun.dispatchId) {
    const projectedSessionState = clarificationProjection.status === "pending"
      ? "WORKER_CLARIFICATION"
      : session.state;
    const nextDispatchStatus = mergeDispatchStatus(currentDispatch?.status || null, nextRunState, projectedSessionState);
    const nextDispatchFinishedAt = nextRunState === "RUNNING" ? null : (currentDispatch?.finishedAt || nextFinishedAt);
    const nextDispatchErrorMessage = resolveDispatchErrorMessage(currentDispatch?.errorMessage, nextRunState, projectedSessionState);
    const dispatchChanged = !currentDispatch
      || currentDispatch.status !== nextDispatchStatus
      || currentDispatch.startedAt !== nextStartedAt
      || currentDispatch.finishedAt !== nextDispatchFinishedAt
      || currentDispatch.errorMessage !== nextDispatchErrorMessage;
    const refreshHeartbeat = dispatchChanged || shouldRefreshDispatchHeartbeat(currentDispatch?.lastHeartbeatAt || null, now);
    if (dispatchChanged || refreshHeartbeat) {
      deps.executionRepository.updateTaskDispatch(taskRun.dispatchId, {
        status: nextDispatchStatus,
        startedAt: nextStartedAt,
        finishedAt: nextDispatchFinishedAt,
        lastHeartbeatAt: refreshHeartbeat ? now : currentDispatch?.lastHeartbeatAt || now,
        errorMessage: nextDispatchErrorMessage,
      });
    }
    if (nextRunState !== "RUNNING" && taskRun.sprintRunId) {
      deps.sprintRunLifecycleService?.finalizeCancellationIfIdle(taskRun.sprintRunId);
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

  if (!skipStatusUpdate && (!taskAlreadyHasPlanningStatus(task.status, nextPlanningStatus) || task.is_merged)) {
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
    clarificationProjection.clarificationId || "",
    clarificationProjection.status,
    providerActionProjection.epoch || "",
  ].join(":");
  if (taskRunChanged || providerActionProjection.needsCheckpoint) {
    deps.executionRepository.appendTaskRunEvent(taskRun.id, "session_state_synced", "provider", {
      sessionState: session.state || null,
      taskRunState: nextRunState,
      actionRequiredReplyPending,
      actionRequiredEpoch: providerActionProjection.epoch,
      workerClarificationId: clarificationProjection.clarificationId,
      workerClarificationStatus: clarificationProjection.status,
      provider,
      sessionId,
      sessionName,
      workerBranch,
      prUrl,
    }, {
      sourceEventKey: sessionSyncKey,
    });
  }

  const isTerminal = nextRunState === "COMPLETED" || nextRunState === "FAILED";
  const transitionedToTerminal = !wasTerminal && isTerminal;

  if (transitionedToTerminal) {
    try {
      const gitMetrics = extractGitMetrics(session);
      if (gitMetrics && (gitMetrics.filesChanged !== undefined || gitMetrics.insertions !== undefined || gitMetrics.deletions !== undefined)) {
        deps.executionRepository.appendTaskRunEvent(taskRun.id, "git_metrics", "provider", {
          ...gitMetrics
        }, {
          sourceEventKey: `git-metrics:${sessionId || sessionName || taskRun.id}`
        });
      }

      const latestUsage = deps.executionRepository.getLatestProviderInvocationUsageBySession(sessionId || sessionName || taskRun.id, "task_coding");
      const existingUsage = latestUsage && latestUsage.provider === provider ? latestUsage : null;

      if (existingUsage && existingUsage.status !== (nextRunState === "COMPLETED" ? "completed" : "failed")) {
          deps.executionRepository.updateProviderInvocationUsage(existingUsage.id, {
            status: nextRunState === "COMPLETED" ? "completed" : "failed",
            finishedAt: nextFinishedAt || now,
            durationMs: nextDurationMs,
          });
      }

      if (provider === "jules" && deps.julesUsage && task.project_id && task.record_id && (sessionId || sessionName || taskRun.id)) {
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
  return combinedProjection;
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
  if (shouldSkipTerminalLocalCliSessionPolling(subtasks)) {
    return { subtasks, sessions: [] };
  }

  const sessionsResponse = await deps.listSessions();
  const sessions = sessionsResponse.sessions || [];
  const sessionMetadataLookup = createSessionMetadataLookup(deps);

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

  if (deps.getSession) {
    for (const task of subtasks) {
      const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
      const sessionId = resolveTaskSessionId(task);
      if (!sessionId) {
        continue;
      }
      const snapshotMatch = sessionMap.get(expectedRunKey);
      const snapshotSessionId = snapshotMatch ? sessionMetadataLookup.getForSession(snapshotMatch).sessionId : null;
      // The shared snapshot is already TTL-cached and coalesced across every
      // sprint. Do not issue one exact-session request per active task per
      // cycle; exact reads are only a fallback for durable sessions outside
      // the newest-first account snapshot.
      if (snapshotSessionId === sessionId) {
        continue;
      }
      if (!isJulesRecordedSession(deps, sessionMetadataLookup, task, sessionId)) {
        continue;
      }
      try {
        const session = await deps.getSession(sessionId);
        const runKey = extractTaskRunKeyFromTitle(session.title);
        if (!runKey || runKey === expectedRunKey) {
          sessionMap.set(expectedRunKey, session);
          sessions.push(session);
        }
      } catch (error) {
        deps.logger.warn("Could not fetch recorded task session missing from session snapshot", {
          taskId: task.record_id || task.id,
          sessionId,
          notFound: isNotFoundError(error),
        });
        if (isNotFoundError(error)) {
          recoverMissingRecordedSession(deps, task, sessionId, retryFailed);
        }
      }
    }
  }

  for (const task of subtasks) {
    const expectedRunKey = buildTaskRunKey(context.repoPath, context.sprintNumber, task.id);
    const match = sessionMap.get(expectedRunKey);
    if (!match) {
      continue;
    }

    if (isForeignSessionMatch(sessionMetadataLookup, task, match)) {
      const sessionMetadata = sessionMetadataLookup.getForSession(match);
      deps.logger.warn("Skipping foreign provider session matched by task run key", {
        taskId: task.record_id || task.id,
        projectId: task.project_id,
        sprintId: task.sprint_id,
        sessionId: sessionMetadata.sessionId,
        sessionName: sessionMetadata.sessionName,
      });
      continue;
    }
    if (isRetiredSessionForPendingRetry(sessionMetadataLookup, task, match)) {
      const sessionMetadata = sessionMetadataLookup.getForSession(match);
      deps.logger.warn("Skipping retired provider session for pending retry task", {
        taskId: task.record_id || task.id,
        projectId: task.project_id,
        sprintId: task.sprint_id,
        sessionId: sessionMetadata.sessionId,
        sessionName: sessionMetadata.sessionName,
      });
      continue;
    }

    const sessionMetadata = sessionMetadataLookup.getForSession(match);
    const sessionName = sessionMetadata.sessionName || undefined;
    const sessionId = sessionMetadata.sessionId || undefined;
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

    const clarificationProjection = await syncExecutionRunState(
      deps,
      sessionMetadataLookup,
      task,
      match,
    );

    if (clarificationProjection.status === "cancelled_run") {
      continue;
    }

    // A human now owns this task (QA could not verify it). Leave its status
    // alone — a stale session still reporting COMPLETED must not pull it back
    // into the coding/QA pipeline it was escalated out of.
    if (task.status === "QA_REVIEW_FAILED") {
      continue;
    }

    if (clarificationProjection.status === "pending") {
      task.status = "BLOCKED";
      continue;
    }

    // Keep a settled completed task as-is unless its provider session has
    // reactivated (RUNNING / awaiting action again) — e.g. a no-PR task that was
    // rerun or continued. A merged task is never reactivated. This lets a live
    // re-run surface as RUNNING instead of staying stuck on "completed", while
    // genuinely-done (merged) tasks are left untouched.
    const actionRequiredReplyPending = clarificationProjection.providerReplyPending === true
      || clarificationProjection.status === "answered";
    const liveRunState = mapSessionStateToTaskRunState(match.state, deps.isActionRequiredState, actionRequiredReplyPending);
    const reactivated = !task.is_merged && (liveRunState === "RUNNING" || liveRunState === "BLOCKED");
    if (task.status === "COMPLETED" && !reactivated && isCompletedTaskSettled(task, { githubMode: context.githubMode })) {
      continue;
    }

    if (match.state === "COMPLETED") {
      task.status = "CODING_COMPLETED";
      continue;
    }

    if (match.state === "FAILED" || match.state === "CANCELLED") {
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
      } else if (quotaRetriesWithoutTimer < maxRetries) {
        applyPendingTaskRuntimeReset(task, {
          preserveProvider: true,
        });
      } else {
        task.status = "FAILED";
      }
      continue;
    }

    if (deps.isActionRequiredState(match.state)) {
      task.status = actionRequiredReplyPending ? "RUNNING" : "BLOCKED";
      continue;
    }

    task.status = "RUNNING";
  }

  return { subtasks, sessions };
};
