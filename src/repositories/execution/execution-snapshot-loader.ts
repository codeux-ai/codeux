import { DatabaseAdapter } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";

export interface ExecutionSprintRunSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  status: string;
  trigger_type: string;
  triggered_by: string;
  executor_mode: string;
  started_at: string;
  finished_at: string;
  last_heartbeat_at: string;
  created_at: string;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

export interface ExecutionTaskDispatchSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_run_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  task_id: string;
  task_key: string;
  task_title: string;
  status: string;
  executor_type: string;
  priority: number;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  queued_at: string;
  claimed_at: string;
  started_at: string;
  finished_at: string;
  last_heartbeat_at: string;
  error_message: string | null;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
  task_run_id: string | null;
  task_run_state: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
}

export interface ExecutionRuntimeEventSummaryRow {
  id: string;
  scope_type: string;
  task_run_id: string | null;
  sprint_run_id: string;
  dispatch_id: string | null;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  sprint_run_status: string | null;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  task_run_state: string | null;
  event_type: string;
  originator: string;
  source_event_key: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  created_at: string;
  payload_json: string;
}

export function loadExecutionSnapshotData(
  db: DatabaseAdapter,
  storage: AppDbStorage,
  projectId: string,
  compareExecutionTaskDispatchSummaryRows: (left: ExecutionTaskDispatchSummaryRow, right: ExecutionTaskDispatchSummaryRow) => number,
  compareExecutionRuntimeEventSummaryRows: (left: ExecutionRuntimeEventSummaryRow, right: ExecutionRuntimeEventSummaryRow) => number,
) {
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

  const recentTaskDispatches = db.prepare(`
    SELECT
      td.id,
      td.project_id,
      td.sprint_id,
      td.sprint_run_id,
      s.name AS sprint_name,
      s.number AS sprint_number,
      td.task_id,
      t.task_key,
      t.title AS task_title,
      td.status,
      td.executor_type,
      td.priority,
      td.connection_id,
      c.display_name AS connection_display_name,
      c.role AS connection_role,
      td.queued_at,
      td.claimed_at,
      td.started_at,
      td.finished_at,
      td.last_heartbeat_at,
      td.error_message,
      el.owner_key AS active_lease_owner_key,
      el.expires_at AS active_lease_expires_at
    FROM task_dispatches td
    INNER JOIN sprints s ON s.id = td.sprint_id
    INNER JOIN tasks t ON t.id = td.task_id
    LEFT JOIN mcp_connections c ON c.id = td.connection_id
    LEFT JOIN execution_leases el
      ON el.scope_type = 'task_dispatch'
     AND el.scope_id = td.id
    WHERE td.project_id = ?
    ORDER BY
      CASE td.status WHEN 'running' THEN 0 WHEN 'cancel_requested' THEN 1 WHEN 'claimed' THEN 2 WHEN 'queued' THEN 3 WHEN 'blocked' THEN 4 WHEN 'failed' THEN 5 WHEN 'completed' THEN 6 ELSE 7 END,
      td.priority DESC,
      COALESCE(td.last_heartbeat_at, td.started_at, td.claimed_at, td.queued_at) DESC
    LIMIT 24
  `).all(projectId) as unknown as ExecutionTaskDispatchSummaryRow[];

  const expandedSprintTaskDispatches = expandedSprintRunIds.length > 0
    ? storage.executeChunkedInQuery<ExecutionTaskDispatchSummaryRow>({
      sqlPrefix: `
      SELECT
        td.id,
        td.project_id,
        td.sprint_id,
        td.sprint_run_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        td.task_id,
        t.task_key,
        t.title AS task_title,
        td.status,
        td.executor_type,
        td.priority,
        td.connection_id,
        c.display_name AS connection_display_name,
        c.role AS connection_role,
        td.queued_at,
        td.claimed_at,
        td.started_at,
        td.finished_at,
        td.last_heartbeat_at,
        td.error_message,
        el.owner_key AS active_lease_owner_key,
        el.expires_at AS active_lease_expires_at
      FROM task_dispatches td
      INNER JOIN sprints s ON s.id = td.sprint_id
      INNER JOIN tasks t ON t.id = td.task_id
      LEFT JOIN mcp_connections c ON c.id = td.connection_id
      LEFT JOIN execution_leases el
        ON el.scope_type = 'task_dispatch'
       AND el.scope_id = td.id
      WHERE td.project_id = ?
        AND td.sprint_run_id`,
      sqlSuffix: "",
      items: expandedSprintRunIds,
      bindParamsBefore: [projectId],
    })
    : [];

  const taskDispatchById = new Map<string, ExecutionTaskDispatchSummaryRow>();
  for (const row of [...expandedSprintTaskDispatches, ...recentTaskDispatches]) {
    taskDispatchById.set(row.id, row);
  }
  const taskDispatches = [...taskDispatchById.values()].sort((left, right) => compareExecutionTaskDispatchSummaryRows(left, right));

  const dispatchIds = taskDispatches.map((row) => row.id);
  const taskRunByDispatchId = new Map<string, { id: string; state: string; provider: string | null; session_id: string | null; session_name: string | null; worker_branch: string | null; pr_url: string | null; }>();

  if (dispatchIds.length > 0) {
    const taskRunRows = storage.executeChunkedInQuery<{ dispatch_id: string; id: string; state: string; provider: string | null; session_id: string | null; session_name: string | null; worker_branch: string | null; pr_url: string | null; }>({
      sqlPrefix: `SELECT tr.dispatch_id, tr.id, tr.state, tr.provider, tr.session_id, tr.session_name, tr.worker_branch, tr.pr_url
      FROM task_runs tr
      INNER JOIN (
        SELECT dispatch_id, MAX(rowid) AS latest_rowid
        FROM task_runs
        WHERE dispatch_id`,
      sqlSuffix: `GROUP BY dispatch_id
      ) latest ON latest.latest_rowid = tr.rowid`,
      items: dispatchIds,
    });

    for (const run of taskRunRows) {
      taskRunByDispatchId.set(run.dispatch_id, run);
    }
  }

  for (const td of taskDispatches) {
    const taskRun = taskRunByDispatchId.get(td.id);
    td.task_run_id = taskRun?.id || null;
    td.task_run_state = taskRun?.state || null;
    td.provider = taskRun?.provider || null;
    td.session_id = taskRun?.session_id || null;
    td.session_name = taskRun?.session_name || null;
    td.worker_branch = taskRun?.worker_branch || null;
    td.pr_url = taskRun?.pr_url || null;
  }

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
      ORDER BY tre.created_at DESC, tre.id DESC`,
      items: expandedSprintRunIds,
      bindParamsBefore: [projectId],
    })
    : [];

  const recentEventById = new Map<string, ExecutionRuntimeEventSummaryRow>();
  for (const row of [...expandedSprintTaskEvents, ...recentEvents]) {
    recentEventById.set(row.id, row);
  }
  const runtimeEvents = [...recentEventById.values()].sort((left, right) => compareExecutionRuntimeEventSummaryRows(left, right));

  return { sprintRuns, taskDispatches, taskRunByDispatchId, runtimeEvents };
}
