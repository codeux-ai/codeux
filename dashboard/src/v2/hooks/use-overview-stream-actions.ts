import { useCallback, useMemo, useState } from "preact/hooks";
import type { ExecutionDashboardSnapshot, ExecutionSprintRunSummary } from "../../types.js";
import type { Task } from "../types.js";
import {
  cancelSprintRun,
  cancelTaskDispatch,
  orchestrateSprint,
  pauseSprintRun,
  rerunTask,
  resumeSprintRun,
} from "../../lib/api/dashboard-api.js";

const ACTIVE_RUN_STATUSES = new Set(["running", "queued"]);
const ACTIVE_DISPATCH_STATUSES = new Set([
  "running",
  "queued",
  "claimed",
  "dispatched",
  "in_progress",
  "active",
]);

export interface SprintStreamState {
  isActive: boolean;
  isPaused: boolean;
  primaryBusy: boolean;
  pauseResumeBusy: boolean;
  canPauseResume: boolean;
}

export interface TaskStreamState {
  isRunning: boolean;
  busy: boolean;
}

export interface OverviewStreamActions {
  getSprintState: (sprintId: string) => SprintStreamState;
  startStopSprint: (sprintId: string) => void;
  pauseResumeSprint: (sprintId: string) => void;
  getTaskState: (task: Task) => TaskStreamState;
  playStopTask: (task: Task) => void;
}

/**
 * Wires the overview "Active Streams" list to the real sprint/task run APIs.
 * Sprint run + task dispatch state is read from the execution snapshot; in-flight
 * actions are tracked so buttons can disable + show spinners. Realtime/poll updates
 * to the execution snapshot reconcile the optimistic UI.
 */
export function useOverviewStreamActions(
  projectId: string | null,
  execution: ExecutionDashboardSnapshot | undefined,
): OverviewStreamActions {
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  const run = useCallback(async (id: string, fn: () => Promise<void>) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await fn();
    } catch (error) {
      console.error("Overview stream action failed", error);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const runsBySprintId = useMemo(() => {
    const active = new Map<string, ExecutionSprintRunSummary>();
    const pauseResume = new Map<string, ExecutionSprintRunSummary>();
    for (const sprintRun of execution?.sprintRuns ?? []) {
      if (ACTIVE_RUN_STATUSES.has(sprintRun.status) && !active.has(sprintRun.sprintId)) {
        active.set(sprintRun.sprintId, sprintRun);
      }
      if (
        (sprintRun.status === "running" || sprintRun.status === "paused")
        && !pauseResume.has(sprintRun.sprintId)
      ) {
        pauseResume.set(sprintRun.sprintId, sprintRun);
      }
    }
    return { active, pauseResume };
  }, [execution?.sprintRuns]);

  const activeDispatchByRecordId = useMemo(() => {
    const map = new Map<string, string>();
    for (const dispatch of execution?.taskDispatches ?? []) {
      if (dispatch.taskId && ACTIVE_DISPATCH_STATUSES.has(dispatch.status) && !map.has(dispatch.taskId)) {
        map.set(dispatch.taskId, dispatch.id);
      }
    }
    return map;
  }, [execution?.taskDispatches]);

  const getSprintState = useCallback((sprintId: string): SprintStreamState => {
    const activeRun = runsBySprintId.active.get(sprintId);
    const pauseRun = runsBySprintId.pauseResume.get(sprintId);
    return {
      isActive: Boolean(activeRun),
      isPaused: pauseRun?.status === "paused",
      primaryBusy:
        pendingIds.has(`sprint-start:${sprintId}`)
        || (activeRun ? pendingIds.has(`sprint-stop:${activeRun.id}`) : false),
      pauseResumeBusy: pauseRun
        ? pendingIds.has(`sprint-pause:${pauseRun.id}`) || pendingIds.has(`sprint-resume:${pauseRun.id}`)
        : false,
      canPauseResume: Boolean(pauseRun),
    };
  }, [pendingIds, runsBySprintId]);

  const startStopSprint = useCallback((sprintId: string) => {
    if (!projectId) {
      return;
    }
    const activeRun = runsBySprintId.active.get(sprintId);
    if (activeRun) {
      const id = `sprint-stop:${activeRun.id}`;
      if (pendingIds.has(id)) {
        return;
      }
      void run(id, () => cancelSprintRun(activeRun.id));
      return;
    }
    const id = `sprint-start:${sprintId}`;
    if (pendingIds.has(id)) {
      return;
    }
    void run(id, () => orchestrateSprint(projectId, sprintId));
  }, [pendingIds, projectId, run, runsBySprintId]);

  const pauseResumeSprint = useCallback((sprintId: string) => {
    const pauseRun = runsBySprintId.pauseResume.get(sprintId);
    if (!pauseRun) {
      return;
    }
    if (pauseRun.status === "paused") {
      const id = `sprint-resume:${pauseRun.id}`;
      if (pendingIds.has(id)) {
        return;
      }
      void run(id, () => resumeSprintRun(pauseRun.id));
      return;
    }
    const id = `sprint-pause:${pauseRun.id}`;
    if (pendingIds.has(id)) {
      return;
    }
    void run(id, () => pauseSprintRun(pauseRun.id));
  }, [pendingIds, run, runsBySprintId]);

  const getTaskState = useCallback((task: Task): TaskStreamState => ({
    isRunning: activeDispatchByRecordId.has(task.recordId),
    busy: pendingIds.has(`task:${task.recordId}`),
  }), [activeDispatchByRecordId, pendingIds]);

  const playStopTask = useCallback((task: Task) => {
    const id = `task:${task.recordId}`;
    if (pendingIds.has(id)) {
      return;
    }
    const dispatchId = activeDispatchByRecordId.get(task.recordId);
    if (dispatchId) {
      void run(id, () => cancelTaskDispatch(dispatchId));
      return;
    }
    void run(id, () => rerunTask(task.recordId));
  }, [activeDispatchByRecordId, pendingIds, run]);

  return useMemo(() => ({
    getSprintState,
    startStopSprint,
    pauseResumeSprint,
    getTaskState,
    playStopTask,
  }), [getSprintState, startStopSprint, pauseResumeSprint, getTaskState, playStopTask]);
}
