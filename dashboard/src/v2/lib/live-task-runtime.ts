import type {
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  ProviderId,
  Subtask,
} from "../../types.js";
import {
  getLiveTaskProgressPhase,
  type TaskProgressPhase,
} from "../../lib/task-progress.js";

interface TerminalTaskSignal {
  at: string;
  phase: TaskProgressPhase;
  mergeSettled?: boolean;
}

function compareIsoAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

function getDispatchRecency(dispatch: ExecutionTaskDispatchSummary): string {
  return (
    dispatch.finishedAt
    || dispatch.startedAt
    || dispatch.claimedAt
    || dispatch.queuedAt
    || ""
  );
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

/** Runtime event the backend emits while it sleeps in-process waiting for a provider quota reset. */
export const QUOTA_WAIT_EVENT_TYPE = "cli_provider_quota_wait";

export interface ActiveQuotaWait {
  retryAfterIso: string;
}

/**
 * Detects an in-progress provider quota/rate-limit wait from a task's runtime events.
 *
 * When `retryOnQuotaReset` is enabled the backend sleeps in-process until the quota resets
 * and deliberately keeps the dispatch in "running" — so neither the dispatch status nor the
 * subtask record reflect the wait. It does emit a `cli_provider_quota_wait` event carrying the
 * reset time. The provider only resumes at `retryAfterIso`, so while `now` is before that
 * instant the task is unambiguously still waiting; we key off the latest such event and ignore
 * interleaved heartbeats. Returns null once the reset time has passed (work has resumed).
 */
export function findActiveQuotaWait(
  events: ExecutionRuntimeEventSummary[] | undefined,
  now: number = Date.now(),
): ActiveQuotaWait | null {
  if (!events || events.length === 0) {
    return null;
  }
  let latest: { createdAt: string; retryAfterIso: string } | null = null;
  for (const event of events) {
    if (event.eventType !== QUOTA_WAIT_EVENT_TYPE) {
      continue;
    }
    const retryAfterIso = typeof event.payload?.retryAfterIso === "string" ? event.payload.retryAfterIso : null;
    if (!retryAfterIso) {
      continue;
    }
    if (!latest || compareIsoAsc(event.createdAt, latest.createdAt) > 0) {
      latest = { createdAt: event.createdAt, retryAfterIso };
    }
  }
  if (!latest) {
    return null;
  }
  return new Date(latest.retryAfterIso).getTime() > now
    ? { retryAfterIso: latest.retryAfterIso }
    : null;
}

function normalizeProvider(value: string | null | undefined): ProviderId | undefined {
  switch (normalizeString(value)) {
    case "jules":
    case "gemini":
    case "codex":
    case "claude-code":
    case "qwen-code":
    case "opencode":
    case "antigravity":
      return normalizeString(value) as ProviderId;
    default:
      return undefined;
  }
}

function taskScopeMatchesDispatch(task: Subtask, dispatch: ExecutionTaskDispatchSummary): boolean {
  if (task.project_id && dispatch.projectId !== task.project_id) {
    return false;
  }
  if (task.sprint_id && dispatch.sprintId !== task.sprint_id) {
    return false;
  }
  return true;
}

function taskScopeMatchesEvent(task: Subtask, event: ExecutionRuntimeEventSummary): boolean {
  if (task.project_id && event.projectId !== task.project_id) {
    return false;
  }
  if (task.sprint_id && event.sprintId !== task.sprint_id) {
    return false;
  }
  return true;
}

export interface IndexedExecutionHistory {
  dispatchesByRecordId: Map<string, ExecutionTaskDispatchSummary[]>;
  dispatchesByTaskKey: Map<string, ExecutionTaskDispatchSummary[]>;
  eventsByTaskRunId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByDispatchId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByRecordId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByTaskKey: Map<string, ExecutionRuntimeEventSummary[]>;
}

export function buildIndexedExecutionHistory(
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): IndexedExecutionHistory {
  const index: IndexedExecutionHistory = {
    dispatchesByRecordId: new Map(),
    dispatchesByTaskKey: new Map(),
    eventsByTaskRunId: new Map(),
    eventsByDispatchId: new Map(),
    eventsByRecordId: new Map(),
    eventsByTaskKey: new Map(),
  };

  for (const dispatch of dispatches) {
    if (dispatch.taskId) {
      const list = index.dispatchesByRecordId.get(dispatch.taskId) ?? [];
      list.push(dispatch);
      index.dispatchesByRecordId.set(dispatch.taskId, list);
    }
    if (dispatch.taskKey) {
      const list = index.dispatchesByTaskKey.get(dispatch.taskKey) ?? [];
      list.push(dispatch);
      index.dispatchesByTaskKey.set(dispatch.taskKey, list);
    }
  }

  for (const event of events) {
    if (event.taskRunId) {
      const list = index.eventsByTaskRunId.get(event.taskRunId) ?? [];
      list.push(event);
      index.eventsByTaskRunId.set(event.taskRunId, list);
    }
    if (event.dispatchId) {
      const list = index.eventsByDispatchId.get(event.dispatchId) ?? [];
      list.push(event);
      index.eventsByDispatchId.set(event.dispatchId, list);
    }
    if (event.taskId) {
      const list = index.eventsByRecordId.get(event.taskId) ?? [];
      list.push(event);
      index.eventsByRecordId.set(event.taskId, list);
    }
    if (event.taskKey) {
      const list = index.eventsByTaskKey.get(event.taskKey) ?? [];
      list.push(event);
      index.eventsByTaskKey.set(event.taskKey, list);
    }
  }

  return index;
}

export function pickLatestTaskDispatch(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
  index?: IndexedExecutionHistory,
): ExecutionTaskDispatchSummary | null {
  const recordId = normalizeString(task.record_id);
  const rawDispatches = recordId && index?.dispatchesByRecordId.has(recordId)
    ? index.dispatchesByRecordId.get(recordId)!
    : index?.dispatchesByTaskKey.has(task.id)
      ? index.dispatchesByTaskKey.get(task.id)!
      : dispatches;

  const scopedDispatches = rawDispatches.filter((dispatch) => taskScopeMatchesDispatch(task, dispatch));
  const latestByRecency = (items: ExecutionTaskDispatchSummary[]): ExecutionTaskDispatchSummary | null => (
    items.length === 0
      ? null
      : [...items].sort((left, right) => compareIsoAsc(getDispatchRecency(left), getDispatchRecency(right))).at(-1) ?? null
  );

  if (recordId) {
    const exactMatches = scopedDispatches.filter((dispatch) => dispatch.taskId === recordId);
    if (exactMatches.length > 0) {
      return latestByRecency(exactMatches);
    }
    return null;
  }

  return latestByRecency(scopedDispatches.filter((dispatch) => dispatch.taskKey === task.id));
}

export function getTaskEventsForLiveTask(
  task: Subtask,
  dispatch: ExecutionTaskDispatchSummary | null,
  events: ExecutionRuntimeEventSummary[],
  index?: IndexedExecutionHistory,
): ExecutionRuntimeEventSummary[] {
  const recordId = normalizeString(task.record_id);

  const rawEvents = dispatch?.taskRunId && index?.eventsByTaskRunId.has(dispatch.taskRunId)
    ? index.eventsByTaskRunId.get(dispatch.taskRunId)!
    : dispatch?.id && index?.eventsByDispatchId.has(dispatch.id)
      ? index.eventsByDispatchId.get(dispatch.id)!
      : recordId && index?.eventsByRecordId.has(recordId)
        ? index.eventsByRecordId.get(recordId)!
        : index?.eventsByTaskKey.has(task.id)
          ? index.eventsByTaskKey.get(task.id)!
          : events;

  const scopedEvents = rawEvents.filter((event) => taskScopeMatchesEvent(task, event));
  const sortEvents = (items: ExecutionRuntimeEventSummary[]): ExecutionRuntimeEventSummary[] => {
    const deduped = new Map<string, ExecutionRuntimeEventSummary>();
    for (const event of items) {
      deduped.set(event.id, event);
    }
    return [...deduped.values()].sort((left, right) => compareIsoAsc(left.createdAt, right.createdAt));
  };

  if (dispatch?.taskRunId) {
    const taskRunMatches = scopedEvents.filter((event) => event.taskRunId === dispatch.taskRunId);
    if (taskRunMatches.length > 0) {
      return sortEvents(taskRunMatches);
    }
  }

  if (dispatch?.id) {
    const dispatchMatches = scopedEvents.filter((event) => event.dispatchId === dispatch.id);
    if (dispatchMatches.length > 0) {
      return sortEvents(dispatchMatches);
    }
  }

  if (recordId) {
    return sortEvents(scopedEvents.filter((event) => event.taskId === recordId));
  }

  return sortEvents(scopedEvents.filter((event) => event.taskKey === task.id));
}

function resolveTerminalEventSignal(
  event: ExecutionRuntimeEventSummary,
): TerminalTaskSignal | null {
  const payload = event.payload || {};
  const ciGateState = String(payload.state || "").toLowerCase();

  switch (event.eventType) {
    case "ci_gate_status":
      if (ciGateState === "merge_confirmed" || ciGateState === "automerge_succeeded") {
        return {
          at: event.createdAt,
          phase: "COMPLETED",
          mergeSettled: true,
        };
      }
      return null;
    case "cli_git_no_changes":
    case "cli_workflow_completed":
    case "run_completed":
      return {
        at: event.createdAt,
        phase: "COMPLETED",
      };
    case "run_failed":
    case "dispatch_failed":
    case "cli_workflow_failed":
      return {
        at: event.createdAt,
        phase: "FAILED",
      };
    case "run_blocked":
    case "dispatch_cancelled":
    case "worker_cancelled":
    case "action_required_auto_failed":
      return {
        at: event.createdAt,
        phase: "BLOCKED",
      };
    case "cli_workflow_quota":
      return {
        at: event.createdAt,
        phase: "QUOTA",
      };
    default:
      return null;
  }
}

export function findLatestTerminalTaskSignal(
  events: ExecutionRuntimeEventSummary[],
): TerminalTaskSignal | null {
  let latestSignal: TerminalTaskSignal | null = null;
  for (const event of events) {
    const signal = resolveTerminalEventSignal(event);
    if (signal) {
      latestSignal = signal;
    }
  }
  return latestSignal;
}

export function projectLiveTask(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): Subtask {
  const dispatch = pickLatestTaskDispatch(task, dispatches);
  const taskEvents = getTaskEventsForLiveTask(task, dispatch, events);
  const terminalSignal = findLatestTerminalTaskSignal(taskEvents);

  return {
    ...task,
    status: getLiveTaskProgressPhase({
      task,
      dispatch,
      runtimeTerminalPhase: terminalSignal?.phase ?? null,
      runtimeMergeSettled: terminalSignal?.mergeSettled === true,
    }),
    session_id: normalizeString(dispatch?.sessionId) || normalizeString(task.session_id) || undefined,
    session_name: normalizeString(dispatch?.sessionName) || normalizeString(task.session_name) || undefined,
    session_state: normalizeString(dispatch?.taskRunState) || normalizeString(task.session_state) || undefined,
    provider: normalizeProvider(dispatch?.provider) || task.provider,
    worker_branch: normalizeString(dispatch?.workerBranch) || normalizeString(task.worker_branch) || undefined,
    pr_url: normalizeString(dispatch?.prUrl) || normalizeString(task.pr_url) || undefined,
  };
}
