import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";
import { getTaskProgressPhase } from "../../lib/task-progress.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateLiveMessage, type LiveMessageKey } from "../i18n/messages/live.js";

const BOAT_RACE_HEIGHT_PX = 800;

export interface BoatRaceCheckpoint {
  progress: number;
  label: string;
  color: string;
}

const BOAT_RACE_CHECKPOINTS: readonly (Omit<BoatRaceCheckpoint, "label"> & { key: LiveMessageKey })[] = [
  { progress: 0.25, key: "coding", color: "#00E0A0" },
  { progress: 0.48, key: "codeDone", color: "#0F9FA8" },
  { progress: 0.62, key: "ci", color: "#5dade2" },
  { progress: 0.72, key: "qa", color: "#D97706" },
  { progress: 0.78, key: "merge", color: "#FFB800" },
  { progress: 0.96, key: "completed", color: "#00AB84" },
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

export function getBoatRaceCheckpoints(locale: DashboardLocale = "en"): readonly BoatRaceCheckpoint[] {
  return BOAT_RACE_CHECKPOINTS.map((checkpoint) => ({
    progress: checkpoint.progress,
    color: checkpoint.color,
    label: translateLiveMessage(locale, checkpoint.key).toLocaleUpperCase(locale),
  }));
}

export function isBoatRaceHarbourTask(task: Subtask): boolean {
  const phase = getTaskProgressPhase(task);
  return phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";
}

export function isBoatRaceActiveTask(task: Subtask): boolean {
  return !isBoatRaceHarbourTask(task);
}
