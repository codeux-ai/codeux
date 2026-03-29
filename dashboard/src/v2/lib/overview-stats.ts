import type { Source, Sprint, Task, ProjectExecutionStatsSnapshot, ExecutionUsageBucketSummary } from "../types.js";

export interface OverviewStats {
  totalProjects: number;
  runningProjects: number;
  totalSprints: number;
  activeSprints: number;
  openTasks: number;
  completedTasks: number;
  runningTasks: number;
  criticalTasks: number;
  projectsTrend: number[];
  sprintsTrend: number[];
  openTasksTrend: number[];
  completedTasksTrend: number[];
}

export function buildEmptyTrend(length: number = 7): number[] {
  return Array(length).fill(0);
}

export function buildDailyCumulativeTrend(dateStrings: string[], days: number = 7): number[] {
  const trend = buildEmptyTrend(days);
  if (!dateStrings || dateStrings.length === 0) return trend;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let totalBeforeWindow = 0;
  const countsPerDay = Array(days).fill(0);

  const windowStart = new Date(startOfToday);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  for (const dateStr of dateStrings) {
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;

    // Use a unified start of day for comparison
    const dStartOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (dStartOfDay < windowStart) {
      totalBeforeWindow++;
    } else {
      const diffTime = dStartOfDay.getTime() - windowStart.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < days) {
        countsPerDay[diffDays]++;
      }
    }
  }

  let runningTotal = totalBeforeWindow;
  for (let i = 0; i < days; i++) {
    runningTotal += countsPerDay[i];
    trend[i] = runningTotal;
  }

  return trend;
}

export function buildDailyActivityTrend(dateStrings: string[], days: number = 7): number[] {
  const trend = buildEmptyTrend(days);
  if (!dateStrings || dateStrings.length === 0) return trend;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const windowStart = new Date(startOfToday);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  for (const dateStr of dateStrings) {
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;

    const dStartOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const diffTime = dStartOfDay.getTime() - windowStart.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays < days) {
      trend[diffDays]++;
    }
  }

  return trend;
}

export function extractProjectsTrend(buckets: ExecutionUsageBucketSummary[] | undefined, days: number = 7): number[] {
  const trend = buildEmptyTrend(days);
  if (!buckets || buckets.length === 0) return trend;

  const lastN = buckets.slice(-days);
  for (let i = 0; i < lastN.length; i++) {
    const targetIdx = days - lastN.length + i;
    trend[targetIdx] = lastN[i]?.usage?.totalTokens || 0;
  }
  return trend;
}

export function extractSprintsTrend(sprints: Sprint[]): number[] {
  return buildDailyCumulativeTrend(sprints.map((s) => s.createdAt));
}

export function extractOpenTasksTrend(tasks: Task[]): number[] {
  const openTasks = tasks.filter((t) => t.status !== "completed");
  return buildDailyCumulativeTrend(openTasks.map((t) => t.createdAt));
}

export function extractCompletedTasksTrend(tasks: Task[]): number[] {
  const completedTasks = tasks.filter((t) => t.status === "completed");
  return buildDailyActivityTrend(completedTasks.map((t) => t.updatedAt || t.createdAt));
}

export function computeOverviewStats(
  projects: Source[],
  sprints: Sprint[],
  tasks: Task[],
  statsSnapshot?: ProjectExecutionStatsSnapshot | null
): OverviewStats {
  const openTasksList = tasks.filter((task) => task.status !== "completed");
  const completedTasksList = tasks.filter((task) => task.status === "completed");

  const projectsTrend = extractProjectsTrend(statsSnapshot?.buckets);
  const sprintsTrend = extractSprintsTrend(sprints);
  const openTasksTrend = extractOpenTasksTrend(tasks);
  const completedTasksTrend = extractCompletedTasksTrend(tasks);

  return {
    totalProjects: projects.length,
    runningProjects: projects.filter((project) => project.isRunning).length,
    totalSprints: sprints.length,
    activeSprints: sprints.filter((sprint) => sprint.status === "running").length,
    openTasks: openTasksList.length,
    completedTasks: completedTasksList.length,
    runningTasks: tasks.filter((task) => task.status === "in_progress").length,
    criticalTasks: tasks.filter((task) => task.priority === "critical").length,
    projectsTrend,
    sprintsTrend,
    openTasksTrend,
    completedTasksTrend,
  };
}
