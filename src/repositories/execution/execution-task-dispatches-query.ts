import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { AppDbStorage } from "../app-db-storage.js";
import type { ExecutionTaskDispatchSummaryRow } from "./execution-repository-types.js";

function executionTaskDispatchStatusRank(status: string): number {
  switch (status) {
    case "running":
      return 0;
    case "cancel_requested":
      return 1;
    case "claimed":
      return 2;
    case "queued":
      return 3;
    case "blocked":
      return 4;
    case "failed":
      return 5;
    case "completed":
      return 6;
    default:
      return 7;
  }
}

function compareExecutionTaskDispatchSummaryRows(
  left: ExecutionTaskDispatchSummaryRow,
  right: ExecutionTaskDispatchSummaryRow,
): number {
  const leftRecency = left.last_heartbeat_at || left.started_at || left.claimed_at || left.queued_at;
  const rightRecency = right.last_heartbeat_at || right.started_at || right.claimed_at || right.queued_at;

  const toNumber = (val: string | number) => Number(val);

  return executionTaskDispatchStatusRank(left.status) - executionTaskDispatchStatusRank(right.status)
    || toNumber(right.priority) - toNumber(left.priority)
    || rightRecency.localeCompare(leftRecency)
    || right.id.localeCompare(left.id);
}

export function queryExecutionTaskDispatches(
  db: DatabaseAdapter,
  storage: AppDbStorage,
  projectId: string,
  expandedSprintRunIds: string[]
): ExecutionTaskDispatchSummaryRow[] {
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
  const taskDispatches = [...taskDispatchById.values()].sort(compareExecutionTaskDispatchSummaryRows);

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

  return taskDispatches;
}
