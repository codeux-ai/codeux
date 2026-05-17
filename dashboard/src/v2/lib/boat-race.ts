import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";
import { getTaskProgressPhase } from "../../lib/task-progress.js";

const BOAT_RACE_HEIGHT_PX = 800;

export interface BoatRaceCheckpoint {
  progress: number;
  label: string;
  color: string;
}

const BOAT_RACE_CHECKPOINTS: readonly BoatRaceCheckpoint[] = [
  { progress: 0.25, label: "CODING", color: "#00E0A0" },
  { progress: 0.48, label: "CODE DONE", color: "#0F9FA8" },
  { progress: 0.62, label: "CI", color: "#5dade2" },
  { progress: 0.78, label: "MERGE", color: "#FFB800" },
  { progress: 0.96, label: "COMPLETED", color: "#00AB84" },
];

export function buildBoatRaceDispatchIndex(
  dispatches: ExecutionTaskDispatchSummary[]
): Map<string, ExecutionTaskDispatchSummary> {
  const index = new Map<string, ExecutionTaskDispatchSummary>();
  for (const dispatch of dispatches) {
    if (dispatch.taskId) index.set(dispatch.taskId, dispatch);
    if (dispatch.taskKey) index.set(dispatch.taskKey, dispatch);
  }
  return index;
}

export function getShipType(
  task: Pick<Subtask, "id" | "record_id" | "provider">,
  dispatchIndex: Map<string, ExecutionTaskDispatchSummary>
): "container" | "wooden" {
  const d =
    (task.record_id ? dispatchIndex.get(task.record_id) : undefined) ||
    (task.id ? dispatchIndex.get(task.id) : undefined);

  if (d?.executorType === "docker_cli") return "container";
  if (task.provider === "jules") return "wooden";
  return "container";
}

export function getBoatRaceTaskKey(task: Pick<Subtask, "id" | "record_id" | "project_id" | "sprint_id">): string {
  const recordId = typeof task.record_id === "string" ? task.record_id.trim() : "";
  if (recordId) {
    return recordId;
  }

  const projectId = typeof task.project_id === "string" ? task.project_id.trim() : "";
  const sprintId = typeof task.sprint_id === "string" ? task.sprint_id.trim() : "";
  return [projectId || "project", sprintId || "sprint", task.id].join(":");
}

export function getBoatRaceHeightPx(activeBoatCount: number): number {
  void activeBoatCount;
  return BOAT_RACE_HEIGHT_PX;
}

export function getBoatRaceCheckpoints(): readonly BoatRaceCheckpoint[] {
  return BOAT_RACE_CHECKPOINTS;
}

export function isBoatRaceHarbourTask(task: Subtask): boolean {
  const phase = getTaskProgressPhase(task);
  return phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";
}

export function isBoatRaceActiveTask(task: Subtask): boolean {
  return !isBoatRaceHarbourTask(task);
}
