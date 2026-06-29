import type { DashboardStatus, ExecutionDashboardSnapshot, Subtask } from "../types.js";

const ACTIVE_SPRINT_RUN_STATUSES = new Set([
  "queued",
  "running",
  "paused",
  "cancel_requested",
]);

const ACTIVE_TASK_DISPATCH_STATUSES = new Set([
  "queued",
  "claimed",
  "running",
  "blocked",
  "cancel_requested",
]);

const ACTIVE_ATTENTION_STATUSES = new Set([
  "open",
  "claimed",
]);

function normalizeValue(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function resolveTaskIdentity(task: Subtask): string | null {
  return normalizeValue(task.record_id) ?? normalizeValue(task.id);
}

function mergeMissingTaskRuntimeMetadata(
  previous: DashboardStatus,
  next: DashboardStatus,
): DashboardStatus {
  const previousById = new Map<string, Subtask>();

  for (const task of previous.subtasks) {
    const identity = resolveTaskIdentity(task);
    if (identity) {
      previousById.set(identity, task);
    }
  }

  let changed = false;
  const subtasks = next.subtasks.map((task) => {
    const identity = resolveTaskIdentity(task);
    const previousTask = identity ? previousById.get(identity) : null;
    if (!previousTask) {
      return task;
    }

    const sessionId = normalizeValue(task.session_id) ?? normalizeValue(previousTask.session_id) ?? undefined;
    const sessionName = normalizeValue(task.session_name) ?? normalizeValue(previousTask.session_name) ?? undefined;
    const sessionState = normalizeValue(task.session_state) ?? normalizeValue(previousTask.session_state) ?? undefined;
    const workerBranch = normalizeValue(task.worker_branch) ?? normalizeValue(previousTask.worker_branch) ?? undefined;
    const prUrl = normalizeValue(task.pr_url) ?? normalizeValue(previousTask.pr_url) ?? undefined;
    const provider = task.provider ?? previousTask.provider;

    if (
      sessionId === task.session_id
      && sessionName === task.session_name
      && sessionState === task.session_state
      && workerBranch === task.worker_branch
      && prUrl === task.pr_url
      && provider === task.provider
    ) {
      return task;
    }

    changed = true;
    return {
      ...task,
      session_id: sessionId,
      session_name: sessionName,
      session_state: sessionState,
      provider,
      worker_branch: workerBranch,
      pr_url: prUrl,
    };
  });

  return changed ? { ...next, subtasks } : next;
}

function isEmptyExecutionSnapshot(snapshot: ExecutionDashboardSnapshot): boolean {
  return (
    snapshot.projectId === null
    && snapshot.projectName === null
    && snapshot.updatedAt === null
    && snapshot.sprintRuns.length === 0
    && snapshot.taskDispatches.length === 0
    && snapshot.connections.length === 0
    && snapshot.primaryAssignedWorker === null
    && snapshot.overflowAssignedWorkers.length === 0
    && snapshot.attentionItems.length === 0
    && snapshot.recentEvents.length === 0
    && (snapshot.recentInvocations?.length ?? 0) === 0
  );
}

export function hasActiveExecutionSnapshot(snapshot: ExecutionDashboardSnapshot): boolean {
  return (
    snapshot.sprintRuns.some((run) => ACTIVE_SPRINT_RUN_STATUSES.has(run.status))
    || snapshot.taskDispatches.some((dispatch) => ACTIVE_TASK_DISPATCH_STATUSES.has(dispatch.status))
    || snapshot.attentionItems.some((item) => ACTIVE_ATTENTION_STATUSES.has(item.status))
  );
}

type SprintRun = ExecutionDashboardSnapshot["sprintRuns"][number];
type TaskDispatch = ExecutionDashboardSnapshot["taskDispatches"][number];
type Connection = ExecutionDashboardSnapshot["connections"][number];
type AttentionItem = ExecutionDashboardSnapshot["attentionItems"][number];
type RecentEvent = ExecutionDashboardSnapshot["recentEvents"][number];
type RecentInvocation = NonNullable<ExecutionDashboardSnapshot["recentInvocations"]>[number];

const isSprintRunEquivalent = (left: SprintRun, right: SprintRun): boolean => (
  leftDefined(left, right)
  && left.id === right.id
  && left.status === right.status
  && left.lastHeartbeatAt === right.lastHeartbeatAt
  && left.finishedAt === right.finishedAt
  && left.humanIntervention?.title === right.humanIntervention?.title
  && left.humanIntervention?.reason === right.humanIntervention?.reason
  && left.humanIntervention?.instructions === right.humanIntervention?.instructions
);

const isTaskDispatchEquivalent = (left: TaskDispatch, right: TaskDispatch): boolean => (
  leftDefined(left, right)
  && left.id === right.id
  && left.status === right.status
  && left.taskRunState === right.taskRunState
  && left.lastHeartbeatAt === right.lastHeartbeatAt
  && left.finishedAt === right.finishedAt
  && left.errorMessage === right.errorMessage
  && left.sessionId === right.sessionId
  && left.provider === right.provider
  && left.prUrl === right.prUrl
  && left.workerBranch === right.workerBranch
);

const isConnectionEquivalent = (left: Connection, right: Connection): boolean => (
  leftDefined(left, right)
  && left.id === right.id
  && left.status === right.status
  && left.lastHeartbeatAt === right.lastHeartbeatAt
  && left.pendingInboxCount === right.pendingInboxCount
  && left.activeDispatchCount === right.activeDispatchCount
);

const isAttentionItemEquivalent = (left: AttentionItem, right: AttentionItem): boolean => (
  leftDefined(left, right)
  && left.id === right.id
  && left.status === right.status
  && left.updatedAt === right.updatedAt
);

const isRecentEventEquivalent = (left: RecentEvent, right: RecentEvent): boolean => (
  left?.id === right?.id
  && left?.createdAt === right?.createdAt
  && left?.eventType === right?.eventType
);

const isRecentInvocationEquivalent = (left: RecentInvocation, right: RecentInvocation): boolean => (
  left?.id === right?.id
  && left?.status === right?.status
  && left?.updatedAt === right?.updatedAt
  && left?.messageCount === right?.messageCount
  && left?.lastMessageAt === right?.lastMessageAt
);

function leftDefined<T>(left: T, right: T): boolean {
  return left != null && right != null;
}

function areListsEquivalent<T>(
  left: readonly T[],
  right: readonly T[],
  isItemEquivalent: (a: T, b: T) => boolean,
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!isItemEquivalent(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

/**
 * Returns `previous` when it is element-wise equivalent to `next`, so that
 * unchanged sub-collections keep a stable reference. This is what stops the
 * high-frequency live invocation feed (`recentEvents`) from invalidating
 * `useMemo`s keyed on unrelated fields like `sprintRuns`.
 */
function stabilizeList<T>(
  previous: readonly T[],
  next: T[],
  isItemEquivalent: (a: T, b: T) => boolean,
): T[] {
  return areListsEquivalent(previous, next, isItemEquivalent) ? (previous as T[]) : next;
}

export function areExecutionSnapshotsEquivalent(
  left: ExecutionDashboardSnapshot,
  right: ExecutionDashboardSnapshot,
): boolean {
  return (
    left.projectId === right.projectId
    && left.projectName === right.projectName
    && areListsEquivalent(left.sprintRuns, right.sprintRuns, isSprintRunEquivalent)
    && areListsEquivalent(left.taskDispatches, right.taskDispatches, isTaskDispatchEquivalent)
    && areListsEquivalent(left.connections, right.connections, isConnectionEquivalent)
    && areListsEquivalent(left.attentionItems, right.attentionItems, isAttentionItemEquivalent)
    && areListsEquivalent(left.recentEvents, right.recentEvents, isRecentEventEquivalent)
    && areListsEquivalent(left.recentInvocations ?? [], right.recentInvocations ?? [], isRecentInvocationEquivalent)
    && left.primaryAssignedWorker?.workerEndpointId === right.primaryAssignedWorker?.workerEndpointId
    && left.overflowAssignedWorkers.length === right.overflowAssignedWorkers.length
  );
}

export function stabilizeExecutionSnapshot(
  previous: ExecutionDashboardSnapshot,
  next: ExecutionDashboardSnapshot,
): ExecutionDashboardSnapshot {
  if (previous === next) {
    return next;
  }

  const previousProjectId = normalizeValue(previous.projectId);
  const nextProjectId = normalizeValue(next.projectId);
  if (previousProjectId && nextProjectId && previousProjectId !== nextProjectId) {
    return next;
  }

  if (hasActiveExecutionSnapshot(previous) && isEmptyExecutionSnapshot(next)) {
    return previous;
  }

  // Reuse stable references for sub-collections that have not semantically
  // changed. The live invocation feed mutates `recentEvents`/`recentInvocations`
  // up to several times per second; without this, every such update would hand
  // a brand-new `sprintRuns`/`connections` array to consumers and re-render the
  // entire sprint ledger even though nothing relevant to it changed.
  const result = { ...next };
  let changed = false;

  const reuse = <K extends keyof ExecutionDashboardSnapshot>(
    key: K,
    stabilized: ExecutionDashboardSnapshot[K],
  ): void => {
    if (stabilized !== next[key]) {
      result[key] = stabilized;
      changed = true;
    }
  };

  reuse("sprintRuns", stabilizeList(previous.sprintRuns, next.sprintRuns, isSprintRunEquivalent));
  reuse("taskDispatches", stabilizeList(previous.taskDispatches, next.taskDispatches, isTaskDispatchEquivalent));
  reuse("connections", stabilizeList(previous.connections, next.connections, isConnectionEquivalent));
  reuse("attentionItems", stabilizeList(previous.attentionItems, next.attentionItems, isAttentionItemEquivalent));
  reuse("recentEvents", stabilizeList(previous.recentEvents, next.recentEvents, isRecentEventEquivalent));
  if (next.recentInvocations) {
    reuse(
      "recentInvocations",
      stabilizeList(previous.recentInvocations ?? [], next.recentInvocations, isRecentInvocationEquivalent),
    );
  }

  return changed ? result : next;
}

export function stabilizeStatusSnapshot(
  previous: DashboardStatus,
  next: DashboardStatus,
  execution: ExecutionDashboardSnapshot,
): DashboardStatus {
  if (previous.subtasks.length === 0 || !hasActiveExecutionSnapshot(execution)) {
    return next;
  }

  const previousProjectId = normalizeValue(previous.project_id) ?? normalizeValue(previous.subtasks[0]?.project_id);
  const nextProjectId = normalizeValue(next.project_id) ?? normalizeValue(execution.projectId);
  if (previousProjectId && nextProjectId && previousProjectId !== nextProjectId) {
    return next;
  }

  const previousSprintId = normalizeValue(previous.sprint_id) ?? normalizeValue(previous.subtasks[0]?.sprint_id);
  const nextSprintId = normalizeValue(next.sprint_id);
  if (previousSprintId && nextSprintId && previousSprintId !== nextSprintId) {
    return next;
  }

  if (next.subtasks.length === 0) {
    return previous;
  }

  return mergeMissingTaskRuntimeMetadata(previous, next);
}
