import type { TransportState } from "../../lib/realtime/dashboard-realtime-client.js";
import type { ExecutionSnapshotSurfaceState } from "../../hooks/ExecutionTimelineContext.js";
import type {
  DashboardStats,
  ExecutionDashboardSnapshot,
  ExecutionInvocationRecord,
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
import type { LiveTaskTimingSummary } from "./live-stats.js";
import {
  buildIndexedExecutionHistory,
  findActiveQuotaWait,
  getTaskEventsForLiveTask,
  pickLatestTaskDispatch,
  projectLiveTask,
} from "./live-task-runtime.js";
import { deriveLiveDurationDisplay } from "./live-duration-display.js";

export type LiveSessionTaskFilter = "All" | "Running" | "Completed" | "Failed" | "Pending";

export const LIVE_SESSION_TASK_FILTERS: LiveSessionTaskFilter[] = ["All", "Running", "Completed", "Failed", "Pending"];

const FILTER_STATUS_MAP: Record<LiveSessionTaskFilter, string | null> = {
  All: null,
  Running: "RUNNING",
  Completed: "COMPLETED",
  Failed: "FAILED",
  Pending: "PENDING",
};

export interface ScopedLiveSessionRuntime {
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  sprintRuns: ExecutionSprintRunSummary[];
  invocations: ExecutionInvocationRecord[];
}

export interface FilteredLiveSessionTasks {
  filteredTasks: Subtask[];
  taskCounts: Record<LiveSessionTaskFilter, number>;
  announcement: string;
}

export interface LiveSessionTaskCardItem {
  key: string;
  task: Subtask;
  phase: TaskProgressPhase;
  taskTiming: LiveTaskTimingSummary | null;
  events: ExecutionRuntimeEventSummary[];
  invocations: ExecutionInvocationRecord[];
  isRerunning: boolean;
  isForceCompleting: boolean;
  forceCompleteError: string | null;
  dispatchInfo: {
    errorMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    status: string | null;
  } | null;
}

export interface LiveSessionTaskCardStateInput {
  filteredTasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  invocations: ExecutionInvocationRecord[];
  taskTimingMap: Map<string, LiveTaskTimingSummary>;
  rerunningIds: Set<string>;
  forceCompletePendingIds: Set<string>;
  forceCompleteErrorByTaskId: Map<string, string>;
  optimisticallyCompletedTaskIds: Set<string>;
}

export interface LiveTransportBannerViewModel {
  isVisible: boolean;
  title: "Connection Error" | "Disconnected" | "Reconnecting" | "Refreshing Live Data" | "Recovering Live Data" | "Stale Data";
  message: string;
  wrapperClass: string;
  iconClass: string;
  icon: "error" | "disconnected" | "reconnecting";
  isUrgent: boolean;
  ariaLive: "assertive" | "polite";
  role: "alert" | "status";
  ariaBusy: boolean;
}

const LIVE_SNAPSHOT_STALE_MS = 60_000;

const EMPTY_LIVE_SESSION_STATS: DashboardStats = {
  total: 0,
  running: 0,
  codingCompleted: 0,
  completed: 0,
  failed: 0,
  ci: 0,
  qa: 0,
  automerge: 0,
  merged: 0,
  mergeBlocked: 0,
  mergeConflicts: 0,
};

const EMPTY_RUNTIME_EVENTS: ExecutionRuntimeEventSummary[] = [];

function addToIndex<K, V>(index: Map<K, V[]>, key: K | null | undefined, value: V): void {
  if (!key) {
    return;
  }
  const list = index.get(key) ?? [];
  list.push(value);
  index.set(key, list);
}

export function deriveScopedLiveSessionRuntime(
  execution: ExecutionDashboardSnapshot,
  sprintScopeId: string | null,
  sprintScopeReady: boolean,
): ScopedLiveSessionRuntime {
  if (!sprintScopeReady) {
    return {
      dispatches: [],
      events: [],
      sprintRuns: [],
      invocations: [],
    };
  }

  const invocations = execution.recentInvocations ?? [];
  if (!sprintScopeId) {
    return {
      dispatches: execution.taskDispatches,
      events: execution.recentEvents,
      sprintRuns: execution.sprintRuns,
      invocations,
    };
  }

  return {
    dispatches: execution.taskDispatches.filter((dispatch) => dispatch.sprintId === sprintScopeId),
    events: execution.recentEvents.filter((event) => event.sprintId === sprintScopeId),
    sprintRuns: execution.sprintRuns.filter((run) => run.sprintId === sprintScopeId),
    invocations: invocations.filter((invocation) => invocation.sprintId === sprintScopeId),
  };
}

export function deriveProjectedLiveSessionTasks(
  tasks: Subtask[],
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): Subtask[] {
  const historyIndex = buildIndexedExecutionHistory(dispatches, events);
  return tasks.map((task) => projectLiveTask(task, dispatches, events, historyIndex));
}

export function deriveLiveSessionStats(tasks: Subtask[], hasSprintContext: boolean): DashboardStats {
  if (!hasSprintContext) {
    return EMPTY_LIVE_SESSION_STATS;
  }

  const stats: DashboardStats = { ...EMPTY_LIVE_SESSION_STATS, total: tasks.length };
  for (const task of tasks) {
    switch (task.status) {
      case "RUNNING":
        stats.running += 1;
        break;
      case "CODING_COMPLETED":
        stats.codingCompleted += 1;
        break;
      case "COMPLETED":
        stats.completed += 1;
        break;
      case "FAILED":
        stats.failed += 1;
        break;
      default:
        break;
    }

    switch (task.merge_indicator) {
      case "CI":
        stats.ci += 1;
        break;
      case "QA_PENDING":
        stats.qa += 1;
        break;
      case "AUTOMERGE":
        stats.automerge += 1;
        break;
      case "MERGE_BLOCKED":
        stats.mergeBlocked += 1;
        break;
      case "MERGE_CONFLICT":
        stats.mergeConflicts += 1;
        break;
      default:
        break;
    }

    if (task.merge_indicator === "MERGED" || task.is_merged) {
      stats.merged += 1;
    }
  }

  return stats;
}

export function deriveHasLiveDurationTicker(
  taskTimings: LiveTaskTimingSummary[],
  dispatches: ExecutionTaskDispatchSummary[],
): boolean {
  return taskTimings.some((taskTiming) => deriveLiveDurationDisplay({ taskTiming }).mode === "live")
    || dispatches.some((dispatch) => deriveLiveDurationDisplay({
      dispatchTiming: {
        startedAt: dispatch.startedAt,
        finishedAt: dispatch.finishedAt,
        status: dispatch.status,
      },
    }).mode === "live");
}

export function deriveFilteredLiveSessionTasks(
  tasks: Subtask[],
  stats: DashboardStats,
  activeFilter: LiveSessionTaskFilter,
): FilteredLiveSessionTasks {
  const filteredTasks: Subtask[] = [];
  const targetStatus = FILTER_STATUS_MAP[activeFilter];
  let pendingCount = 0;

  for (const task of tasks) {
    const phase = getTaskProgressPhase(task);
    const isPending = phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";

    if (isPending) {
      pendingCount += 1;
    }

    if (
      activeFilter === "All"
      || (activeFilter === "Pending" && isPending)
      || (activeFilter !== "Pending" && targetStatus !== null && phase === targetStatus)
    ) {
      filteredTasks.push(task);
    }
  }

  return {
    filteredTasks,
    taskCounts: {
      All: tasks.length,
      Running: stats.running,
      Completed: stats.completed,
      Failed: stats.failed,
      Pending: pendingCount,
    },
    announcement: deriveLiveSessionTaskFilterAnnouncement(activeFilter, filteredTasks.length),
  };
}

export function deriveLiveSessionTaskFilterAnnouncement(
  activeFilter: LiveSessionTaskFilter,
  filteredTaskCount: number,
): string {
  return `${filteredTaskCount} ${activeFilter.toLowerCase()} task${filteredTaskCount === 1 ? "" : "s"} shown.`;
}

function buildInvocationIndexes(invocations: ExecutionInvocationRecord[]): {
  byTaskId: Map<string, ExecutionInvocationRecord[]>;
  byTaskKey: Map<string, ExecutionInvocationRecord[]>;
  byDispatchId: Map<string, ExecutionInvocationRecord[]>;
  byTaskRunId: Map<string, ExecutionInvocationRecord[]>;
} {
  const indexes = {
    byTaskId: new Map<string, ExecutionInvocationRecord[]>(),
    byTaskKey: new Map<string, ExecutionInvocationRecord[]>(),
    byDispatchId: new Map<string, ExecutionInvocationRecord[]>(),
    byTaskRunId: new Map<string, ExecutionInvocationRecord[]>(),
  };

  for (const invocation of invocations) {
    addToIndex(indexes.byTaskId, invocation.taskId, invocation);
    addToIndex(indexes.byTaskKey, invocation.taskKey, invocation);
    addToIndex(indexes.byDispatchId, invocation.dispatchId, invocation);
    addToIndex(indexes.byTaskRunId, invocation.taskRunId, invocation);
  }

  return indexes;
}

function getTaskInvocations(
  task: Subtask,
  latestDispatch: ExecutionTaskDispatchSummary | null,
  invocations: ExecutionInvocationRecord[],
  indexes: ReturnType<typeof buildInvocationIndexes>,
): ExecutionInvocationRecord[] {
  const taskRuntimeId = task.record_id || task.id;
  const identity = new Set([taskRuntimeId, task.id, task.record_id].filter((value): value is string => Boolean(value)));
  const candidates = new Set<ExecutionInvocationRecord>();

  for (const value of identity) {
    for (const invocation of indexes.byTaskId.get(value) ?? []) {
      candidates.add(invocation);
    }
    for (const invocation of indexes.byTaskKey.get(value) ?? []) {
      candidates.add(invocation);
    }
  }

  for (const invocation of indexes.byDispatchId.get(latestDispatch?.id ?? "") ?? []) {
    candidates.add(invocation);
  }
  for (const invocation of indexes.byTaskRunId.get(latestDispatch?.taskRunId ?? "") ?? []) {
    candidates.add(invocation);
  }

  if (candidates.size === 0) {
    return [];
  }

  return invocations.filter((invocation) => candidates.has(invocation));
}

export function deriveLiveSessionTaskCardItems(input: LiveSessionTaskCardStateInput): LiveSessionTaskCardItem[] {
  const historyIndex = buildIndexedExecutionHistory(input.dispatches, input.events);
  const invocationIndexes = buildInvocationIndexes(input.invocations);

  return input.filteredTasks.map((task) => {
    const taskRuntimeId = task.record_id || task.id;
    const isOptimisticallyCompleted = input.optimisticallyCompletedTaskIds.has(taskRuntimeId);
    const optimisticTask: Subtask = isOptimisticallyCompleted
      ? { ...task, status: "COMPLETED" }
      : task;
    const latestDispatch = pickLatestTaskDispatch(task, input.dispatches, historyIndex);
    const taskEvents = getTaskEventsForLiveTask(task, latestDispatch, input.events, historyIndex);
    const taskInvocations = getTaskInvocations(task, latestDispatch, input.invocations, invocationIndexes);
    const dispatchPhase = isOptimisticallyCompleted
      ? "COMPLETED"
      : getLiveTaskProgressPhase({ task: optimisticTask, dispatch: latestDispatch, events: taskEvents });
    const currentDispatchEvents = latestDispatch
      ? taskEvents.filter((event) => (
        (latestDispatch.taskRunId && event.taskRunId === latestDispatch.taskRunId)
        || (latestDispatch.id && event.dispatchId === latestDispatch.id)
      ))
      : EMPTY_RUNTIME_EVENTS;
    const activeQuotaWait = ["FAILED", "BLOCKED", "QUOTA", "COMPLETED"].includes(dispatchPhase)
      ? null
      : findActiveQuotaWait(currentDispatchEvents);
    const taskPhase = activeQuotaWait ? "QUOTA" : dispatchPhase;
    const showDispatchError = activeQuotaWait
      ? `Provider quota exhausted — waiting for reset. [RETRY_AFTER:${activeQuotaWait.retryAfterIso}]`
      : latestDispatch && ["FAILED", "BLOCKED", "QUOTA"].includes(taskPhase)
        ? latestDispatch.errorMessage
        : null;

    return {
      key: taskRuntimeId,
      task: optimisticTask,
      phase: taskPhase,
      taskTiming: input.taskTimingMap.get(taskRuntimeId) || input.taskTimingMap.get(task.id) || null,
      events: taskEvents,
      invocations: taskInvocations,
      isRerunning: input.rerunningIds.has(taskRuntimeId),
      isForceCompleting: input.forceCompletePendingIds.has(taskRuntimeId),
      forceCompleteError: input.forceCompleteErrorByTaskId.get(taskRuntimeId) || null,
      dispatchInfo: (latestDispatch || activeQuotaWait) ? {
        errorMessage: showDispatchError,
        startedAt: latestDispatch?.startedAt ?? null,
        finishedAt: latestDispatch?.finishedAt ?? null,
        status: latestDispatch?.status ?? null,
      } : null,
    };
  });
}

export function deriveLiveTransportBannerViewModel(args: {
  transportState: TransportState;
  isRecovering: boolean;
  error: string | null;
  snapshotUpdatedAt?: string | null;
  nowMs?: number;
}): LiveTransportBannerViewModel | null {
  if (args.error) {
    return {
      isVisible: true,
      title: "Connection Error",
      message: args.error,
      wrapperClass: "bg-status-red/10 border-status-red/20 text-status-red",
      iconClass: "text-status-red",
      icon: "error",
      isUrgent: true,
      ariaLive: "assertive",
      role: "alert",
      ariaBusy: args.isRecovering,
    };
  }

  if (args.transportState === "disconnected") {
    return {
      isVisible: true,
      title: "Disconnected",
      message: "Lost connection to the live stream. Cached runtime data remains visible while retrying.",
      wrapperClass: "bg-status-red/10 border-status-red/20 text-status-red",
      iconClass: "text-status-red",
      icon: "disconnected",
      isUrgent: true,
      ariaLive: "assertive",
      role: "alert",
      ariaBusy: args.isRecovering,
    };
  }

  if (args.transportState === "reconnecting") {
    return {
      isVisible: true,
      title: "Reconnecting",
      message: "Attempting to restore connection. Cached runtime data remains visible.",
      wrapperClass: "bg-status-amber/10 border-status-amber/20 text-status-amber",
      iconClass: "text-status-amber",
      icon: "reconnecting",
      isUrgent: false,
      ariaLive: "polite",
      role: "status",
      ariaBusy: args.isRecovering,
    };
  }

  if (args.transportState === "connected" && args.isRecovering) {
    return {
      isVisible: true,
      title: args.snapshotUpdatedAt ? "Refreshing Live Data" : "Recovering Live Data",
      message: args.snapshotUpdatedAt
        ? "Keeping the current runtime snapshot visible while the live stream catches up."
        : "Waiting for the first runtime snapshot after transport recovery.",
      wrapperClass: "bg-signal-500/10 border-signal-500/20 text-signal-700 dark:text-signal-300",
      iconClass: "text-signal-600 dark:text-signal-300",
      icon: "reconnecting",
      isUrgent: false,
      ariaLive: "polite",
      role: "status",
      ariaBusy: true,
    };
  }

  const snapshotAgeMs = args.snapshotUpdatedAt
    ? (args.nowMs ?? Date.now()) - new Date(args.snapshotUpdatedAt).getTime()
    : null;
  if (
    args.transportState === "connected"
    && snapshotAgeMs !== null
    && Number.isFinite(snapshotAgeMs)
    && snapshotAgeMs > LIVE_SNAPSHOT_STALE_MS
  ) {
    return {
      isVisible: true,
      title: "Stale Data",
      message: "Live runtime content is still visible, but the latest snapshot is more than a minute old.",
      wrapperClass: "bg-status-amber/10 border-status-amber/20 text-status-amber",
      iconClass: "text-status-amber",
      icon: "reconnecting",
      isUrgent: false,
      ariaLive: "polite",
      role: "status",
      ariaBusy: false,
    };
  }

  return null;
}

export function deriveLiveSessionSnapshotSurface(args: {
  transportState: TransportState;
  isRecovering: boolean;
  snapshotUpdatedAt?: string | null;
  transportBannerTitle?: LiveTransportBannerViewModel["title"] | null;
}): ExecutionSnapshotSurfaceState {
  if (args.transportState === "reconnecting" || args.transportState === "disconnected") {
    return {
      kind: "reconnecting",
      label: "Reconnecting",
      description: "Cached runtime snapshot remains visible while the live stream reconnects.",
      isBusy: true,
    };
  }

  if (args.isRecovering) {
    return {
      kind: "recovering",
      label: args.snapshotUpdatedAt ? "Recovering" : "Awaiting Snapshot",
      description: args.snapshotUpdatedAt
        ? "Cached runtime snapshot remains visible while fresh live data is loading."
        : "Waiting for the first runtime snapshot after transport recovery.",
      isBusy: true,
    };
  }

  if (args.transportBannerTitle === "Stale Data") {
    return {
      kind: "stale",
      label: "Stale Snapshot",
      description: "Cached runtime snapshot remains visible, but it is more than a minute old.",
      isBusy: true,
    };
  }

  return {
    kind: "live",
    label: "Live",
    description: "Runtime data is current.",
    isBusy: false,
  };
}
