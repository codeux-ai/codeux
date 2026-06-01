import type { DashboardStatus, ExecutionDashboardSnapshot, ExecutionSprintRunSummary } from "../../types.js";
import { getPrimaryPausedInterventionRun } from "../../lib/execution-intervention.js";

function hasStatusTaskSnapshot(status: DashboardStatus, sprintId?: string | null): boolean {
  if (sprintId) {
    return status.sprint_id === sprintId
      && Boolean(status.timestamp)
      && (status.subtasks?.length || 0) > 0;
  }
  return Boolean(status.sprint_id && status.timestamp && (status.subtasks?.length || 0) > 0);
}

function hasExecutionWork(snapshot: ExecutionDashboardSnapshot, sprintId?: string | null): boolean {
  if (!sprintId) {
    return snapshot.taskDispatches.length > 0 || snapshot.attentionItems.length > 0;
  }

  return snapshot.taskDispatches.some((dispatch) => dispatch.sprintId === sprintId)
    || snapshot.attentionItems.some((item) => item.sprintId === sprintId);
}

export interface LiveSessionRuntimeState {
  liveSprintRun: ExecutionSprintRunSummary | null;
  pausedInterventionRun: ExecutionSprintRunSummary | null;
  hasActiveSprint: boolean;
  hasSprintContext: boolean;
}

export function resolveLiveSessionSprintScopeId(
  status: DashboardStatus,
  execution: ExecutionDashboardSnapshot,
  selectedSprintId?: string | null,
): string | null {
  if (selectedSprintId) {
    return selectedSprintId;
  }

  if (typeof status.sprint_id === "string" && status.sprint_id.trim().length > 0) {
    return status.sprint_id;
  }

  const activeRun = execution.sprintRuns.find((run) => ["running", "queued", "paused", "cancel_requested"].includes(run.status))
    || execution.sprintRuns[0]
    || null;
  if (activeRun?.sprintId) {
    return activeRun.sprintId;
  }

  return selectedSprintId ?? null;
}

export function deriveLiveSessionRuntimeState(
  status: DashboardStatus,
  execution: ExecutionDashboardSnapshot,
  selectedSprintId?: string | null,
): LiveSessionRuntimeState {
  const scopeSprintId = selectedSprintId || null;
  const candidateRuns = scopeSprintId
    ? execution.sprintRuns.filter((r) => r.sprintId === scopeSprintId)
    : execution.sprintRuns;

  const liveSprintRun = candidateRuns.find((run) => run.status === "running" || run.status === "queued") || null;
  const pausedInterventionRun = getPrimaryPausedInterventionRun(execution, scopeSprintId)
    || candidateRuns.find((run) => run.status === "paused")
    || null;
  const hasActiveSprint = Boolean(liveSprintRun);
  const hasSprintContext = Boolean(
    hasActiveSprint
    || pausedInterventionRun
    || hasStatusTaskSnapshot(status, scopeSprintId)
    || hasExecutionWork(execution, scopeSprintId)
  );

  return {
    liveSprintRun,
    pausedInterventionRun,
    hasActiveSprint,
    hasSprintContext,
  };
}
