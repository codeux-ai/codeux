import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { StatsEntityMetadata } from "./execution-stats-types.js";
import { toNumber } from "./execution-utils.js";
import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { mergeUsageTotals } from "./execution-usage-query.js";
import { createEmptyUsageTotals } from "./stats-buckets.js";

export type WallTimeCache = Map<string, { finishedMs: number, hasActive: boolean }>;

export function getTaskMetadata(db: Database, projectId: string): Map<string, StatsEntityMetadata> {
  const rows = db.prepare(`
    SELECT t.id, t.task_key, t.title, t.status, s.name AS sprint_name
    FROM tasks t
    INNER JOIN sprints s ON s.id = t.sprint_id
    WHERE t.project_id = ?
  `).all(projectId) as unknown as Array<{ id: string; task_key: string; title: string; status: string; sprint_name: string }>;
  return new Map(rows.map((row) => [row.id, {
    label: `${row.task_key} ${row.title}`.trim(),
    secondaryLabel: row.sprint_name,
    status: row.status,
    provider: null,
    purpose: null,
    lastActivityAt: null,
  }] as const));
}

export function getSprintMetadata(db: Database, projectId: string): Map<string, StatsEntityMetadata> {
  const rows = db.prepare(`
    SELECT s.id AS sprint_id, sr.id AS sprint_run_id, s.name, s.number, sr.status
    FROM sprints s
    LEFT JOIN sprint_runs sr ON sr.sprint_id = s.id
    WHERE s.project_id = ?
  `).all(projectId) as unknown as Array<{
    sprint_id: string;
    sprint_run_id: string | null;
    name: string;
    number: number | string | null;
    status: string | null;
  }>;

  const map = new Map<string, StatsEntityMetadata>();

  for (const row of rows) {
    const summary = {
      label: row.number === null ? row.name : `Sprint ${toNumber(row.number)} · ${row.name}`,
      secondaryLabel: null,
      status: row.status,
      provider: null,
      purpose: null,
      lastActivityAt: null,
    } as const;
    map.set(row.sprint_id, summary);
    if (row.sprint_run_id) {
      map.set(row.sprint_run_id, summary);
    }
  }

  return map;
}

export function updateLastActivity(map: Map<string, string>, key: string | null | undefined, value: string | null | undefined): void {
  if (!key || !value) {
    return;
  }
  const current = map.get(key);
  if (!current || new Date(value).getTime() > new Date(current).getTime()) {
    map.set(key, value);
  }
}

export function mergeUsageMap(
  map: Map<string, ExecutionUsageTotals>,
  key: string | null | undefined,
  source: ProviderInvocationUsageRecord,
): void {
  if (!key) {
    return;
  }
  const current = map.get(key) || createEmptyUsageTotals();
  mergeUsageTotals(current, source);
  map.set(key, current);
}
