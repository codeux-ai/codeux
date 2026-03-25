import type { Task, TaskPriority, TaskStatus } from "../types.js";
import { type ListWindowOption, resolveListWindow } from "./list-window.js";

const BOARD_LANES: TaskStatus[] = ["pending", "in_progress", "completed"];

const getLane = (status: TaskStatus): TaskStatus =>
  status === "coding_completed" ? "in_progress" : status;

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
  const filteredTasks = tasks.filter((task) => {
    if (statusFilter !== "all" && getLane(task.status) !== statusFilter) return false;
    if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
    return true;
  });

  const resolvedWindow = resolveListWindow(listWindow, filteredTasks.length);
  const visibleTasks = filteredTasks.slice(0, resolvedWindow);

  const stats = {
    total: filteredTasks.length,
    inProgress: filteredTasks.filter((task) => getLane(task.status) === "in_progress").length,
    completed: filteredTasks.filter((task) => getLane(task.status) === "completed").length,
    critical: filteredTasks.filter((task) => task.priority === "critical").length,
  };

  const allColumns = BOARD_LANES.map((lane) => ({
    status: lane,
    count: filteredTasks.filter((task) => getLane(task.status) === lane).length,
    tasks: visibleTasks.filter((task) => getLane(task.status) === lane),
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
