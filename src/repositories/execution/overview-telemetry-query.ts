import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { OverviewTelemetrySnapshot } from "../../contracts/app-types.js";
import { toNumber } from "./execution-utils.js";
import {
  OverviewTelemetryProjectSummaryRow,
  ExecutionRuntimeEventSummaryRow,
} from "./execution-repository-types.js";
import { mapOverviewTelemetryProjectSummaryRow, mapExecutionRuntimeEventSummaryRow } from "./execution-read-model-mappers.js";
import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForSprintRuns } from "./execution-human-intervention-query.js";

export class OverviewTelemetryQuery {
  constructor(
    private readonly db: Database,
    private readonly storage: AppDbStorage,
  ) {}

  getOverviewTelemetrySnapshot(): OverviewTelemetrySnapshot {
    const activeProjects = this.db.prepare(`
      SELECT
        sr.project_id,
        p.name AS project_name,
        sr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.id AS sprint_run_id,
        sr.status AS sprint_run_status,
        0 AS active_dispatch_count,
        0 AS running_dispatch_count,
        COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.started_at, sr.created_at) AS updated_at
      FROM sprint_runs sr
      INNER JOIN projects p ON p.id = sr.project_id
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.status IN ('running', 'queued')
      ORDER BY updated_at DESC, p.name ASC, s.name ASC
      LIMIT 24
    `).all() as unknown as OverviewTelemetryProjectSummaryRow[];

    const pausedProjects = this.db.prepare(`
      SELECT
        sr.project_id,
        p.name AS project_name,
        sr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.id AS sprint_run_id,
        sr.status AS sprint_run_status,
        0 AS active_dispatch_count,
        0 AS running_dispatch_count,
        COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.started_at, sr.created_at) AS updated_at
      FROM sprint_runs sr
      INNER JOIN projects p ON p.id = sr.project_id
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.status = 'paused'
      ORDER BY updated_at DESC, p.name ASC, s.name ASC
      LIMIT 24
    `).all() as unknown as OverviewTelemetryProjectSummaryRow[];

    const telemetrySprintRunIds = Array.from(new Set([
      ...activeProjects.map((row) => row.sprint_run_id),
      ...pausedProjects.map((row) => row.sprint_run_id),
    ]));

    if (telemetrySprintRunIds.length > 0) {
      const counts = this.storage.executeChunkedInQuery<{ sprint_run_id: string; active_count: number | string; running_count: number | string; }>({
        sqlPrefix: `SELECT sprint_run_id,
          SUM(CASE WHEN status IN ('queued', 'claimed', 'running', 'cancel_requested', 'blocked') THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status IN ('claimed', 'running') THEN 1 ELSE 0 END) AS running_count
        FROM task_dispatches
        WHERE sprint_run_id`,
        sqlSuffix: `GROUP BY sprint_run_id`,
        items: telemetrySprintRunIds,
      });
      const countsBySprintRunId = new Map<string, { active: number; running: number }>();
      for (const row of counts) {
        countsBySprintRunId.set(row.sprint_run_id, {
          active: toNumber(row.active_count),
          running: toNumber(row.running_count),
        });
      }
      for (const row of activeProjects) {
        const counts = countsBySprintRunId.get(row.sprint_run_id);
        row.active_dispatch_count = counts?.active || 0;
        row.running_dispatch_count = counts?.running || 0;
      }
      for (const row of pausedProjects) {
        const counts = countsBySprintRunId.get(row.sprint_run_id);
        row.active_dispatch_count = counts?.active || 0;
        row.running_dispatch_count = counts?.running || 0;
      }
    }
    const activeAttentionItems = listActiveAttentionRowsForSprintRuns(this.storage, telemetrySprintRunIds);

    const recentEvents = this.loadRecentEvents(telemetrySprintRunIds);

    const eventAwareHumanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun(
      [...activeProjects, ...pausedProjects].map((row) => ({
        id: row.sprint_run_id,
        sprint_id: row.sprint_id,
        status: row.sprint_run_status,
      })),
      activeAttentionItems,
      recentEvents,
    );

    return {
      activeProjects: activeProjects.map((row) => mapOverviewTelemetryProjectSummaryRow(
        row,
        eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
      )),
      attentionProjects: pausedProjects
        .filter((row) => Boolean(eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id)))
        .map((row) => mapOverviewTelemetryProjectSummaryRow(
          row,
          eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
        )),
      recentEvents: recentEvents.map((row) => mapExecutionRuntimeEventSummaryRow(row)),
      updatedAt: new Date().toISOString(),
    };
  }

  private loadRecentEvents(telemetrySprintRunIds: string[]): ExecutionRuntimeEventSummaryRow[] {
    if (telemetrySprintRunIds.length === 0) {
      return [];
    }

    const taskRunEvents = this.storage.executeChunkedInQuery<ExecutionRuntimeEventSummaryRow>({
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
        INNER JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
        INNER JOIN sprints s ON s.id = tr.sprint_id
        INNER JOIN tasks t ON t.id = tr.task_id
        LEFT JOIN mcp_connections c ON c.id = tr.connection_id
        WHERE tr.sprint_run_id`,
      items: telemetrySprintRunIds,
    });

    const sprintRunEvents = this.storage.executeChunkedInQuery<ExecutionRuntimeEventSummaryRow>({
      sqlPrefix: `
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
        WHERE sre.sprint_run_id`,
      items: telemetrySprintRunIds,
    });

    const allEvents = [...taskRunEvents, ...sprintRunEvents];
    allEvents.sort((a, b) => {
      if (a.created_at > b.created_at) return -1;
      if (a.created_at < b.created_at) return 1;
      return Number(b.id) - Number(a.id);
    });

    return allEvents.slice(0, 80);
  }
}
