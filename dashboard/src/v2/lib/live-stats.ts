import type {
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import {
  getLiveTaskProgressPhase,
  getTaskProgressPhase,
  type TaskProgressPhase,
} from "../../lib/task-progress.js";

export const LIVE_TASK_STAGE_ORDER = ["queued", "coding", "ci", "autofix", "merge"] as const;

/**
 * Dedicated stage order for the Live Session stats deck.
 * Excludes 'queued' as it's not considered a 'live' execution stage for this view.
 */
export const STATS_DECK_VISIBLE_STAGES: ReadonlyArray<LiveTaskStageKey> = [
  "coding",
  "ci",
  "autofix",
  "merge",
];

export type LiveTaskStageKey = (typeof LIVE_TASK_STAGE_ORDER)[number];

export interface LiveTaskStageSegment {
  stage: LiveTaskStageKey;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  isActive: boolean;
}

export interface LiveTaskTimingSummary {
  taskId: string;
  taskKey: string;
  taskTitle: string;
  phase: ReturnType<typeof getTaskProgressPhase>;
  startedAt: string | null;
  endedAt: string | null;
  totalSeconds: number;
  activeStage: LiveTaskStageKey | null;
  stageTotals: Record<LiveTaskStageKey, number>;
  segments: LiveTaskStageSegment[];
}

export interface LiveSprintTimingSummary {
  sprintStartedAt: string | null;
  sprintFinishedAt: string | null;
  sprintElapsedSeconds: number;
  trackedTaskCount: number;
  completedTaskCount: number;
  averageCompletedTaskSeconds: number;
  activeStageCounts: Record<LiveTaskStageKey, number>;
  stageTotals: Record<LiveTaskStageKey, number>;
  longestTask: {
    taskId: string;
    taskKey: string;
    taskTitle: string;
    totalSeconds: number;
  } | null;
}

interface LiveStatsModelArgs {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  sprintRuns: ExecutionSprintRunSummary[];
  nowIso?: string;
}

interface ScopedExecutionHistory {
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
}

const ZERO_STAGE_TOTALS = (): Record<LiveTaskStageKey, number> => ({
  queued: 0,
  coding: 0,
  ci: 0,
  autofix: 0,
  merge: 0,
});

function toMillis(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareIsoAsc(a: string, b: string): number {
  return a.localeCompare(b);
}

function maxIso(...values: Array<string | null | undefined>): string | null {
  const normalized = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort(compareIsoAsc);
  return normalized.length > 0 ? normalized[normalized.length - 1] : null;
}

function secondsBetween(startedAt: string, endedAt: string): number {
  const startedMs = toMillis(startedAt);
  const endedMs = toMillis(endedAt);
  if (startedMs == null || endedMs == null) {
    return 0;
  }
  return Math.max(0, Math.floor((endedMs - startedMs) / 1000));
}

function getDispatchMoment(dispatch: ExecutionTaskDispatchSummary, field: "queuedAt" | "claimedAt" | "startedAt" | "finishedAt"): string | null {
  return dispatch[field] ?? null;
}

function getDispatchRecency(dispatch: ExecutionTaskDispatchSummary): string {
  return (
    getDispatchMoment(dispatch, "finishedAt")
    || getDispatchMoment(dispatch, "startedAt")
    || getDispatchMoment(dispatch, "claimedAt")
    || getDispatchMoment(dispatch, "queuedAt")
    || ""
  );
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

function pickLatestDispatch(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
): ExecutionTaskDispatchSummary | null {
  const recordId = typeof task.record_id === "string" ? task.record_id : null;
  const scopedDispatches = dispatches.filter((dispatch) => taskScopeMatchesDispatch(task, dispatch));
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

function getTaskEvents(
  task: Subtask,
  dispatch: ExecutionTaskDispatchSummary | null,
  events: ExecutionRuntimeEventSummary[],
): ExecutionRuntimeEventSummary[] {
  const recordId = typeof task.record_id === "string" ? task.record_id : null;
  const scopedEvents = events.filter((event) => taskScopeMatchesEvent(task, event));
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

function taskHasMergeEvidence(task: Pick<Subtask, "worker_branch" | "pr_url">): boolean {
  const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch.trim() : "";
  const prUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

function dispatchHasMergeEvidence(
  dispatch: Pick<ExecutionTaskDispatchSummary, "workerBranch" | "prUrl"> | null | undefined,
): boolean {
  const workerBranch = typeof dispatch?.workerBranch === "string" ? dispatch.workerBranch.trim() : "";
  const prUrl = typeof dispatch?.prUrl === "string" ? dispatch.prUrl.trim() : "";
  return workerBranch.length > 0 || prUrl.length > 0;
}

type StageSignal = {
  stage: LiveTaskStageKey;
  terminal?: boolean;
} | null;

interface TerminalTaskSignal {
  at: string;
  phase: TaskProgressPhase;
  mergeSettled?: boolean;
}

function resolveCiGateStage(event: ExecutionRuntimeEventSummary): StageSignal {
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

function resolveEventStage(
  task: Subtask,
  event: ExecutionRuntimeEventSummary,
  dispatch?: ExecutionTaskDispatchSummary | null,
): StageSignal {
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

function resolveTerminalEventSignal(
  task: Subtask,
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

function findLatestTerminalEventSignal(
  task: Subtask,
  events: ExecutionRuntimeEventSummary[],
): TerminalTaskSignal | null {
  let latestSignal: TerminalTaskSignal | null = null;
  for (const event of events) {
    const signal = resolveTerminalEventSignal(task, event);
    if (signal) {
      latestSignal = signal;
    }
  }
  return latestSignal;
}

function findLatestStageSignal(
  task: Subtask,
  events: ExecutionRuntimeEventSummary[],
  dispatch?: ExecutionTaskDispatchSummary | null,
): StageSignal {
  let latestSignal: StageSignal = null;
  for (const event of events) {
    const signal = resolveEventStage(task, event, dispatch);
    if (signal) {
      latestSignal = signal;
    }
  }
  return latestSignal;
}

function findCodingCompletedAt(task: Subtask, events: ExecutionRuntimeEventSummary[]): string | null {
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

function findLatestPostCodingStageSignal(
  task: Subtask,
  events: ExecutionRuntimeEventSummary[],
  codingCompletedAt: string | null,
  dispatch?: ExecutionTaskDispatchSummary | null,
): { at: string; signal: Exclude<StageSignal, null> } | null {
  let latestSignal: { at: string; signal: Exclude<StageSignal, null> } | null = null;

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

function resolveDispatchTerminalAt(dispatch: ExecutionTaskDispatchSummary | null): string | null {
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

function deriveTaskEndAt(args: {
  task: Subtask;
  phase: TaskProgressPhase;
  dispatch: ExecutionTaskDispatchSummary | null;
  events: ExecutionRuntimeEventSummary[];
  nowIso: string;
}): string | null {
  const latestEventAt = args.events.length > 0 ? args.events[args.events.length - 1]?.createdAt ?? null : null;
  const runtimeTerminalAt = maxIso(
    resolveDispatchTerminalAt(args.dispatch),
    findLatestTerminalEventSignal(args.task, args.events)?.at,
  );
  const latestStageSignal = findLatestStageSignal(args.task, args.events, args.dispatch);
  const codingCompletedAt = maxIso(
    args.dispatch?.finishedAt ?? null,
    findCodingCompletedAt(args.task, args.events),
  );
  const latestPostCodingStageSignal = findLatestPostCodingStageSignal(
    args.task,
    args.events,
    codingCompletedAt,
    args.dispatch,
  );
  const hasMergeEvidence = taskHasMergeEvidence(args.task) || dispatchHasMergeEvidence(args.dispatch);

  if (args.phase === "RUNNING") {
    return runtimeTerminalAt ?? args.nowIso;
  }

  if (args.phase === "FAILED" || args.phase === "BLOCKED" || args.phase === "QUOTA") {
    return runtimeTerminalAt ?? latestEventAt;
  }

  if (args.phase === "PENDING") {
    return null;
  }

  if (args.phase === "CODING_COMPLETED") {
    if (latestPostCodingStageSignal) {
      return latestPostCodingStageSignal.signal.terminal
        ? maxIso(codingCompletedAt, runtimeTerminalAt, latestPostCodingStageSignal.at)
        : args.nowIso;
    }
    if (codingCompletedAt || runtimeTerminalAt) {
      return maxIso(codingCompletedAt, runtimeTerminalAt);
    }
    if (latestStageSignal && !latestStageSignal.terminal && latestStageSignal.stage !== "coding") {
      return args.nowIso;
    }
    return latestEventAt;
  }

  if (args.phase === "COMPLETED" && hasMergeEvidence) {
    return codingCompletedAt ?? runtimeTerminalAt ?? latestEventAt;
  }

  return runtimeTerminalAt ?? latestEventAt;
}

function createSegment(stage: LiveTaskStageKey, startedAt: string, endedAt: string, isActive: boolean): LiveTaskStageSegment {
  return {
    stage,
    startedAt,
    endedAt,
    durationSeconds: secondsBetween(startedAt, endedAt),
    isActive,
  };
}

export function buildLiveTaskTimingSummary(args: {
  task: Subtask;
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  nowIso?: string;
}): LiveTaskTimingSummary {
  const nowIso = args.nowIso || new Date().toISOString();
  const dispatch = pickLatestDispatch(args.task, args.dispatches);
  const taskEvents = getTaskEvents(args.task, dispatch, args.events);
  const terminalEvent = findLatestTerminalEventSignal(args.task, taskEvents);
  const phase = getLiveTaskProgressPhase({
    task: args.task,
    dispatch,
    runtimeTerminalPhase: terminalEvent?.phase ?? null,
    runtimeMergeSettled: terminalEvent?.mergeSettled === true,
  });
  const startedAt = (
    dispatch?.startedAt
    || dispatch?.claimedAt
    || dispatch?.queuedAt
    || taskEvents[0]?.createdAt
    || null
  );
  const codingCompletedAt = maxIso(
    dispatch?.finishedAt ?? null,
    findCodingCompletedAt(args.task, taskEvents),
  );
  const endedAt = deriveTaskEndAt({
    task: args.task,
    phase,
    dispatch,
    events: taskEvents,
    nowIso,
  });
  const stageTotals = ZERO_STAGE_TOTALS();
  const hasLiveWindow = endedAt === nowIso && (phase === "RUNNING" || phase === "CODING_COMPLETED");

  if (!startedAt || !endedAt) {
    return {
      taskId: args.task.record_id || args.task.id,
      taskKey: args.task.id,
      taskTitle: args.task.title,
      phase,
      startedAt,
      endedAt,
      totalSeconds: 0,
      activeStage: null,
      stageTotals,
      segments: [],
    };
  }

  const segments: LiveTaskStageSegment[] = [];
  let initialStage: LiveTaskStageKey = "coding";
  if (dispatch && !dispatch.startedAt && (dispatch.status === "queued" || dispatch.status === "claimed")) {
    initialStage = "queued";
  }
  let currentStage: LiveTaskStageKey = initialStage;
  let currentStartedAt = startedAt;

  for (const event of taskEvents) {
    if (compareIsoAsc(event.createdAt, currentStartedAt) < 0 || compareIsoAsc(event.createdAt, endedAt) > 0) {
      continue;
    }
    const signal = resolveEventStage(args.task, event, dispatch);
    if (!signal) {
      continue;
    }
    if (
      codingCompletedAt
      && currentStage !== "coding"
      && signal.stage === "coding"
      && compareIsoAsc(event.createdAt, codingCompletedAt) >= 0
    ) {
      continue;
    }
    if (signal.stage !== currentStage && compareIsoAsc(event.createdAt, currentStartedAt) >= 0) {
      segments.push(createSegment(currentStage, currentStartedAt, event.createdAt, false));
      currentStage = signal.stage;
      currentStartedAt = event.createdAt;
    }
    if (signal.terminal) {
      break;
    }
  }

  segments.push(createSegment(
    currentStage,
    currentStartedAt,
    endedAt,
    hasLiveWindow,
  ));

  for (const segment of segments) {
    stageTotals[segment.stage] += segment.durationSeconds;
  }

  return {
    taskId: args.task.record_id || args.task.id,
    taskKey: args.task.id,
    taskTitle: args.task.title,
    phase,
    startedAt,
    endedAt,
    totalSeconds: secondsBetween(startedAt, endedAt),
    activeStage: hasLiveWindow
      ? segments[segments.length - 1]?.stage ?? null
      : null,
    stageTotals,
    segments,
  };
}

export function buildLiveTaskTimingSummaries(args: {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  sprintRuns?: ExecutionSprintRunSummary[];
  nowIso?: string;
}): LiveTaskTimingSummary[] {
  const scopedHistory = args.sprintRuns
    ? scopeExecutionHistoryToRelevantSprintRun({
      tasks: args.tasks,
      dispatches: args.dispatches,
      events: args.events,
      sprintRuns: args.sprintRuns,
    })
    : {
      dispatches: args.dispatches,
      events: args.events,
    };

  return args.tasks.map((task) => buildLiveTaskTimingSummary({
    task,
    dispatches: scopedHistory.dispatches,
    events: scopedHistory.events,
    nowIso: args.nowIso,
  }));
}

function selectRelevantSprintRun(tasks: Subtask[], sprintRuns: ExecutionSprintRunSummary[]): ExecutionSprintRunSummary | null {
  if (sprintRuns.length === 0) {
    return null;
  }
  const scopedSprintRuns = tasks[0]?.sprint_id
    ? sprintRuns.filter((run) => run.sprintId === tasks[0]?.sprint_id)
    : sprintRuns;

  return [...(scopedSprintRuns.length > 0 ? scopedSprintRuns : sprintRuns)]
    .sort((left, right) => compareIsoAsc(
      left.startedAt || left.createdAt,
      right.startedAt || right.createdAt,
    ))
    .at(-1) ?? null;
}

function scopeExecutionHistoryToRelevantSprintRun(args: {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  sprintRuns: ExecutionSprintRunSummary[];
}): ScopedExecutionHistory {
  const relevantSprintRunId = selectRelevantSprintRun(args.tasks, args.sprintRuns)?.id ?? null;
  if (!relevantSprintRunId) {
    return {
      dispatches: args.dispatches,
      events: args.events,
    };
  }

  return {
    dispatches: args.dispatches.filter((dispatch) => dispatch.sprintRunId === relevantSprintRunId),
    events: args.events.filter((event) => event.sprintRunId === relevantSprintRunId),
  };
}

export function buildLiveSprintTimingSummary(args: LiveStatsModelArgs): LiveSprintTimingSummary {
  const nowIso = args.nowIso || new Date().toISOString();
  const scopedHistory = scopeExecutionHistoryToRelevantSprintRun(args);
  const taskTimings = buildLiveTaskTimingSummaries({
    tasks: args.tasks,
    dispatches: scopedHistory.dispatches,
    events: scopedHistory.events,
    nowIso,
  });
  const relevantSprintRun = selectRelevantSprintRun(args.tasks, args.sprintRuns);
  const sprintStartedAt = relevantSprintRun?.startedAt
    || taskTimings
      .map((timing) => timing.startedAt)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort(compareIsoAsc)[0]
    || null;
  const sprintFinishedAt = relevantSprintRun?.finishedAt ?? null;
  const sprintElapsedSeconds = sprintStartedAt
    ? secondsBetween(sprintStartedAt, sprintFinishedAt || nowIso)
    : 0;
  const stageTotals = ZERO_STAGE_TOTALS();
  const activeStageCounts = ZERO_STAGE_TOTALS();

  let completedTaskCount = 0;
  let completedTaskDurationTotal = 0;
  let longestTask: LiveSprintTimingSummary["longestTask"] = null;

  for (const timing of taskTimings) {
    for (const stage of LIVE_TASK_STAGE_ORDER) {
      stageTotals[stage] += timing.stageTotals[stage];
    }
    if (timing.activeStage) {
      activeStageCounts[timing.activeStage] += 1;
    }
    if (timing.phase === "COMPLETED") {
      completedTaskCount += 1;
      completedTaskDurationTotal += timing.totalSeconds;
    }
    if (!longestTask || timing.totalSeconds > longestTask.totalSeconds) {
      longestTask = {
        taskId: timing.taskId,
        taskKey: timing.taskKey,
        taskTitle: timing.taskTitle,
        totalSeconds: timing.totalSeconds,
      };
    }
  }

  return {
    sprintStartedAt,
    sprintFinishedAt,
    sprintElapsedSeconds,
    trackedTaskCount: taskTimings.filter((timing) => timing.startedAt !== null).length,
    completedTaskCount,
    averageCompletedTaskSeconds: completedTaskCount > 0
      ? Math.round(completedTaskDurationTotal / completedTaskCount)
      : 0,
    activeStageCounts,
    stageTotals,
    longestTask,
  };
}
