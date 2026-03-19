import type { Subtask } from "../../types.js";

const BOAT_RACE_HEIGHT_PX = 800;

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
