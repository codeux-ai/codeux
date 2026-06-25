import { AppDbStorage } from "../app-db-storage.js";
import { DatabaseAdapter } from "../db/database-adapter.js";
import { toNumber } from "./execution-utils.js";

export class ExecutionWallTimeQuery {
  private readonly taskWallTimeCache = new Map<string, { finishedMs: number; hasActive: boolean }>();
  private readonly sprintRunWallTimeCache = new Map<string, { finishedMs: number; hasActive: boolean }>();

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: AppDbStorage
  ) {}

  invalidateTask(projectId: string, taskId: string): void {
    this.taskWallTimeCache.delete(`${projectId}:${taskId}`);
  }

  invalidateSprintRun(projectId: string, sprintRunId: string): void {
    this.sprintRunWallTimeCache.delete(`${projectId}:${sprintRunId}`);
  }

  getWallTimeTotalsByTaskIds(projectId: string, taskIds: string[], nowIso: string): Map<string, number> {
    if (taskIds.length === 0) return new Map();
    const result = new Map<string, number>();
    const missingTaskIds: string[] = [];
    const activeTaskIds: string[] = [];

    for (const taskId of taskIds) {
      const cacheKey = `${projectId}:${taskId}`;
      if (this.taskWallTimeCache.has(cacheKey)) {
        const cache = this.taskWallTimeCache.get(cacheKey)!;
        result.set(taskId, cache.finishedMs);
        if (cache.hasActive) {
          activeTaskIds.push(taskId);
        }
      } else {
        missingTaskIds.push(taskId);
      }
    }

    if (missingTaskIds.length > 0) {
      const activeRows = this.storage.executeChunkedInQuery<{ task_id: string; c: number | string }>({
        sqlPrefix: `SELECT task_id, COUNT(*) as c FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND task_id`,
        sqlSuffix: "GROUP BY task_id",
        items: missingTaskIds,
      });
      const activeMap = new Set(activeRows.map(r => r.task_id));

      const finishedRows = this.storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT task_id, SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) AS total_duration_ms FROM task_runs WHERE task_id`,
        sqlSuffix: "GROUP BY task_id",
        items: missingTaskIds,
      });
      const finishedMap = new Map(finishedRows.map(r => [r.task_id, Math.max(0, Number(r.total_duration_ms) || 0)]));

      for (const taskId of missingTaskIds) {
        const cacheKey = `${projectId}:${taskId}`;
        const finishedMs = finishedMap.get(taskId) || 0;
        const hasActive = activeMap.has(taskId);
        this.taskWallTimeCache.set(cacheKey, { finishedMs, hasActive });
        result.set(taskId, finishedMs);
        if (hasActive) {
          activeTaskIds.push(taskId);
        }
      }
    }

    if (activeTaskIds.length > 0) {
      const activeTimeRows = this.storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT task_id, SUM(CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)) AS total_duration_ms FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND task_id`,
        sqlSuffix: "GROUP BY task_id",
        items: activeTaskIds,
        bindParamsBefore: [nowIso]
      });
      for (const row of activeTimeRows) {
        result.set(row.task_id, (result.get(row.task_id) || 0) + Math.max(0, Number(row.total_duration_ms) || 0));
      }
    }

    return result;
  }

  getWallTimeTotalsBySprintRunIds(projectId: string, sprintRunIds: string[], nowIso: string): Map<string, number> {
    if (sprintRunIds.length === 0) return new Map();
    const result = new Map<string, number>();
    const missingIds: string[] = [];
    const activeIds: string[] = [];

    for (const sprintRunId of sprintRunIds) {
      const cacheKey = `${projectId}:${sprintRunId}`;
      if (this.sprintRunWallTimeCache.has(cacheKey)) {
        const cache = this.sprintRunWallTimeCache.get(cacheKey)!;
        result.set(sprintRunId, cache.finishedMs);
        if (cache.hasActive) {
          activeIds.push(sprintRunId);
        }
      } else {
        missingIds.push(sprintRunId);
      }
    }

    if (missingIds.length > 0) {
      const activeRows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; c: number | string }>({
        sqlPrefix: `SELECT sprint_run_id, COUNT(*) as c FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND sprint_run_id`,
        sqlSuffix: "GROUP BY sprint_run_id",
        items: missingIds,
      });
      const activeMap = new Set(activeRows.map(r => r.sprint_run_id));

      const finishedRows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT sprint_run_id, SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) AS total_duration_ms FROM task_runs WHERE sprint_run_id`,
        sqlSuffix: "GROUP BY sprint_run_id",
        items: missingIds,
      });
      const finishedMap = new Map(finishedRows.map(r => [r.sprint_run_id, Math.max(0, Number(r.total_duration_ms) || 0)]));

      for (const sprintRunId of missingIds) {
        const cacheKey = `${projectId}:${sprintRunId}`;
        const finishedMs = finishedMap.get(sprintRunId) || 0;
        const hasActive = activeMap.has(sprintRunId);
        this.sprintRunWallTimeCache.set(cacheKey, { finishedMs, hasActive });
        result.set(sprintRunId, finishedMs);
        if (hasActive) {
          activeIds.push(sprintRunId);
        }
      }
    }

    if (activeIds.length > 0) {
      const activeTimeRows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT sprint_run_id, SUM(CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)) AS total_duration_ms FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND sprint_run_id`,
        sqlSuffix: "GROUP BY sprint_run_id",
        items: activeIds,
        bindParamsBefore: [nowIso]
      });
      for (const row of activeTimeRows) {
        result.set(row.sprint_run_id, (result.get(row.sprint_run_id) || 0) + Math.max(0, Number(row.total_duration_ms) || 0));
      }
    }

    return result;
  }

  getWallTimeTotalsByTaskIdsForRange(projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT
        task_id,
        SUM(
          CASE
            WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
            WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
            ELSE 0
          END
        ) AS total_duration_ms
      FROM task_runs
      WHERE project_id = ?
        AND task_id IS NOT NULL
        AND COALESCE(finished_at, started_at) >= ?
        AND COALESCE(finished_at, started_at) < ?
      GROUP BY task_id
    `).all(nowIso, projectId, rangeStartIso, rangeEndIso) as unknown as Array<{ task_id: string; total_duration_ms: number | string }>;

    return new Map(rows.map((row) => [row.task_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
  }

  getWallTimeTotalsBySprintRunIdsForRange(projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT
        sprint_run_id,
        SUM(
          CASE
            WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
            WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
            ELSE 0
          END
        ) AS total_duration_ms
      FROM task_runs
      WHERE project_id = ?
        AND sprint_run_id IS NOT NULL
        AND COALESCE(finished_at, started_at) >= ?
        AND COALESCE(finished_at, started_at) < ?
      GROUP BY sprint_run_id
    `).all(nowIso, projectId, rangeStartIso, rangeEndIso) as unknown as Array<{ sprint_run_id: string; total_duration_ms: number | string }>;

    return new Map(rows.map((row) => [row.sprint_run_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
  }
}
