import type { Task, TaskPriority, TaskStatus } from "../types.js";
import { type ListWindowOption, resolveListWindow } from "./list-window.js";

const STATUS_ORDER: TaskStatus[] = ["pending", "in_progress", "coding_completed", "completed"];

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
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
    return true;
  });

  const resolvedWindow = resolveListWindow(listWindow, filteredTasks.length);
  const visibleTasks = filteredTasks.slice(0, resolvedWindow);

  const stats = {
    total: filteredTasks.length,
    inProgress: filteredTasks.filter((task) => task.status === "in_progress").length,
    completed: filteredTasks.filter((task) => task.status === "completed").length,
    critical: filteredTasks.filter((task) => task.priority === "critical").length,
  };

  const allColumns = STATUS_ORDER.map((status) => ({
    status,
    count: filteredTasks.filter((task) => task.status === status).length,
    tasks: visibleTasks.filter((task) => task.status === status),
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
