import type { DashboardStatus, ExecutionDashboardSnapshot, ExecutionSprintRunSummary } from "../../types.js";
import { getPrimaryPausedInterventionRun } from "../../lib/execution-intervention.js";

function hasStatusTaskSnapshot(status: DashboardStatus): boolean {
  return Boolean(status.sprint_id && status.timestamp && (status.subtasks?.length || 0) > 0);
}

function hasExecutionWork(snapshot: ExecutionDashboardSnapshot): boolean {
  return snapshot.taskDispatches.length > 0 || snapshot.attentionItems.length > 0;
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
    const hasSelectedSprintActivity = execution.sprintRuns.some((run) =>
      run.sprintId === selectedSprintId
      && ["running", "queued", "paused", "cancel_requested"].includes(run.status)
    );
    const hasSelectedSprintStatus = status.sprint_id === selectedSprintId
      && (Boolean(status.timestamp) || (status.subtasks?.length || 0) > 0);

    if (hasSelectedSprintActivity || hasSelectedSprintStatus || execution.sprintRuns.length === 0) {
      return selectedSprintId;
    }
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
  const candidateRuns = selectedSprintId
    ? execution.sprintRuns.filter((r) => r.sprintId === selectedSprintId)
    : execution.sprintRuns;

  const liveSprintRun = candidateRuns.find((run) => run.status === "running" || run.status === "queued") || null;
  const pausedInterventionRun = getPrimaryPausedInterventionRun(execution, selectedSprintId);
  const hasActiveSprint = Boolean(liveSprintRun);
  const hasSprintContext = Boolean(
    hasActiveSprint
    || pausedInterventionRun
    || hasStatusTaskSnapshot(status)
    || hasExecutionWork(execution)
  );

  return {
    liveSprintRun,
    pausedInterventionRun,
    hasActiveSprint,
    hasSprintContext,
  };
}
