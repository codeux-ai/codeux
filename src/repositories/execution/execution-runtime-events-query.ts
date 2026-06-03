import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { AppDbStorage } from "../app-db-storage.js";
import type { ExecutionRuntimeEventSummaryRow } from "./execution-repository-types.js";

// `status_sync` events are internal bookkeeping written by ProjectRuntimeRepository on every
// status-signature change (they only carry `{ previousSignature, signature }` diagnostic strings).
// Nothing in the dashboard or the human-intervention summary reads them, yet because they are
// emitted so frequently they dominated the live snapshot payload (hundreds of KB → >1MB pushes
// that froze the browser tab). Exclude them from the live runtime-event feed entirely. Other event
// types are emitted on discrete lifecycle moments, so the active-sprint-run feed stays bounded by
// real activity without an artificial cap (which would drop a parallel run's events).
export function queryExecutionRuntimeEvents(
  db: DatabaseAdapter,
  storage: AppDbStorage,
  projectId: string,
  expandedSprintRunIds: string[]
): ExecutionRuntimeEventSummaryRow[] {
  const recentEvents = db.prepare(`
    SELECT *
    FROM (
      SELECT
        tre.id,
        'task_run' AS scope_type,
        tre.task_run_id,
        tr.sprint_run_id,
        tr.dispatch_id,
        tr.project_id,
        tr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.status AS sprint_run_status,
        tr.task_id,
        t.task_key,
        t.title AS task_title,
        tr.state AS task_run_state,
        tre.event_type,
        tre.originator,
        tre.source_event_key,
        tr.provider,
        tr.session_id,
        tr.session_name,
        tr.worker_branch,
        tr.pr_url,
        tr.connection_id,
        c.display_name AS connection_display_name,
        c.role AS connection_role,
        tre.created_at,
        tre.payload_json
      FROM task_run_events tre
      INNER JOIN task_runs tr ON tr.id = tre.task_run_id
      INNER JOIN sprints s ON s.id = tr.sprint_id
      INNER JOIN tasks t ON t.id = tr.task_id
      LEFT JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
      LEFT JOIN mcp_connections c ON c.id = tr.connection_id
      WHERE tr.project_id = ?
        AND tre.event_type != 'status_sync'

      UNION ALL

      SELECT
        sre.id,
        'sprint_run' AS scope_type,
        NULL AS task_run_id,
        sre.sprint_run_id,
        NULL AS dispatch_id,
        sr.project_id,
        sr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.status AS sprint_run_status,
        NULL AS task_id,
        NULL AS task_key,
        NULL AS task_title,
        NULL AS task_run_state,
        sre.event_type,
        sre.originator,
        sre.source_event_key,
        NULL AS provider,
        NULL AS session_id,
        NULL AS session_name,
        NULL AS worker_branch,
        NULL AS pr_url,
        NULL AS connection_id,
        NULL AS connection_display_name,
        NULL AS connection_role,
        sre.created_at,
        sre.payload_json
      FROM sprint_run_events sre
      INNER JOIN sprint_runs sr ON sr.id = sre.sprint_run_id
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.project_id = ?
    )
    ORDER BY created_at DESC, id DESC
    LIMIT 240
  `).all(projectId, projectId) as unknown as ExecutionRuntimeEventSummaryRow[];

  const expandedSprintTaskEvents = expandedSprintRunIds.length > 0
    ? storage.executeChunkedInQuery<ExecutionRuntimeEventSummaryRow>({
      sqlPrefix: `
      SELECT
        tre.id,
        'task_run' AS scope_type,
        tre.task_run_id,
        tr.sprint_run_id,
        tr.dispatch_id,
        tr.project_id,
        tr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.status AS sprint_run_status,
        tr.task_id,
        t.task_key,
        t.title AS task_title,
        tr.state AS task_run_state,
        tre.event_type,
        tre.originator,
        tre.source_event_key,
        tr.provider,
        tr.session_id,
        tr.session_name,
        tr.worker_branch,
        tr.pr_url,
        tr.connection_id,
        c.display_name AS connection_display_name,
        c.role AS connection_role,
        tre.created_at,
        tre.payload_json
      FROM task_run_events tre
      INNER JOIN task_runs tr ON tr.id = tre.task_run_id
      INNER JOIN sprints s ON s.id = tr.sprint_id
      INNER JOIN tasks t ON t.id = tr.task_id
      LEFT JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
      LEFT JOIN mcp_connections c ON c.id = tr.connection_id
      WHERE tr.project_id = ?
        AND tr.sprint_run_id`,
      sqlSuffix: `
        AND tre.event_type != 'status_sync'
      ORDER BY tre.created_at DESC, tre.id DESC`,
      items: expandedSprintRunIds,
      bindParamsBefore: [projectId],
    })
    : [];

  const recentEventById = new Map<string, ExecutionRuntimeEventSummaryRow>();
  for (const row of [...expandedSprintTaskEvents, ...recentEvents]) {
    recentEventById.set(row.id, row);
  }
  return [...recentEventById.values()].sort((left, right) => {
    return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
  });
}
