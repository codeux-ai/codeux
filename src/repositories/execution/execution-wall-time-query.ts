import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { toNumber } from "./execution-utils.js";
import { WallTimeCache } from "./execution-stats-aggregation.js";

export function getWallTimeTotalsByTaskIds(storage: AppDbStorage, taskIds: string[], nowIso: string, cache: WallTimeCache): Map<string, number> {
  if (taskIds.length === 0) return new Map();
  const result = new Map<string, number>();
  const missingTaskIds: string[] = [];
  const activeTaskIds: string[] = [];

  for (const taskId of taskIds) {
    if (cache.has(taskId)) {
      const entry = cache.get(taskId)!;
      result.set(taskId, entry.finishedMs);
      if (entry.hasActive) {
        activeTaskIds.push(taskId);
      }
    } else {
      missingTaskIds.push(taskId);
    }
  }

  if (missingTaskIds.length > 0) {
    const activeRows = storage.executeChunkedInQuery<{ task_id: string; c: number | string }>({
      sqlPrefix: `SELECT task_id, COUNT(*) as c FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND task_id`,
      sqlSuffix: "GROUP BY task_id",
      items: missingTaskIds,
    });
    const activeMap = new Set(activeRows.map(r => r.task_id));

    const finishedRows = storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
      sqlPrefix: `SELECT task_id, SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) AS total_duration_ms FROM task_runs WHERE task_id`,
      sqlSuffix: "GROUP BY task_id",
      items: missingTaskIds,
    });
    const finishedMap = new Map(finishedRows.map(r => [r.task_id, Math.max(0, Number(r.total_duration_ms) || 0)]));

    for (const taskId of missingTaskIds) {
      const finishedMs = finishedMap.get(taskId) || 0;
      const hasActive = activeMap.has(taskId);
      cache.set(taskId, { finishedMs, hasActive });
      result.set(taskId, finishedMs);
      if (hasActive) {
        activeTaskIds.push(taskId);
      }
    }
  }

  if (activeTaskIds.length > 0) {
    const activeTimeRows = storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
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

export function getWallTimeTotalsBySprintRunIds(storage: AppDbStorage, sprintRunIds: string[], nowIso: string, cache: WallTimeCache): Map<string, number> {
  if (sprintRunIds.length === 0) return new Map();
  const result = new Map<string, number>();
  const missingIds: string[] = [];
  const activeIds: string[] = [];

  for (const sprintRunId of sprintRunIds) {
    if (cache.has(sprintRunId)) {
      const entry = cache.get(sprintRunId)!;
      result.set(sprintRunId, entry.finishedMs);
      if (entry.hasActive) {
        activeIds.push(sprintRunId);
      }
    } else {
      missingIds.push(sprintRunId);
    }
  }

  if (missingIds.length > 0) {
    const activeRows = storage.executeChunkedInQuery<{ sprint_run_id: string; c: number | string }>({
      sqlPrefix: `SELECT sprint_run_id, COUNT(*) as c FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND sprint_run_id`,
      sqlSuffix: "GROUP BY sprint_run_id",
      items: missingIds,
    });
    const activeMap = new Set(activeRows.map(r => r.sprint_run_id));

    const finishedRows = storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
      sqlPrefix: `SELECT sprint_run_id, SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) AS total_duration_ms FROM task_runs WHERE sprint_run_id`,
      sqlSuffix: "GROUP BY sprint_run_id",
      items: missingIds,
    });
    const finishedMap = new Map(finishedRows.map(r => [r.sprint_run_id, Math.max(0, Number(r.total_duration_ms) || 0)]));

    for (const sprintRunId of missingIds) {
      const finishedMs = finishedMap.get(sprintRunId) || 0;
      const hasActive = activeMap.has(sprintRunId);
      cache.set(sprintRunId, { finishedMs, hasActive });
      result.set(sprintRunId, finishedMs);
      if (hasActive) {
        activeIds.push(sprintRunId);
      }
    }
  }

  if (activeIds.length > 0) {
    const activeTimeRows = storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
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

export function getWallTimeTotalsByTaskIdsForRange(db: Database, projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
  const rows = db.prepare(`
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

export function getWallTimeTotalsBySprintRunIdsForRange(db: Database, projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
  const rows = db.prepare(`
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
