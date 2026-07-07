import type {
  ExecutionConnectionSummary,
  ExecutionDashboardSnapshot,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
} from "../../../types.js";

export interface ExecutionRuntimeViewModel {
  activeSprintRuns: ExecutionSprintRunSummary[];
  activeDispatches: ExecutionTaskDispatchSummary[];
  activeConnections: ExecutionConnectionSummary[];
  pendingInboxTotal: number;
  queuedWorkers: number;
  runningWorkers: number;
  visibleSprintRuns: ExecutionSprintRunSummary[];
  visibleTaskDispatches: ExecutionTaskDispatchSummary[];
  blockedAttentionCount: number;
  failedTaskCount: number;
  dispatchEventsByDispatchId: Map<string, ExecutionRuntimeEventSummary[]>;
  runtimeSummary: string;
}

const ACTIVE_SPRINT_RUN_STATUSES = new Set(["running", "queued"]);
const ACTIVE_DISPATCH_STATUSES = new Set(["queued", "claimed", "running"]);
const RUNNING_WORKER_DISPATCH_STATUSES = new Set(["claimed", "running"]);
const ATTENTION_STATUSES = new Set(["open", "claimed"]);

export function deriveExecutionRuntimeViewModel(snapshot: ExecutionDashboardSnapshot): ExecutionRuntimeViewModel {
  const activeSprintRuns = snapshot.sprintRuns.filter((run) => ACTIVE_SPRINT_RUN_STATUSES.has(run.status));
  const activeDispatches = snapshot.taskDispatches.filter((dispatch) => ACTIVE_DISPATCH_STATUSES.has(dispatch.status));
  const activeConnections = snapshot.connections.filter((connection) => connection.status !== "offline");
  const pendingInboxTotal = snapshot.connections.reduce((sum, connection) => sum + connection.pendingInboxCount, 0);
  let queuedWorkers = 0;
  let runningWorkers = 0;

  for (const dispatch of activeDispatches) {
    if (dispatch.executorType !== "docker_cli") {
      continue;
    }
    if (dispatch.status === "queued") {
      queuedWorkers += 1;
    } else if (RUNNING_WORKER_DISPATCH_STATUSES.has(dispatch.status)) {
      runningWorkers += 1;
    }
  }

  const blockedAttentionCount = snapshot.attentionItems.filter((item) => ATTENTION_STATUSES.has(item.status)).length;
  const failedTaskCount = snapshot.taskDispatches.filter((dispatch) => dispatch.status === "failed").length;

  return {
    activeSprintRuns,
    activeDispatches,
    activeConnections,
    pendingInboxTotal,
    queuedWorkers,
    runningWorkers,
    visibleSprintRuns: snapshot.sprintRuns.slice(0, 4),
    visibleTaskDispatches: snapshot.taskDispatches.slice(0, 8),
    blockedAttentionCount,
    failedTaskCount,
    dispatchEventsByDispatchId: buildDispatchEventLookup(snapshot.taskDispatches, snapshot.recentEvents),
    runtimeSummary: `${activeSprintRuns.length} active run${activeSprintRuns.length === 1 ? "" : "s"}, ${activeDispatches.length} active dispatch${activeDispatches.length === 1 ? "" : "es"}, ${blockedAttentionCount} attention item${blockedAttentionCount === 1 ? "" : "s"}, ${failedTaskCount} failed dispatch${failedTaskCount === 1 ? "" : "es"}.`,
  };
}

function buildDispatchEventLookup(
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): Map<string, ExecutionRuntimeEventSummary[]> {
  const dispatchEventsByDispatchId = new Map<string, ExecutionRuntimeEventSummary[]>();
  const dispatchIdsByTaskRunId = new Map<string, string[]>();

  for (const dispatch of dispatches) {
    dispatchEventsByDispatchId.set(dispatch.id, []);
    if (!dispatch.taskRunId) {
      continue;
    }
    const dispatchIds = dispatchIdsByTaskRunId.get(dispatch.taskRunId) ?? [];
    dispatchIds.push(dispatch.id);
    dispatchIdsByTaskRunId.set(dispatch.taskRunId, dispatchIds);
  }

  for (const event of events) {
    const addedDispatchIds = new Set<string>();
    if (event.dispatchId && dispatchEventsByDispatchId.has(event.dispatchId)) {
      dispatchEventsByDispatchId.get(event.dispatchId)?.push(event);
      addedDispatchIds.add(event.dispatchId);
    }

    if (!event.taskRunId) {
      continue;
    }

    for (const dispatchId of dispatchIdsByTaskRunId.get(event.taskRunId) ?? []) {
      if (addedDispatchIds.has(dispatchId)) {
        continue;
      }
      dispatchEventsByDispatchId.get(dispatchId)?.push(event);
    }
  }

  return dispatchEventsByDispatchId;
}
