import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { toNumber } from "./execution-utils.js";

export function getWallTimeTotalsByTaskIds(storage: AppDbStorage, taskIds: string[], nowIso: string): Map<string, number> {
  if (taskIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
    sqlPrefix: `
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
    WHERE task_id`,
    sqlSuffix: "GROUP BY task_id",
    items: taskIds,
    bindParamsBefore: [nowIso],
  });
  return new Map(rows.map((row) => [row.task_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
}

export function getWallTimeTotalsBySprintRunIds(storage: AppDbStorage, sprintRunIds: string[], nowIso: string): Map<string, number> {
  if (sprintRunIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
    sqlPrefix: `
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
    WHERE sprint_run_id`,
    sqlSuffix: "GROUP BY sprint_run_id",
    items: sprintRunIds,
    bindParamsBefore: [nowIso],
  });
  return new Map(rows.map((row) => [row.sprint_run_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
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
