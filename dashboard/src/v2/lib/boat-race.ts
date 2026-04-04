import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";

const BOAT_RACE_HEIGHT_PX = 800;

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
  if (d?.executorType === "mcp_worker") return "wooden";
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
