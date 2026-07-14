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
  totalTokens: number;
  tokensTrend: number[];
  sprintsTrend: number[];
  openTasksTrend: number[];
  completedTasksTrend: number[];
}

/**
 * Normalizes a date window for deterministic trend calculations.
 * Returns the start of the window (inclusive) and start of today for reference.
 */
export function getDateWindow(days: number = 7) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowStart = new Date(startOfToday);
  windowStart.setDate(windowStart.getDate() - (days - 1));
  return { windowStart, startOfToday };
}

/**
 * Efficiently determines which day in a trend window a date belongs to.
 */
export function getTrendIndex(dateStr: string | undefined, windowStart: Date, days: number): number | -1 | -2 {
  if (!dateStr) return -1;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return -1;

  const dStartOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  if (dStartOfDay < windowStart) {
    return -2; // Before window
  }

  const diffTime = dStartOfDay.getTime() - windowStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays >= 0 && diffDays < days) {
    return diffDays;
  }
  
  return -1; // Outside window (future) or invalid
}

export function buildEmptyTrend(length: number = 7): number[] {
  return Array(length).fill(0);
}

/**
 * Internal helper to finalize a cumulative trend from daily counts and a base value.
 */
function finalizeCumulativeTrend(counts: number[], base: number): number[] {
  const trend = Array(counts.length);
  let runningTotal = base;
  for (let i = 0; i < counts.length; i++) {
    runningTotal += counts[i];
    trend[i] = runningTotal;
  }
  return trend;
}

export function computeOverviewStats(
  projects: Source[],
  sprints: Sprint[],
  tasks: Task[],
  statsSnapshot?: ProjectExecutionStatsSnapshot | null,
  days: number = 7
): OverviewStats {
  const { windowStart } = getDateWindow(days);

  // 1. Projects pass
  let runningProjects = 0;
  for (const p of projects) {
    if (p.isRunning) runningProjects++;
  }

  // 2. Sprints pass
  let activeSprints = 0;
  let sprintsBeforeWindow = 0;
  const sprintsCountsPerDay = buildEmptyTrend(days);
  for (const s of sprints) {
    if (s.status === "running") activeSprints++;
    const idx = getTrendIndex(s.createdAt, windowStart, days);
    if (idx === -2) sprintsBeforeWindow++;
    else if (idx >= 0) sprintsCountsPerDay[idx]++;
  }

  // 3. Tasks pass
  let openTasks = 0;
  let completedTasks = 0;
  let runningTasks = 0;
  let criticalTasks = 0;
  let openTasksBeforeWindow = 0;
  const openTasksCountsPerDay = buildEmptyTrend(days);
  const completedTasksCountsPerDay = buildEmptyTrend(days);

  for (const t of tasks) {
    const isCompleted = t.status === "completed";
    const isRunning = t.status === "in_progress";
    const isCritical = t.priority === "critical";

    if (isCompleted) {
      completedTasks++;
      const idx = getTrendIndex(t.updatedAt || t.createdAt, windowStart, days);
      if (idx >= 0) completedTasksCountsPerDay[idx]++;
    } else {
      openTasks++;
      if (isRunning) runningTasks++;
      if (isCritical) criticalTasks++;
      
      const idx = getTrendIndex(t.createdAt, windowStart, days);
      if (idx === -2) openTasksBeforeWindow++;
      else if (idx >= 0) openTasksCountsPerDay[idx]++;
    }
  }

  // 4. Tokens Trend
  const tokensTrend = buildEmptyTrend(days);
  const buckets = statsSnapshot?.buckets;
  if (buckets && buckets.length > 0) {
    const lastN = buckets.slice(-days);
    for (let i = 0; i < lastN.length; i++) {
      const targetIdx = days - lastN.length + i;
      tokensTrend[targetIdx] = lastN[i]?.usage?.totalTokens || 0;
    }
  }

  return {
    totalProjects: projects.length,
    runningProjects,
    totalSprints: sprints.length,
    activeSprints,
    openTasks,
    completedTasks,
    runningTasks,
    criticalTasks,
    totalTokens: statsSnapshot?.usage?.totalTokens ?? 0,
    tokensTrend,
    sprintsTrend: finalizeCumulativeTrend(sprintsCountsPerDay, sprintsBeforeWindow),
    openTasksTrend: finalizeCumulativeTrend(openTasksCountsPerDay, openTasksBeforeWindow),
    completedTasksTrend: completedTasksCountsPerDay,
  };
}

// Deprecated helpers maintained for backward compatibility (if used elsewhere)
export function buildDailyCumulativeTrend(dateStrings: string[], days: number = 7): number[] {
  const { windowStart } = getDateWindow(days);
  let beforeWindow = 0;
  const countsPerDay = buildEmptyTrend(days);

  for (const dateStr of dateStrings) {
    const idx = getTrendIndex(dateStr, windowStart, days);
    if (idx === -2) beforeWindow++;
    else if (idx >= 0) countsPerDay[idx]++;
  }

  return finalizeCumulativeTrend(countsPerDay, beforeWindow);
}

export function buildDailyActivityTrend(dateStrings: string[], days: number = 7): number[] {
  const { windowStart } = getDateWindow(days);
  const trend = buildEmptyTrend(days);

  for (const dateStr of dateStrings) {
    const idx = getTrendIndex(dateStr, windowStart, days);
    if (idx >= 0) trend[idx]++;
  }

  return trend;
}

export function extractTokensTrend(buckets: ExecutionUsageBucketSummary[] | undefined, days: number = 7): number[] {
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
