import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { ExecutionSprintRunSummaryRow } from "./execution-repository-types.js";

const EXPANDED_RUN_STATUSES = ["running", "queued", "paused", "cancel_requested"];
const SPRINT_RUN_SNAPSHOT_LIMIT = 12;

const SPRINT_RUN_SELECT = `
      sr.id,
      sr.project_id,
      sr.sprint_id,
      s.name AS sprint_name,
      s.number AS sprint_number,
      sr.status,
      sr.trigger_type,
      sr.triggered_by,
      sr.executor_mode,
      sr.started_at,
      sr.finished_at,
      sr.last_heartbeat_at,
      sr.created_at,
      el.owner_key AS active_lease_owner_key,
      el.expires_at AS active_lease_expires_at`;

const SPRINT_RUN_FROM = `
    FROM sprint_runs sr
    INNER JOIN sprints s ON s.id = sr.sprint_id
    LEFT JOIN execution_leases el
      ON el.scope_type = 'sprint'
     AND el.scope_id = sr.sprint_id`;

const SPRINT_RUN_ORDER = `
    ORDER BY
      CASE sr.status WHEN 'running' THEN 0 WHEN 'cancel_requested' THEN 1 WHEN 'queued' THEN 2 WHEN 'paused' THEN 3 WHEN 'failed' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
      COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC`;

export function queryExecutionSprintRuns(
  db: DatabaseAdapter,
  projectId: string
): { sprintRuns: ExecutionSprintRunSummaryRow[], expandedSprintRunIds: string[] } {
  const statusPlaceholders = EXPANDED_RUN_STATUSES.map(() => "?").join(", ");
  const activeSprintRuns = db.prepare(`
    SELECT${SPRINT_RUN_SELECT}
    ${SPRINT_RUN_FROM}
    WHERE sr.project_id = ?
      AND sr.status IN (${statusPlaceholders})
    ${SPRINT_RUN_ORDER}
    LIMIT ?
  `).all(projectId, ...EXPANDED_RUN_STATUSES, SPRINT_RUN_SNAPSHOT_LIMIT) as unknown as ExecutionSprintRunSummaryRow[];

  const inactiveLimit = Math.max(SPRINT_RUN_SNAPSHOT_LIMIT - activeSprintRuns.length, 0);
  const inactiveSprintRuns = inactiveLimit > 0
    ? db.prepare(`
      SELECT${SPRINT_RUN_SELECT}
      ${SPRINT_RUN_FROM}
      WHERE sr.project_id = ?
        AND sr.status NOT IN (${statusPlaceholders})
      ${SPRINT_RUN_ORDER}
      LIMIT ?
    `).all(projectId, ...EXPANDED_RUN_STATUSES, inactiveLimit) as unknown as ExecutionSprintRunSummaryRow[]
    : [];

  const sprintRuns = [...activeSprintRuns, ...inactiveSprintRuns];

  const expandedSprintRunIds = sprintRuns
    .filter((row) => EXPANDED_RUN_STATUSES.includes(row.status))
    .map((row) => row.id);

  if (expandedSprintRunIds.length === 0 && sprintRuns[0]?.id) {
    expandedSprintRunIds.push(sprintRuns[0].id);
  }

  return { sprintRuns, expandedSprintRunIds };
}
