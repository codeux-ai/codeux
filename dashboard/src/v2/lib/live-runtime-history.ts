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

// From live-stats.ts
export const LIVE_TASK_STAGE_ORDER = ["queued", "coding", "ci", "autofix", "merge"] as const;
export type LiveTaskStageKey = (typeof LIVE_TASK_STAGE_ORDER)[number];

export interface StageSignal {
  stage: LiveTaskStageKey;
  terminal?: boolean;
}

export interface TerminalTaskSignal {
  at: string;
  phase: TaskProgressPhase;
  mergeSettled?: boolean;
}

export interface ProjectedTaskRuntime {
  dispatch: ExecutionTaskDispatchSummary | null;
  events: ExecutionRuntimeEventSummary[];
  terminalSignal: TerminalTaskSignal | null;
  latestStageSignal: StageSignal | null;
  codingCompletedAt: string | null;
  latestPostCodingStageSignal: { at: string; signal: StageSignal } | null;
  dispatchTerminalAt: string | null;
}

// Internal index map structures
export interface IndexedExecutionHistory {
  dispatchesByRecordId: Map<string, ExecutionTaskDispatchSummary[]>;
  dispatchesByTaskKey: Map<string, ExecutionTaskDispatchSummary[]>;
  eventsByTaskRunId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByDispatchId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByRecordId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByTaskKey: Map<string, ExecutionRuntimeEventSummary[]>;
}

// Utility functions
export function compareIsoAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

export function maxIso(...values: Array<string | null | undefined>): string | null {
  const normalized = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort(compareIsoAsc);
  return normalized.length > 0 ? normalized[normalized.length - 1] : null;
}

export function getDispatchRecency(dispatch: ExecutionTaskDispatchSummary): string {
  return (
    dispatch.finishedAt
    || dispatch.startedAt
    || dispatch.claimedAt
    || dispatch.queuedAt
    || ""
  );
}

export function normalizeString(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export function normalizeProvider(value: string | null | undefined): ProviderId | undefined {
  switch (normalizeString(value)) {
    case "jules":
    case "gemini":
    case "codex":
    case "claude-code":
      return normalizeString(value) as ProviderId;
    default:
      return undefined;
  }
}

export function taskScopeMatchesDispatch(task: Subtask, dispatch: ExecutionTaskDispatchSummary): boolean {
  if (task.project_id && dispatch.projectId !== task.project_id) {
    return false;
  }
  if (task.sprint_id && dispatch.sprintId !== task.sprint_id) {
    return false;
  }
  return true;
}

export function taskScopeMatchesEvent(task: Subtask, event: ExecutionRuntimeEventSummary): boolean {
  if (task.project_id && event.projectId !== task.project_id) {
    return false;
  }
  if (task.sprint_id && event.sprintId !== task.sprint_id) {
    return false;
  }
  return true;
}

export function taskHasMergeEvidence(task: Pick<Subtask, "worker_branch" | "pr_url">): boolean {
  const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch.trim() : "";
  const prUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

export function dispatchHasMergeEvidence(
  dispatch: Pick<ExecutionTaskDispatchSummary, "workerBranch" | "prUrl"> | null | undefined,
): boolean {
  const workerBranch = typeof dispatch?.workerBranch === "string" ? dispatch.workerBranch.trim() : "";
  const prUrl = typeof dispatch?.prUrl === "string" ? dispatch.prUrl.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

export function resolveCiGateStage(event: ExecutionRuntimeEventSummary): StageSignal {
  const payload = event.payload || {};
  const state = String(payload.state || "").toLowerCase();
  const hasFailedChecks = payload.hasFailedChecks === true;
  const hasPendingChecks = payload.hasPendingChecks === true;
  const hasReviewBlockers = payload.hasReviewBlockers === true;

  if (state === "merge_confirmed") {
    return { stage: "merge", terminal: true };
  }
  if (state === "automerge_succeeded") {
    return { stage: "merge", terminal: true };
  }
  if (hasFailedChecks) {
    return { stage: "autofix" };
  }
  if (
    state === "waiting_for_pr"
    || state === "waiting_checks"
    || state === "blocked"
    || hasPendingChecks
    || hasReviewBlockers
  ) {
    return { stage: "ci" };
  }
  if (
    state === "ready_for_merge"
    || state === "automerge_scheduled"
    || state === "automerge_failed"
    || state === "automerge_conflict"
  ) {
    return { stage: "merge" };
  }
  return { stage: "merge" };
}

export function resolveEventStage(
  task: Pick<Subtask, "worker_branch" | "pr_url">,
  event: ExecutionRuntimeEventSummary,
  dispatch?: ExecutionTaskDispatchSummary | null,
): StageSignal | null {
  const hasMergeEvidence = taskHasMergeEvidence(task) || dispatchHasMergeEvidence(dispatch);

  switch (event.eventType) {
    case "dispatch_queued":
      return { stage: "queued" };
    case "dispatch_started":
    case "worker_claimed":
    case "session_created":
    case "run_running":
    case "provider_activity":
    case "session_state_synced":
    case "cli_prepare_started":
    case "cli_prepare_completed":
    case "cli_provider_started":
    case "action_required_auto_approved":
    case "action_required_auto_replied":
    case "action_required_auto_resumed":
      return { stage: "coding" };
    case "protocol_merge_required":
    case "cli_pr_finalized":
      return { stage: "ci" };
    case "ci_gate_status":
      return resolveCiGateStage(event);
    case "cli_git_no_changes":
      return { stage: "coding", terminal: true };
    case "cli_workflow_completed":
      return event.payload?.outcome === "no_changes" || !hasMergeEvidence
        ? { stage: "coding", terminal: true }
        : { stage: "coding" };
    case "run_completed":
      return hasMergeEvidence
        ? { stage: "coding" }
        : { stage: "coding", terminal: true };
    case "run_failed":
    case "run_blocked":
    case "dispatch_failed":
    case "dispatch_cancelled":
    case "worker_cancelled":
    case "cli_workflow_failed":
    case "cli_workflow_cancelled":
    case "cli_workflow_quota":
    case "action_required_auto_failed":
      return { stage: "coding", terminal: true };
    default:
      return null;
  }
}

export function findLatestStageSignal(
  task: Pick<Subtask, "worker_branch" | "pr_url">,
  events: ExecutionRuntimeEventSummary[],
  dispatch?: ExecutionTaskDispatchSummary | null,
): StageSignal | null {
  let latestSignal: StageSignal | null = null;
  for (const event of events) {
    const signal = resolveEventStage(task, event, dispatch);
    if (signal) {
      latestSignal = signal;
    }
  }
  return latestSignal;
}

export function findCodingCompletedAt(task: Pick<Subtask, "worker_branch" | "pr_url">, events: ExecutionRuntimeEventSummary[]): string | null {
  for (const event of events) {
    if (event.eventType === "cli_git_no_changes") {
      return event.createdAt;
    }
    if (
      taskHasMergeEvidence(task)
      && (event.eventType === "run_completed" || event.eventType === "cli_workflow_completed")
    ) {
      return event.createdAt;
    }
  }
  return null;
}

export function findLatestPostCodingStageSignal(
  task: Pick<Subtask, "worker_branch" | "pr_url">,
  events: ExecutionRuntimeEventSummary[],
  codingCompletedAt: string | null,
  dispatch?: ExecutionTaskDispatchSummary | null,
): { at: string; signal: StageSignal } | null {
  let latestSignal: { at: string; signal: StageSignal } | null = null;

  for (const event of events) {
    if (codingCompletedAt && compareIsoAsc(event.createdAt, codingCompletedAt) < 0) {
      continue;
    }
    const signal = resolveEventStage(task, event, dispatch);
    if (!signal || signal.stage === "coding") {
      continue;
    }
    latestSignal = {
      at: event.createdAt,
      signal,
    };
  }

  return latestSignal;
}

export function resolveDispatchTerminalAt(dispatch: ExecutionTaskDispatchSummary | null): string | null {
  if (!dispatch) {
    return null;
  }

  if (dispatch.finishedAt) {
    return dispatch.finishedAt;
  }

  const terminalStatus = (
    dispatch.status === "completed"
    || dispatch.status === "failed"
    || dispatch.status === "blocked"
    || dispatch.status === "quota"
    || dispatch.status === "cancelled"
  );
  return terminalStatus
    ? maxIso(dispatch.lastHeartbeatAt, dispatch.startedAt, dispatch.claimedAt, dispatch.queuedAt)
    : null;
}

export function resolveTerminalEventSignal(
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

export class LiveRuntimeProjection {
  private readonly dispatches: ExecutionTaskDispatchSummary[];
  private readonly events: ExecutionRuntimeEventSummary[];
  private readonly index: IndexedExecutionHistory;

  constructor(dispatches: ExecutionTaskDispatchSummary[], events: ExecutionRuntimeEventSummary[]) {
    this.dispatches = dispatches;
    this.events = events;

    this.index = {
      dispatchesByRecordId: new Map(),
      dispatchesByTaskKey: new Map(),
      eventsByTaskRunId: new Map(),
      eventsByDispatchId: new Map(),
      eventsByRecordId: new Map(),
      eventsByTaskKey: new Map(),
    };

    for (const dispatch of dispatches) {
      if (dispatch.taskId) {
        const list = this.index.dispatchesByRecordId.get(dispatch.taskId) ?? [];
        list.push(dispatch);
        this.index.dispatchesByRecordId.set(dispatch.taskId, list);
      }
      if (dispatch.taskKey) {
        const list = this.index.dispatchesByTaskKey.get(dispatch.taskKey) ?? [];
        list.push(dispatch);
        this.index.dispatchesByTaskKey.set(dispatch.taskKey, list);
      }
    }

    for (const event of events) {
      if (event.taskRunId) {
        const list = this.index.eventsByTaskRunId.get(event.taskRunId) ?? [];
        list.push(event);
        this.index.eventsByTaskRunId.set(event.taskRunId, list);
      }
      if (event.dispatchId) {
        const list = this.index.eventsByDispatchId.get(event.dispatchId) ?? [];
        list.push(event);
        this.index.eventsByDispatchId.set(event.dispatchId, list);
      }
      if (event.taskId) {
        const list = this.index.eventsByRecordId.get(event.taskId) ?? [];
        list.push(event);
        this.index.eventsByRecordId.set(event.taskId, list);
      }
      if (event.taskKey) {
        const list = this.index.eventsByTaskKey.get(event.taskKey) ?? [];
        list.push(event);
        this.index.eventsByTaskKey.set(event.taskKey, list);
      }
    }
  }

  public getRawDispatches() {
    return this.dispatches;
  }

  public getRawEvents() {
    return this.events;
  }

  public pickLatestTaskDispatch(task: Subtask): ExecutionTaskDispatchSummary | null {
    const recordId = normalizeString(task.record_id);
    const rawDispatches = recordId && this.index.dispatchesByRecordId.has(recordId)
      ? this.index.dispatchesByRecordId.get(recordId)!
      : this.index.dispatchesByTaskKey.has(task.id)
        ? this.index.dispatchesByTaskKey.get(task.id)!
        : this.dispatches;

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

  public getTaskEventsForLiveTask(
    task: Subtask,
    dispatch: ExecutionTaskDispatchSummary | null,
  ): ExecutionRuntimeEventSummary[] {
    const recordId = normalizeString(task.record_id);

    const rawEvents = dispatch?.taskRunId && this.index.eventsByTaskRunId.has(dispatch.taskRunId)
      ? this.index.eventsByTaskRunId.get(dispatch.taskRunId)!
      : dispatch?.id && this.index.eventsByDispatchId.has(dispatch.id)
        ? this.index.eventsByDispatchId.get(dispatch.id)!
        : recordId && this.index.eventsByRecordId.has(recordId)
          ? this.index.eventsByRecordId.get(recordId)!
          : this.index.eventsByTaskKey.has(task.id)
            ? this.index.eventsByTaskKey.get(task.id)!
            : this.events;

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
      const recordIdMatches = scopedEvents.filter((event) => event.taskId === recordId);
      if (recordIdMatches.length > 0) {
        return sortEvents(recordIdMatches);
      }
    }

    const taskKeyMatches = scopedEvents.filter((event) => event.taskKey === task.id);
    return taskKeyMatches.length > 0 ? sortEvents(taskKeyMatches) : [];
  }

  public getTaskRuntime(task: Subtask): ProjectedTaskRuntime {
    const dispatch = this.pickLatestTaskDispatch(task);
    const events = this.getTaskEventsForLiveTask(task, dispatch);
    const terminalSignal = findLatestTerminalTaskSignal(events);
    const latestStageSignal = findLatestStageSignal(task, events, dispatch);
    const codingCompletedAt = maxIso(
      dispatch?.finishedAt ?? null,
      findCodingCompletedAt(task, events),
    );
    const latestPostCodingStageSignal = findLatestPostCodingStageSignal(
      task,
      events,
      codingCompletedAt,
      dispatch,
    );
    const dispatchTerminalAt = resolveDispatchTerminalAt(dispatch);

    return {
      dispatch,
      events,
      terminalSignal,
      latestStageSignal,
      codingCompletedAt,
      latestPostCodingStageSignal,
      dispatchTerminalAt,
    };
  }
}
