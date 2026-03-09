import type { Source, Sprint, Task } from "../types.js";

export interface OverviewStats {
  totalProjects: number;
  runningProjects: number;
  totalSprints: number;
  activeSprints: number;
  openTasks: number;
  completedTasks: number;
  runningTasks: number;
  criticalTasks: number;
}

export function computeOverviewStats(projects: Source[], sprints: Sprint[], tasks: Task[]): OverviewStats {
  return {
    totalProjects: projects.length,
    runningProjects: projects.filter((project) => project.isRunning).length,
    totalSprints: sprints.length,
    activeSprints: sprints.filter((sprint) => sprint.status === "running").length,
    openTasks: tasks.filter((task) => task.status !== "completed").length,
    completedTasks: tasks.filter((task) => task.status === "completed").length,
    runningTasks: tasks.filter((task) => task.status === "in_progress").length,
    criticalTasks: tasks.filter((task) => task.priority === "critical").length,
  };
}
