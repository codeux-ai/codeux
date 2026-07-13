import type { TransportState } from "../../lib/realtime/dashboard-realtime-client.js";
import type { ExecutionSnapshotSurfaceState } from "../../hooks/ExecutionTimelineContext.js";
import type {
  DashboardStats,
  ExecutionAttentionItemSummary,
  ExecutionDashboardSnapshot,
  ExecutionInvocationRecord,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  ProviderId,
  Subtask,
} from "../../types.js";
import {
  getLiveTaskProgressPhase,
  getTaskProgressPhase,
  type TaskProgressPhase,
} from "../../lib/task-progress.js";
import type { LiveTaskTimingSummary } from "./live-stats.js";
import {
  findActiveQuotaWait,
  findLatestTerminalTaskSignal,
  isActiveCiAttentionItem,
  isCiGateRuntimeEvent,
} from "./live-task-runtime.js";
import { deriveLiveDurationDisplay } from "./live-duration-display.js";
import {
  deriveTaskCiStatusPresentation,
  type CiStatusPresentation,
} from "./ci-status-presentation.js";

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
  attentionItems: ExecutionAttentionItemSummary[];
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
  ciPresentation: CiStatusPresentation | null;
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
  attentionItems?: ExecutionAttentionItemSummary[];
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

function normalizeString(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
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

function taskScopeMatchesRuntime(
  task: Subtask,
  runtime: Pick<ExecutionTaskDispatchSummary | ExecutionRuntimeEventSummary, "projectId" | "sprintId">,
): boolean {
  if (task.project_id && runtime.projectId !== task.project_id) {
    return false;
  }
  if (task.sprint_id && runtime.sprintId !== task.sprint_id) {
    return false;
  }
  return true;
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

function isDispatchMoreRecent(
  candidate: ExecutionTaskDispatchSummary,
  current: ExecutionTaskDispatchSummary | null,
): boolean {
  if (!current) {
    return true;
  }
  return compareIsoAsc(getDispatchRecency(candidate), getDispatchRecency(current)) >= 0;
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
      attentionItems: [],
    };
  }

  const invocations = execution.recentInvocations ?? [];
  if (!sprintScopeId) {
    return {
      dispatches: execution.taskDispatches,
      events: execution.recentEvents,
      sprintRuns: execution.sprintRuns,
      invocations,
      attentionItems: execution.attentionItems,
    };
  }

  return {
    dispatches: execution.taskDispatches.filter((dispatch) => dispatch.sprintId === sprintScopeId),
    events: execution.recentEvents.filter((event) => event.sprintId === sprintScopeId),
    sprintRuns: execution.sprintRuns.filter((run) => run.sprintId === sprintScopeId),
    invocations: invocations.filter((invocation) => invocation.sprintId === sprintScopeId),
    attentionItems: execution.attentionItems.filter((item) => item.sprintId === sprintScopeId),
  };
}

interface LiveSessionTaskRuntimeBucket {
  task: Subtask;
  taskRuntimeId: string;
  recordId: string | null;
  latestDispatch: ExecutionTaskDispatchSummary | null;
  eventsByTaskRunId: ExecutionRuntimeEventSummary[];
  eventsByDispatchId: ExecutionRuntimeEventSummary[];
  eventsByRecordId: ExecutionRuntimeEventSummary[];
  eventsByTaskKey: ExecutionRuntimeEventSummary[];
  events: ExecutionRuntimeEventSummary[];
  currentDispatchEvents: ExecutionRuntimeEventSummary[];
  ciEvents: ExecutionRuntimeEventSummary[];
  ciAttentionItems: ExecutionAttentionItemSummary[];
  invocations: ExecutionInvocationRecord[];
  invocationIds: Set<string>;
}

interface LiveSessionTaskRuntimeIndex {
  byTaskRuntimeId: Map<string, LiveSessionTaskRuntimeBucket>;
}

function createLiveSessionTaskRuntimeBucket(task: Subtask): LiveSessionTaskRuntimeBucket {
  return {
    task,
    taskRuntimeId: task.record_id || task.id,
    recordId: normalizeString(task.record_id),
    latestDispatch: null,
    eventsByTaskRunId: [],
    eventsByDispatchId: [],
    eventsByRecordId: [],
    eventsByTaskKey: [],
    events: [],
    currentDispatchEvents: [],
    ciEvents: [],
    ciAttentionItems: [],
    invocations: [],
    invocationIds: new Set(),
  };
}

function addUniqueIndexEntry<K>(
  index: Map<K, LiveSessionTaskRuntimeBucket[]>,
  key: K | null | undefined,
  bucket: LiveSessionTaskRuntimeBucket,
): void {
  if (!key) {
    return;
  }
  const list = index.get(key) ?? [];
  if (!list.includes(bucket)) {
    list.push(bucket);
    index.set(key, list);
  }
}

function getScopedBuckets(
  buckets: LiveSessionTaskRuntimeBucket[] | undefined,
  runtime: Pick<ExecutionTaskDispatchSummary | ExecutionRuntimeEventSummary, "projectId" | "sprintId">,
): LiveSessionTaskRuntimeBucket[] {
  if (!buckets || buckets.length === 0) {
    return [];
  }
  return buckets.filter((bucket) => taskScopeMatchesRuntime(bucket.task, runtime));
}

function sortRuntimeEvents(events: ExecutionRuntimeEventSummary[]): ExecutionRuntimeEventSummary[] {
  const deduped = new Map<string, ExecutionRuntimeEventSummary>();
  for (const event of events) {
    deduped.set(event.id, event);
  }
  return [...deduped.values()].sort((left, right) => compareIsoAsc(left.createdAt, right.createdAt));
}

function selectTaskEvents(bucket: LiveSessionTaskRuntimeBucket): ExecutionRuntimeEventSummary[] {
  if (bucket.latestDispatch?.taskRunId && bucket.eventsByTaskRunId.length > 0) {
    return sortRuntimeEvents(bucket.eventsByTaskRunId);
  }

  if (bucket.latestDispatch?.id && bucket.eventsByDispatchId.length > 0) {
    return sortRuntimeEvents(bucket.eventsByDispatchId);
  }

  if (bucket.recordId) {
    return sortRuntimeEvents(bucket.eventsByRecordId);
  }

  return sortRuntimeEvents(bucket.eventsByTaskKey);
}

function buildLiveSessionTaskRuntimeIndex(args: {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  invocations: ExecutionInvocationRecord[];
  attentionItems?: ExecutionAttentionItemSummary[];
}): LiveSessionTaskRuntimeIndex {
  const byTaskRuntimeId = new Map<string, LiveSessionTaskRuntimeBucket>();
  const buckets: LiveSessionTaskRuntimeBucket[] = args.tasks.map(createLiveSessionTaskRuntimeBucket);
  const bucketsByRecordId = new Map<string, LiveSessionTaskRuntimeBucket[]>();
  const bucketsByTaskKey = new Map<string, LiveSessionTaskRuntimeBucket[]>();
  const invocationBucketsByIdentity = new Map<string, LiveSessionTaskRuntimeBucket[]>();

  for (const bucket of buckets) {
    byTaskRuntimeId.set(bucket.taskRuntimeId, bucket);
    if (bucket.recordId) {
      addUniqueIndexEntry(bucketsByRecordId, bucket.recordId, bucket);
    }
    addUniqueIndexEntry(bucketsByTaskKey, bucket.task.id, bucket);

    addUniqueIndexEntry(invocationBucketsByIdentity, bucket.taskRuntimeId, bucket);
    addUniqueIndexEntry(invocationBucketsByIdentity, bucket.task.id, bucket);
    addUniqueIndexEntry(invocationBucketsByIdentity, bucket.task.record_id, bucket);
  }

  for (const dispatch of args.dispatches) {
    const matchingBuckets = [
      ...getScopedBuckets(bucketsByRecordId.get(dispatch.taskId ?? ""), dispatch),
      ...getScopedBuckets(bucketsByTaskKey.get(dispatch.taskKey ?? ""), dispatch),
    ];
    for (const bucket of matchingBuckets) {
      if (isDispatchMoreRecent(dispatch, bucket.latestDispatch)) {
        bucket.latestDispatch = dispatch;
      }
    }
  }

  const bucketsByLatestDispatchId = new Map<string, LiveSessionTaskRuntimeBucket[]>();
  const bucketsByLatestTaskRunId = new Map<string, LiveSessionTaskRuntimeBucket[]>();
  for (const bucket of buckets) {
    addUniqueIndexEntry(bucketsByLatestDispatchId, bucket.latestDispatch?.id, bucket);
    addUniqueIndexEntry(bucketsByLatestTaskRunId, bucket.latestDispatch?.taskRunId, bucket);
  }

  for (const event of args.events) {
    const matchingEventBuckets = new Set<LiveSessionTaskRuntimeBucket>();
    for (const bucket of getScopedBuckets(bucketsByLatestTaskRunId.get(event.taskRunId ?? ""), event)) {
      bucket.eventsByTaskRunId.push(event);
      bucket.currentDispatchEvents.push(event);
      matchingEventBuckets.add(bucket);
    }
    for (const bucket of getScopedBuckets(bucketsByLatestDispatchId.get(event.dispatchId ?? ""), event)) {
      bucket.eventsByDispatchId.push(event);
      bucket.currentDispatchEvents.push(event);
      matchingEventBuckets.add(bucket);
    }
    for (const bucket of getScopedBuckets(bucketsByRecordId.get(event.taskId ?? ""), event)) {
      bucket.eventsByRecordId.push(event);
      matchingEventBuckets.add(bucket);
    }
    for (const bucket of getScopedBuckets(bucketsByTaskKey.get(event.taskKey ?? ""), event)) {
      bucket.eventsByTaskKey.push(event);
      matchingEventBuckets.add(bucket);
    }
    if (isCiGateRuntimeEvent(event)) {
      for (const bucket of matchingEventBuckets) {
        bucket.ciEvents.push(event);
      }
    }
  }

  for (const attentionItem of args.attentionItems ?? []) {
    if (!isActiveCiAttentionItem(attentionItem)) {
      continue;
    }
    const payloadTaskId = normalizeString(
      typeof attentionItem.payload?.taskId === "string"
        ? attentionItem.payload.taskId
        : typeof attentionItem.payload?.taskKey === "string"
          ? attentionItem.payload.taskKey
          : null,
    );
    const matchingBuckets = new Set([
      ...(bucketsByRecordId.get(attentionItem.taskId ?? "") ?? []),
      ...(bucketsByTaskKey.get(attentionItem.taskId ?? "") ?? []),
      ...(bucketsByRecordId.get(payloadTaskId ?? "") ?? []),
      ...(bucketsByTaskKey.get(payloadTaskId ?? "") ?? []),
    ]);
    for (const bucket of matchingBuckets) {
      if (!bucket.task.sprint_id || attentionItem.sprintId === bucket.task.sprint_id) {
        bucket.ciAttentionItems.push(attentionItem);
      }
    }
  }

  const invocationBucketsByDispatchId = new Map<string, LiveSessionTaskRuntimeBucket[]>();
  const invocationBucketsByTaskRunId = new Map<string, LiveSessionTaskRuntimeBucket[]>();
  for (const bucket of buckets) {
    addUniqueIndexEntry(invocationBucketsByDispatchId, bucket.latestDispatch?.id, bucket);
    addUniqueIndexEntry(invocationBucketsByTaskRunId, bucket.latestDispatch?.taskRunId, bucket);
  }

  for (const invocation of args.invocations) {
    const matchingBuckets = new Set<LiveSessionTaskRuntimeBucket>();
    for (const bucket of invocationBucketsByIdentity.get(invocation.taskId ?? "") ?? []) {
      matchingBuckets.add(bucket);
    }
    for (const bucket of invocationBucketsByIdentity.get(invocation.taskKey ?? "") ?? []) {
      matchingBuckets.add(bucket);
    }
    for (const bucket of invocationBucketsByDispatchId.get(invocation.dispatchId ?? "") ?? []) {
      matchingBuckets.add(bucket);
    }
    for (const bucket of invocationBucketsByTaskRunId.get(invocation.taskRunId ?? "") ?? []) {
      matchingBuckets.add(bucket);
    }

    for (const bucket of matchingBuckets) {
      if (!bucket.invocationIds.has(invocation.id)) {
        bucket.invocationIds.add(invocation.id);
        bucket.invocations.push(invocation);
      }
    }
  }

  for (const bucket of buckets) {
    bucket.events = selectTaskEvents(bucket);
    bucket.currentDispatchEvents = bucket.latestDispatch
      ? sortRuntimeEvents(bucket.events.filter((event) => (
        (bucket.latestDispatch?.taskRunId && event.taskRunId === bucket.latestDispatch.taskRunId)
        || (bucket.latestDispatch?.id && event.dispatchId === bucket.latestDispatch.id)
      )))
      : [];
    bucket.ciEvents = sortRuntimeEvents(bucket.ciEvents);
  }

  return { byTaskRuntimeId };
}

export function deriveProjectedLiveSessionTasks(
  tasks: Subtask[],
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): Subtask[] {
  const taskRuntimeIndex = buildLiveSessionTaskRuntimeIndex({
    tasks,
    dispatches,
    events,
    invocations: [],
  });

  return tasks.map((task) => {
    const bucket = taskRuntimeIndex.byTaskRuntimeId.get(task.record_id || task.id);
    const dispatch = bucket?.latestDispatch ?? null;
    const taskEvents = bucket?.events ?? EMPTY_RUNTIME_EVENTS;
    const terminalSignal = findLatestTerminalTaskSignal(taskEvents);

    return {
      ...task,
      status: getLiveTaskProgressPhase({
        task,
        dispatch,
        runtimeTerminalPhase: terminalSignal?.phase ?? null,
        runtimeMergeSettled: terminalSignal?.mergeSettled === true,
        events: taskEvents,
      }) as Subtask["status"],
      session_id: normalizeString(dispatch?.sessionId) || normalizeString(task.session_id) || undefined,
      session_name: normalizeString(dispatch?.sessionName) || normalizeString(task.session_name) || undefined,
      session_state: normalizeString(dispatch?.taskRunState) || normalizeString(task.session_state) || undefined,
      provider: normalizeProvider(dispatch?.provider) || task.provider,
      worker_branch: normalizeString(dispatch?.workerBranch) || normalizeString(task.worker_branch) || undefined,
      pr_url: normalizeString(dispatch?.prUrl) || normalizeString(task.pr_url) || undefined,
    };
  });
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

export function deriveLiveSessionTaskCardItems(input: LiveSessionTaskCardStateInput): LiveSessionTaskCardItem[] {
  const taskRuntimeIndex = buildLiveSessionTaskRuntimeIndex({
    tasks: input.filteredTasks,
    dispatches: input.dispatches,
    events: input.events,
    invocations: input.invocations,
    attentionItems: input.attentionItems,
  });

  return input.filteredTasks.map((task) => {
    const taskRuntimeId = task.record_id || task.id;
    const bucket = taskRuntimeIndex.byTaskRuntimeId.get(taskRuntimeId);
    const isOptimisticallyCompleted = input.optimisticallyCompletedTaskIds.has(taskRuntimeId);
    const optimisticTask: Subtask = isOptimisticallyCompleted
      ? { ...task, status: "COMPLETED" }
      : task;
    const latestDispatch = bucket?.latestDispatch ?? null;
    const taskEvents = bucket?.events ?? EMPTY_RUNTIME_EVENTS;
    const taskInvocations = bucket?.invocations ?? [];
    const dispatchPhase = isOptimisticallyCompleted
      ? "COMPLETED"
      : getLiveTaskProgressPhase({ task: optimisticTask, dispatch: latestDispatch, events: taskEvents });
    const currentDispatchEvents = latestDispatch ? bucket?.currentDispatchEvents ?? EMPTY_RUNTIME_EVENTS : EMPTY_RUNTIME_EVENTS;
    const activeQuotaWait = ["FAILED", "BLOCKED", "QUOTA", "COMPLETED"].includes(dispatchPhase)
      ? null
      : findActiveQuotaWait(currentDispatchEvents);
    const taskPhase = activeQuotaWait ? "QUOTA" : dispatchPhase;
    const showDispatchError = activeQuotaWait
      ? `Provider quota exhausted — waiting for reset. [RETRY_AFTER:${activeQuotaWait.retryAfterIso}]`
      : latestDispatch && ["FAILED", "BLOCKED", "QUOTA"].includes(taskPhase)
        ? latestDispatch.errorMessage
        : null;
    const ciEvents = bucket?.ciEvents ?? EMPTY_RUNTIME_EVENTS;
    const ciAttentionItems = bucket?.ciAttentionItems ?? [];
    const ciPresentation = deriveTaskCiStatusPresentation({
      task: optimisticTask,
      events: ciEvents,
      attentionItems: ciAttentionItems,
      sprintRunId: latestDispatch?.sprintRunId ?? null,
    });

    return {
      key: taskRuntimeId,
      task: optimisticTask,
      phase: taskPhase,
      taskTiming: input.taskTimingMap.get(taskRuntimeId) || input.taskTimingMap.get(task.id) || null,
      events: taskEvents,
      invocations: taskInvocations,
      ciPresentation,
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
  error?: string | null;
}): ExecutionSnapshotSurfaceState {
  if (args.transportState === "reconnecting" || args.transportState === "disconnected") {
    return {
      kind: "reconnecting",
      label: "Reconnecting",
      description: "Cached runtime snapshot remains visible while the live stream reconnects.",
      isBusy: true,
    };
  }

  if (args.error) {
    return {
      kind: "recovering",
      label: "Retrying Load",
      description: "Cached runtime snapshot remains visible while the failed live data request can be retried.",
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
