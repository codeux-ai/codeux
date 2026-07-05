import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { AppDbStorage } from "../app-db-storage.js";
import type { ExecutionRuntimeEventSummaryRow } from "./execution-repository-types.js";

// `status_sync` events are internal bookkeeping written by ProjectRuntimeRepository on every
// status-signature change (they only carry `{ previousSignature, signature }` diagnostic strings).
// Nothing in the dashboard or the human-intervention summary reads them, yet because they are
// emitted so frequently they dominated the live snapshot payload (hundreds of KB → >1MB pushes
// that froze the browser tab). Exclude them from the live runtime-event feed entirely.
//
// The expanded-sprint-run feed is also capped: a single long or chatty sprint run can accumulate
// thousands of task-run events, and pulling them all balloons the realtime snapshot to several MB,
// which the renderer re-parses on every tick and freezes the app. The live feed only needs recent
// activity (full history is available on demand elsewhere), so each active run contributes at most
// `EXPANDED_EVENTS_PER_RUN_LIMIT` recent events (applied PER run via a window function so a chatty
// run can never evict a quieter parallel run's events) and the merged feed is capped at
// `MAX_RUNTIME_EVENTS`. Selected-sprint events are read through a separate pinned slice so an older
// selected sprint remains visible even when expanded runs and project-recent events are noisy.
const MAX_RUNTIME_EVENTS = 300;
const RECENT_PROJECT_EVENTS_LIMIT = 240;
const SELECTED_SPRINT_EVENTS_LIMIT = 120;
const EXPANDED_EVENTS_PER_RUN_LIMIT = SELECTED_SPRINT_EVENTS_LIMIT;

function compareRuntimeEvents(
  left: ExecutionRuntimeEventSummaryRow,
  right: ExecutionRuntimeEventSummaryRow,
): number {
  return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

function mergeRuntimeEvents(
  eventGroups: ExecutionRuntimeEventSummaryRow[][],
  limit: number,
  pinnedEventGroups: ExecutionRuntimeEventSummaryRow[][] = [],
): ExecutionRuntimeEventSummaryRow[] {
  const pinnedEventById = new Map<string, ExecutionRuntimeEventSummaryRow>();
  for (const group of pinnedEventGroups) {
    for (const row of group) {
      pinnedEventById.set(row.id, row);
    }
  }
  const pinnedEvents = [...pinnedEventById.values()]
    .sort(compareRuntimeEvents)
    .slice(0, limit);

  const eventById = new Map<string, ExecutionRuntimeEventSummaryRow>();
  for (const group of eventGroups) {
    for (const row of group) {
      if (pinnedEventById.has(row.id)) {
        continue;
      }
      eventById.set(row.id, row);
    }
  }
  return [
    ...pinnedEvents,
    ...[...eventById.values()]
      .sort(compareRuntimeEvents)
      .slice(0, Math.max(limit - pinnedEvents.length, 0)),
  ].sort(compareRuntimeEvents);
}

export function queryExecutionRuntimeEvents(
  db: DatabaseAdapter,
  storage: AppDbStorage,
  projectId: string,
  expandedSprintRunIds: string[],
  selectedSprintId?: string | null,
): ExecutionRuntimeEventSummaryRow[] {
  const uniqueExpandedSprintRunIds = [...new Set(expandedSprintRunIds)];
  const expandedPlaceholders = uniqueExpandedSprintRunIds.map(() => "?").join(", ");
  const expandedExclusion = uniqueExpandedSprintRunIds.length > 0
    ? `AND (tr.sprint_run_id IS NULL OR tr.sprint_run_id NOT IN (${expandedPlaceholders}))`
    : "";

  // Each slice is ordered and capped on its own index first. Expanded task-run
  // events are excluded from the project-recent task slice because they are
  // loaded below with a per-run cap.
  const recentTaskEvents = db.prepare(`
    SELECT
      tre.id,
      'task_run' AS scope_type,
      tre.task_run_id,
      tr.sprint_run_id,
      tr.dispatch_id,
      tre.project_id,
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
    WHERE tre.project_id = ?
      AND tre.event_type != 'status_sync'
      ${expandedExclusion}
    ORDER BY tre.created_at DESC, tre.id DESC
    LIMIT ?
  `).all(
    projectId,
    ...uniqueExpandedSprintRunIds,
    RECENT_PROJECT_EVENTS_LIMIT,
  ) as unknown as ExecutionRuntimeEventSummaryRow[];

  const recentSprintRunEvents = db.prepare(`
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
    ORDER BY sre.created_at DESC, sre.id DESC
    LIMIT ?
  `).all(projectId, RECENT_PROJECT_EVENTS_LIMIT) as unknown as ExecutionRuntimeEventSummaryRow[];

  const recentEvents = mergeRuntimeEvents(
    [recentTaskEvents, recentSprintRunEvents],
    RECENT_PROJECT_EVENTS_LIMIT,
  );

  const expandedSprintTaskEvents = uniqueExpandedSprintRunIds.length > 0
    ? storage.executeChunkedInQuery<ExecutionRuntimeEventSummaryRow>({
      sqlPrefix: `
      SELECT * FROM (
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
          tre.payload_json,
          ROW_NUMBER() OVER (
            PARTITION BY tr.sprint_run_id
            ORDER BY tre.created_at DESC, tre.id DESC
          ) AS run_event_rank
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        INNER JOIN sprints s ON s.id = tr.sprint_id
        INNER JOIN tasks t ON t.id = tr.task_id
        LEFT JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
        LEFT JOIN mcp_connections c ON c.id = tr.connection_id
        WHERE tre.project_id = ?
          AND tre.event_type != 'status_sync'
          AND tr.sprint_run_id`,
      sqlSuffix: `
      ) ranked
      WHERE ranked.run_event_rank <= ${EXPANDED_EVENTS_PER_RUN_LIMIT}`,
      items: uniqueExpandedSprintRunIds,
      bindParamsBefore: [projectId],
    })
    : [];

  const selectedTaskEvents = selectedSprintId
    ? db.prepare(`
      SELECT
        tre.id,
        'task_run' AS scope_type,
        tre.task_run_id,
        tr.sprint_run_id,
        tr.dispatch_id,
        tre.project_id,
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
      WHERE tre.project_id = ?
        AND tr.sprint_id = ?
        AND tre.event_type != 'status_sync'
        ${expandedExclusion}
      ORDER BY tre.created_at DESC, tre.id DESC
      LIMIT ?
    `).all(
      projectId,
      selectedSprintId,
      ...uniqueExpandedSprintRunIds,
      SELECTED_SPRINT_EVENTS_LIMIT,
    ) as unknown as ExecutionRuntimeEventSummaryRow[]
    : [];

  const selectedSprintRunEvents = selectedSprintId
    ? db.prepare(`
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
        AND sr.sprint_id = ?
        ${uniqueExpandedSprintRunIds.length > 0 ? `AND sr.id NOT IN (${expandedPlaceholders})` : ""}
      ORDER BY sre.created_at DESC, sre.id DESC
      LIMIT ?
    `).all(
      projectId,
      selectedSprintId,
      ...uniqueExpandedSprintRunIds,
      SELECTED_SPRINT_EVENTS_LIMIT,
    ) as unknown as ExecutionRuntimeEventSummaryRow[]
    : [];

  const selectedEvents = mergeRuntimeEvents(
    [selectedTaskEvents, selectedSprintRunEvents],
    SELECTED_SPRINT_EVENTS_LIMIT,
  );

  return mergeRuntimeEvents(
    [expandedSprintTaskEvents, recentEvents],
    MAX_RUNTIME_EVENTS,
    [selectedEvents],
  );
}
