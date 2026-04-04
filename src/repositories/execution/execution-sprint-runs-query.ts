import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { ExecutionSprintRunSummaryRow } from "./execution-repository-types.js";

export function queryExecutionSprintRuns(
  db: DatabaseAdapter,
  projectId: string
): { sprintRuns: ExecutionSprintRunSummaryRow[], expandedSprintRunIds: string[] } {
  const sprintRuns = db.prepare(`
    SELECT
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
      el.expires_at AS active_lease_expires_at
    FROM sprint_runs sr
    INNER JOIN sprints s ON s.id = sr.sprint_id
    LEFT JOIN execution_leases el
      ON el.scope_type = 'sprint'
     AND el.scope_id = sr.sprint_id
    WHERE sr.project_id = ?
    ORDER BY
      CASE sr.status WHEN 'running' THEN 0 WHEN 'cancel_requested' THEN 1 WHEN 'queued' THEN 2 WHEN 'paused' THEN 3 WHEN 'failed' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
      COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC
    LIMIT 12
  `).all(projectId) as unknown as ExecutionSprintRunSummaryRow[];

  const expandedSprintRunIds = sprintRuns
    .filter((row) => ["running", "queued", "paused", "cancel_requested"].includes(row.status))
    .map((row) => row.id);

  if (expandedSprintRunIds.length === 0 && sprintRuns[0]?.id) {
    expandedSprintRunIds.push(sprintRuns[0].id);
  }

  return { sprintRuns, expandedSprintRunIds };
}
