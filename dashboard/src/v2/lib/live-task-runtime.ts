import type {
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import { getLiveTaskProgressPhase } from "../../lib/task-progress.js";
import { LiveRuntimeProjection, normalizeString, normalizeProvider, findLatestTerminalTaskSignal } from "./live-runtime-history.js";

export { LiveRuntimeProjection, type IndexedExecutionHistory } from "./live-runtime-history.js";
export { findLatestTerminalTaskSignal } from "./live-runtime-history.js";

// Keep backward compatibility for tests depending on buildIndexedExecutionHistory
export function pickLatestTaskDispatch(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
): ExecutionTaskDispatchSummary | null {
  const proj = new LiveRuntimeProjection(dispatches, []);
  return proj.pickLatestTaskDispatch(task);
}

export function getTaskEventsForLiveTask(
  task: Subtask,
  dispatch: ExecutionTaskDispatchSummary | null,
  events: ExecutionRuntimeEventSummary[],
): ExecutionRuntimeEventSummary[] {
  const proj = new LiveRuntimeProjection([], events);
  return proj.getTaskEventsForLiveTask(task, dispatch);
}

export function buildIndexedExecutionHistory(
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): import("./live-runtime-history.js").IndexedExecutionHistory {
  const projection = new LiveRuntimeProjection(dispatches, events);
  return (projection as any).index;
}

export function projectLiveTask(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
  projection?: LiveRuntimeProjection,
): Subtask {
  const proj = projection ?? new LiveRuntimeProjection(dispatches, events);
  const runtime = proj.getTaskRuntime(task);

  return {
    ...task,
    status: getLiveTaskProgressPhase({
      task,
      dispatch: runtime.dispatch,
      runtimeTerminalPhase: runtime.terminalSignal?.phase ?? null,
      runtimeMergeSettled: runtime.terminalSignal?.mergeSettled === true,
    }),
    session_id: normalizeString(runtime.dispatch?.sessionId) || normalizeString(task.session_id) || undefined,
    session_name: normalizeString(runtime.dispatch?.sessionName) || normalizeString(task.session_name) || undefined,
    session_state: normalizeString(runtime.dispatch?.taskRunState) || normalizeString(task.session_state) || undefined,
    provider: normalizeProvider(runtime.dispatch?.provider) || task.provider,
    worker_branch: normalizeString(runtime.dispatch?.workerBranch) || normalizeString(task.worker_branch) || undefined,
    pr_url: normalizeString(runtime.dispatch?.prUrl) || normalizeString(task.pr_url) || undefined,
  };
}
