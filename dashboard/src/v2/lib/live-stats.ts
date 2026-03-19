import type {
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import { getTaskProgressPhase } from "../../lib/task-progress.js";

export const LIVE_TASK_STAGE_ORDER = ["queued", "coding", "ci", "autofix", "merge"] as const;

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

function pickLatestDispatch(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
): ExecutionTaskDispatchSummary | null {
  const recordId = typeof task.record_id === "string" ? task.record_id : null;
  const matching = dispatches.filter((dispatch) => (
    (recordId && dispatch.taskId === recordId) || dispatch.taskKey === task.id
  ));
  if (matching.length === 0) {
    return null;
  }
  return [...matching].sort((left, right) => compareIsoAsc(getDispatchRecency(left), getDispatchRecency(right))).at(-1) ?? null;
}

function getTaskEvents(
  task: Subtask,
  dispatch: ExecutionTaskDispatchSummary | null,
  events: ExecutionRuntimeEventSummary[],
): ExecutionRuntimeEventSummary[] {
  const recordId = typeof task.record_id === "string" ? task.record_id : null;
  const filtered = events.filter((event) => {
    if (dispatch?.taskRunId && event.taskRunId === dispatch.taskRunId) {
      return true;
    }
    if (dispatch?.id && event.dispatchId === dispatch.id) {
      return true;
    }
    if (recordId && event.taskId === recordId) {
      return true;
    }
    return event.taskKey === task.id;
  });

  const deduped = new Map<string, ExecutionRuntimeEventSummary>();
  for (const event of filtered) {
    deduped.set(event.id, event);
  }
  return [...deduped.values()].sort((left, right) => compareIsoAsc(left.createdAt, right.createdAt));
}

type StageSignal = {
  stage: LiveTaskStageKey;
  terminal?: boolean;
} | null;

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
    return { stage: "merge" };
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

function resolveEventStage(event: ExecutionRuntimeEventSummary): StageSignal {
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
    case "cli_workflow_completed":
    case "run_completed":
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

function deriveTaskEndAt(args: {
  task: Subtask;
  phase: ReturnType<typeof getTaskProgressPhase>;
  dispatch: ExecutionTaskDispatchSummary | null;
  events: ExecutionRuntimeEventSummary[];
  nowIso: string;
}): string | null {
  const latestEventAt = args.events.length > 0 ? args.events[args.events.length - 1]?.createdAt ?? null : null;
  const dispatchFinishedAt = args.dispatch?.finishedAt ?? null;

  if (args.phase === "RUNNING" || args.phase === "CODING_COMPLETED") {
    return args.nowIso;
  }

  if (args.phase === "PENDING") {
    return null;
  }

  return maxIso(dispatchFinishedAt, latestEventAt);
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
  const phase = getTaskProgressPhase(args.task);
  const dispatch = pickLatestDispatch(args.task, args.dispatches);
  const taskEvents = getTaskEvents(args.task, dispatch, args.events);
  const startedAt = (
    dispatch?.startedAt
    || dispatch?.claimedAt
    || dispatch?.queuedAt
    || taskEvents[0]?.createdAt
    || null
  );
  const endedAt = deriveTaskEndAt({
    task: args.task,
    phase,
    dispatch,
    events: taskEvents,
    nowIso,
  });
  const stageTotals = ZERO_STAGE_TOTALS();

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
    const signal = resolveEventStage(event);
    if (!signal) {
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
    phase === "RUNNING" || phase === "CODING_COMPLETED",
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
    activeStage: phase === "RUNNING" || phase === "CODING_COMPLETED"
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
  nowIso?: string;
}): LiveTaskTimingSummary[] {
  return args.tasks.map((task) => buildLiveTaskTimingSummary({
    task,
    dispatches: args.dispatches,
    events: args.events,
    nowIso: args.nowIso,
  }));
}

function selectRelevantSprintRun(sprintRuns: ExecutionSprintRunSummary[]): ExecutionSprintRunSummary | null {
  if (sprintRuns.length === 0) {
    return null;
  }
  return [...sprintRuns]
    .sort((left, right) => compareIsoAsc(
      left.startedAt || left.createdAt,
      right.startedAt || right.createdAt,
    ))
    .at(-1) ?? null;
}

export function buildLiveSprintTimingSummary(args: LiveStatsModelArgs): LiveSprintTimingSummary {
  const nowIso = args.nowIso || new Date().toISOString();
  const taskTimings = buildLiveTaskTimingSummaries({
    tasks: args.tasks,
    dispatches: args.dispatches,
    events: args.events,
    nowIso,
  });
  const relevantSprintRun = selectRelevantSprintRun(args.sprintRuns);
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
