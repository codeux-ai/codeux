import type { Task, TaskPriority, TaskStatus } from "../types.js";
import { type ListWindowOption, resolveListWindow } from "./list-window.js";

const BOARD_LANES: TaskStatus[] = ["pending", "in_progress", "completed"];

export const getTaskLane = (status: TaskStatus): TaskStatus =>
  (status === "coding_completed" || status === "QA_REVIEW_FAILED") ? "in_progress" : status;

export interface TaskBoardState {
  filteredTasks: Task[];
  visibleTasks: Task[];
  stats: {
    total: number;
    inProgress: number;
    completed: number;
    critical: number;
  };
  columns: Array<{
    status: TaskStatus;
    count: number;
    tasks: Task[];
  }>;
}

export function deriveTaskBoardState(
  tasks: Task[],
  statusFilter: "all" | TaskStatus,
  priorityFilter: "all" | TaskPriority,
  listWindow: ListWindowOption
): TaskBoardState {
  const filteredTasks: Task[] = [];
  const laneCounts = new Map<TaskStatus, number>(BOARD_LANES.map((lane) => [lane, 0]));
  const visibleTasksByLane = new Map<TaskStatus, Task[]>(BOARD_LANES.map((lane) => [lane, []]));
  const stats = {
    total: 0,
    inProgress: 0,
    completed: 0,
    critical: 0,
  };

  for (const task of tasks) {
    const lane = getTaskLane(task.status);
    if (statusFilter !== "all" && lane !== statusFilter) continue;
    if (priorityFilter !== "all" && task.priority !== priorityFilter) continue;

    filteredTasks.push(task);
    stats.total += 1;
    laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);

    if (lane === "in_progress") {
      stats.inProgress += 1;
    }
    if (lane === "completed") {
      stats.completed += 1;
    }
    if (task.priority === "critical") {
      stats.critical += 1;
    }
  }

  const resolvedWindow = resolveListWindow(listWindow, filteredTasks.length);
  const visibleTasks = filteredTasks.slice(0, resolvedWindow);

  for (const task of visibleTasks) {
    visibleTasksByLane.get(getTaskLane(task.status))?.push(task);
  }

  const allColumns = BOARD_LANES.map((lane) => ({
    status: lane,
    count: laneCounts.get(lane) ?? 0,
    tasks: visibleTasksByLane.get(lane) ?? [],
  }));

  const columns = statusFilter !== "all"
    ? allColumns.filter((column) => column.count > 0)
    : allColumns;

  return {
    filteredTasks,
    visibleTasks,
    stats,
    columns,
  };
}
