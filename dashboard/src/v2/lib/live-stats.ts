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
import {
  LiveRuntimeProjection,
  type ProjectedTaskRuntime,
  type LiveTaskStageKey,
  LIVE_TASK_STAGE_ORDER,
  compareIsoAsc,
  maxIso,
  taskHasMergeEvidence,
  dispatchHasMergeEvidence,
  resolveEventStage,
} from "./live-runtime-history.js";

export { LIVE_TASK_STAGE_ORDER, type LiveTaskStageKey } from "./live-runtime-history.js";

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

function secondsBetween(startedAt: string, endedAt: string): number {
  const startedMs = toMillis(startedAt);
  const endedMs = toMillis(endedAt);
  if (startedMs == null || endedMs == null) {
    return 0;
  }
  return Math.max(0, Math.floor((endedMs - startedMs) / 1000));
}

function deriveTaskEndAt(args: {
  task: Subtask;
  phase: TaskProgressPhase;
  runtime: ProjectedTaskRuntime;
  nowIso: string;
}): string | null {
  const { events, dispatch, terminalSignal, latestStageSignal, codingCompletedAt, latestPostCodingStageSignal, dispatchTerminalAt } = args.runtime;

  const latestEventAt = events.length > 0 ? events[events.length - 1]?.createdAt ?? null : null;
  const runtimeTerminalAt = maxIso(dispatchTerminalAt, terminalSignal?.at);
  const hasMergeEvidence = taskHasMergeEvidence(args.task) || dispatchHasMergeEvidence(dispatch);

  if (args.phase === "RUNNING") {
    return runtimeTerminalAt ?? args.nowIso;
  }

  if (args.phase === "FAILED" || args.phase === "BLOCKED" || args.phase === "QUOTA") {
    return maxIso(runtimeTerminalAt, latestEventAt);
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
    if (latestPostCodingStageSignal) {
      return latestPostCodingStageSignal.signal.terminal
        ? maxIso(codingCompletedAt, runtimeTerminalAt, latestPostCodingStageSignal.at)
        : args.nowIso;
    }
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
  projection?: LiveRuntimeProjection;
}): LiveTaskTimingSummary {
  const nowIso = args.nowIso || new Date().toISOString();
  const projection = args.projection ?? new LiveRuntimeProjection(args.dispatches, args.events);
  const runtime = projection.getTaskRuntime(args.task);
  const { dispatch, events: taskEvents, terminalSignal, codingCompletedAt } = runtime;

  const phase = getLiveTaskProgressPhase({
    task: args.task,
    dispatch,
    runtimeTerminalPhase: terminalSignal?.phase ?? null,
    runtimeMergeSettled: terminalSignal?.mergeSettled === true,
  });
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
    runtime,
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

  const wallTimeMs = dispatch?.usage?.wallTimeMs;
  if (typeof wallTimeMs === "number" && wallTimeMs > 0) {
    const wallTimeSeconds = Math.floor(wallTimeMs / 1000);
    if (hasLiveWindow && segments[segments.length - 1]?.stage === "coding") {
      stageTotals["coding"] = Math.max(stageTotals["coding"], wallTimeSeconds);
    } else {
      stageTotals["coding"] = wallTimeSeconds;
    }
  }

  const recalculatedTotalSeconds = LIVE_TASK_STAGE_ORDER.reduce((acc, stage) => acc + stageTotals[stage], 0);

  return {
    taskId: args.task.record_id || args.task.id,
    taskKey: args.task.id,
    taskTitle: args.task.title,
    phase,
    startedAt,
    endedAt,
    totalSeconds: recalculatedTotalSeconds,
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

  const projection = new LiveRuntimeProjection(scopedHistory.dispatches, scopedHistory.events);

  return args.tasks.map((task) => buildLiveTaskTimingSummary({
    task,
    dispatches: scopedHistory.dispatches,
    events: scopedHistory.events,
    nowIso: args.nowIso,
    projection,
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
