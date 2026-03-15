import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import type {
  AcquireExecutionLeaseInput,
  CreateTaskRunInput,
  CreateSprintRunInput,
  CreateTaskDispatchInput,
  ExecutionLeaseRecord,
  SprintRunEventRecord,
  RenewExecutionLeaseInput,
  SprintRunRecord,
  TaskRunRecord,
  TaskRunEventRecord,
  TaskDispatchRecord,
  UpdateTaskRunInput,
  UpdateSprintRunInput,
  UpdateTaskDispatchInput,
} from "../contracts/execution-types.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionHumanInterventionSummary,
  OverviewTelemetryProjectSummary,
  OverviewTelemetrySnapshot,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
} from "../contracts/app-types.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";

interface SprintRunRow {
  id: string;
  project_id: string;
  sprint_id: string;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  executor_mode: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskDispatchRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_id: string;
  sprint_run_id: string;
  connection_id: string | null;
  executor_type: string;
  status: string;
  priority: number | string;
  queued_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionLeaseRow {
  id: string;
  scope_type: string;
  scope_id: string;
  owner_key: string;
  lease_token: string;
  acquired_at: string;
  expires_at: string;
  last_heartbeat_at: string | null;
}

interface TaskRunRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_id: string;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  connection_id: string | null;
  provider: string | null;
  mode: string | null;
  session_id: string | null;
  session_name: string | null;
  state: string;
  worker_branch: string | null;
  pr_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | string | null;
}

interface TaskRunEventRow {
  id: string;
  task_run_id: string;
  event_type: string;
  originator: string | null;
  payload_json: string | null;
  source_event_key: string | null;
  created_at: string;
}

interface SprintRunEventRow {
  id: string;
  sprint_run_id: string;
  event_type: string;
  originator: string | null;
  payload_json: string | null;
  source_event_key: string | null;
  created_at: string;
}

interface ExecutionSprintRunSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  executor_mode: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

interface ExecutionTaskDispatchSummaryRow {
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
  priority: number | string;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  task_run_id: string | null;
  task_run_state: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  queued_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

interface ExecutionRuntimeEventSummaryRow {
  id: string;
  scope_type: string;
  task_run_id: string | null;
  sprint_run_id: string | null;
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
  originator: string | null;
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
  payload_json: string | null;
}

interface OverviewTelemetryProjectSummaryRow {
  project_id: string;
  project_name: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  sprint_run_id: string;
  sprint_run_status: string;
  active_dispatch_count: number | string;
  running_dispatch_count: number | string;
  updated_at: string | null;
}

interface ProjectAttentionSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  sprint_run_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  title: string;
  summary_markdown: string;
  payload_json: string | null;
  updated_at: string;
}

interface WorkerProjectAffinityRow {
  project_id: string;
  active_count: number | string;
  last_seen_at: string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

function parsePayloadJson(value: string | null): Record<string, unknown> | null {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class ExecutionRepository {
  private readonly db: DatabaseSync;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }

  createSprintRun(input: CreateSprintRunInput): SprintRunRecord {
    this.requireProject(input.projectId);
    this.requireSprint(input.sprintId, input.projectId);
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, triggered_by, executor_mode,
        started_at, finished_at, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.status || "queued",
      input.triggerType || "manual",
      input.triggeredBy ?? null,
      input.executorMode || "mixed",
      null,
      null,
      null,
      now,
      now
    );

    const created = this.requireSprintRun(id);
    this.notifyRealtime(created.projectId, true);
    return created;
  }

  listSprintRuns(projectId: string, sprintId?: string): SprintRunRecord[] {
    this.requireProject(projectId);
    const rows = sprintId
      ? this.db.prepare(`
        SELECT *
        FROM sprint_runs
        WHERE project_id = ? AND sprint_id = ?
        ORDER BY created_at DESC
      `).all(projectId, sprintId)
      : this.db.prepare(`
        SELECT *
        FROM sprint_runs
        WHERE project_id = ?
        ORDER BY created_at DESC
      `).all(projectId);
    return (rows as unknown as SprintRunRow[]).map((row) => this.mapSprintRunRow(row));
  }

  getSprintRun(runId: string): SprintRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM sprint_runs
      WHERE id = ?
    `).get(runId) as SprintRunRow | undefined;
    return row ? this.mapSprintRunRow(row) : null;
  }

  findActiveSprintRun(projectId: string, sprintId: string): SprintRunRecord | null {
    this.requireProject(projectId);
    this.requireSprint(sprintId, projectId);
    const row = this.db.prepare(`
      SELECT *
      FROM sprint_runs
      WHERE project_id = ? AND sprint_id = ? AND status IN ('queued', 'running', 'paused', 'cancel_requested')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(projectId, sprintId) as SprintRunRow | undefined;
    return row ? this.mapSprintRunRow(row) : null;
  }

  updateSprintRun(runId: string, input: UpdateSprintRunInput): SprintRunRecord {
    const current = this.requireSprintRun(runId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE sprint_runs
      SET status = ?, executor_mode = ?, started_at = ?, finished_at = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status || current.status,
      input.executorMode || current.executorMode,
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      input.lastHeartbeatAt === undefined ? current.lastHeartbeatAt : input.lastHeartbeatAt,
      now,
      runId
    );
    const updated = this.requireSprintRun(runId);
    if (this.shouldPublishSprintRunUpdate(input)) {
      this.notifyRealtime(updated.projectId, true);
    }
    return updated;
  }

  createTaskDispatch(input: CreateTaskDispatchInput): TaskDispatchRecord {
    this.requireProject(input.projectId);
    this.requireSprint(input.sprintId, input.projectId);
    this.requireTask(input.taskId, input.projectId, input.sprintId);
    this.requireSprintRunScoped(input.sprintRunId, input.projectId, input.sprintId);
    if (input.connectionId) {
      this.requireConnection(input.connectionId);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const queuedAt = input.queuedAt || now;
    this.db.prepare(`
      INSERT INTO task_dispatches (
        id, project_id, sprint_id, task_id, sprint_run_id, connection_id, executor_type, status, priority,
        queued_at, claimed_at, started_at, finished_at, last_heartbeat_at, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.taskId,
      input.sprintRunId,
      input.connectionId ?? null,
      input.executorType,
      input.status || "queued",
      input.priority ?? 0,
      queuedAt,
      null,
      null,
      null,
      null,
      null,
      now,
      now
    );

    const created = this.requireTaskDispatch(id);
    this.notifyRealtime(created.projectId, true);
    return created;
  }

  listTaskDispatches(args: { projectId: string; sprintId?: string; sprintRunId?: string; taskId?: string }): TaskDispatchRecord[] {
    this.requireProject(args.projectId);
    const clauses = ["project_id = ?"];
    const values: string[] = [args.projectId];
    if (args.sprintId) {
      clauses.push("sprint_id = ?");
      values.push(args.sprintId);
    }
    if (args.sprintRunId) {
      clauses.push("sprint_run_id = ?");
      values.push(args.sprintRunId);
    }
    if (args.taskId) {
      clauses.push("task_id = ?");
      values.push(args.taskId);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE ${clauses.join(" AND ")}
      ORDER BY priority DESC, queued_at ASC, created_at ASC
    `).all(...values) as unknown as TaskDispatchRow[];

    return rows.map((row) => this.mapTaskDispatchRow(row));
  }

  listStaleCancelRequestedDispatches(cutoffIso: string): TaskDispatchRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE status = 'cancel_requested'
        AND COALESCE(last_heartbeat_at, updated_at, started_at, queued_at) <= ?
      ORDER BY COALESCE(last_heartbeat_at, updated_at, started_at, queued_at) ASC
    `).all(cutoffIso) as unknown as TaskDispatchRow[];

    return rows.map((row) => this.mapTaskDispatchRow(row));
  }

  updateTaskDispatch(dispatchId: string, input: UpdateTaskDispatchInput): TaskDispatchRecord {
    const current = this.requireTaskDispatch(dispatchId);
    if (input.connectionId) {
      this.requireConnection(input.connectionId);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE task_dispatches
      SET connection_id = ?, status = ?, claimed_at = ?, started_at = ?, finished_at = ?, last_heartbeat_at = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.connectionId === undefined ? current.connectionId : input.connectionId,
      input.status || current.status,
      input.claimedAt === undefined ? current.claimedAt : input.claimedAt,
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      input.lastHeartbeatAt === undefined ? current.lastHeartbeatAt : input.lastHeartbeatAt,
      input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
      now,
      dispatchId
    );
    const updated = this.requireTaskDispatch(dispatchId);
    if (this.shouldPublishTaskDispatchUpdate(input)) {
      this.notifyRealtime(updated.projectId, true);
    }
    return updated;
  }

  createTaskRun(input: CreateTaskRunInput): TaskRunRecord {
    this.requireProject(input.projectId);
    this.requireSprint(input.sprintId, input.projectId);
    this.requireTask(input.taskId, input.projectId, input.sprintId);
    if (input.sprintRunId) {
      this.requireSprintRunScoped(input.sprintRunId, input.projectId, input.sprintId);
    }
    if (input.dispatchId) {
      this.requireTaskDispatch(input.dispatchId);
    }
    if (input.connectionId) {
      this.requireConnection(input.connectionId);
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO task_runs (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, connection_id, provider, mode,
        session_id, session_name, state, worker_branch, pr_url, started_at, finished_at, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.taskId,
      input.sprintRunId ?? null,
      input.dispatchId ?? null,
      input.connectionId ?? null,
      input.provider ?? null,
      input.mode ?? null,
      input.sessionId ?? null,
      input.sessionName ?? null,
      input.state,
      input.workerBranch ?? null,
      input.prUrl ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.durationMs ?? null
    );

    const created = this.requireTaskRun(id);
    this.notifyRealtime(created.projectId, false);
    return created;
  }

  getTaskRun(taskRunId: string): TaskRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE id = ?
    `).get(taskRunId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getLatestTaskRunBySessionId(sessionId: string): TaskRunRecord | null {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return null;
    }
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE session_id = ?
      ORDER BY rowid DESC
      LIMIT 1
    `).get(normalizedSessionId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getTaskDispatch(dispatchId: string): TaskDispatchRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE id = ?
    `).get(dispatchId) as TaskDispatchRow | undefined;
    return row ? this.mapTaskDispatchRow(row) : null;
  }

  getTaskRunByDispatchId(dispatchId: string): TaskRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE dispatch_id = ?
      ORDER BY rowid DESC
      LIMIT 1
    `).get(dispatchId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getLatestTaskRun(taskId: string, sprintRunId?: string): TaskRunRecord | null {
    this.requireTask(taskId);
    const runClause = sprintRunId ? "AND sprint_run_id = ?" : "";
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE task_id = ?
      ${runClause}
      ORDER BY rowid DESC
      LIMIT 1
    `).get(taskId, ...(sprintRunId ? [sprintRunId] : [])) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {
    this.requireProject(projectId);
    const projectRow = this.db.prepare(`
      SELECT id, name
      FROM projects
      WHERE id = ?
    `).get(projectId) as { id: string; name: string } | undefined;

    const sprintRuns = this.db.prepare(`
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

    const taskDispatches = this.db.prepare(`
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
        tr.id AS task_run_id,
        tr.state AS task_run_state,
        tr.provider,
        tr.session_id,
        tr.session_name,
        tr.worker_branch,
        tr.pr_url,
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
      LEFT JOIN task_runs tr
        ON tr.id = (
          SELECT tr2.id
          FROM task_runs tr2
          WHERE tr2.dispatch_id = td.id
          ORDER BY tr2.rowid DESC
          LIMIT 1
        )
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

    const recentEvents = this.db.prepare(`
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
      LIMIT 60
    `).all(projectId, projectId) as unknown as ExecutionRuntimeEventSummaryRow[];

    const activeAttentionItems = this.listActiveAttentionRowsForProject(projectId);
    const humanInterventionBySprintRunId = this.buildHumanInterventionSummaryBySprintRun(
      sprintRuns,
      activeAttentionItems,
      recentEvents,
    );

    return {
      projectId: projectRow?.id || null,
      projectName: projectRow?.name || null,
      sprintRuns: sprintRuns.map((row) => this.mapExecutionSprintRunSummaryRow(
        row,
        humanInterventionBySprintRunId.get(row.id) || null,
      )),
      taskDispatches: taskDispatches.map((row) => this.mapExecutionTaskDispatchSummaryRow(row)),
      connections: [],
      primaryAssignedWorker: null,
      overflowAssignedWorkers: [],
      attentionItems: [],
      recentEvents: recentEvents.map((row) => this.mapExecutionRuntimeEventSummaryRow(row)),
      updatedAt: new Date().toISOString(),
    };
  }

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
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.sprint_run_id = sr.id
            AND td.status IN ('queued', 'claimed', 'running', 'cancel_requested', 'blocked')
        ) AS active_dispatch_count,
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.sprint_run_id = sr.id
            AND td.status IN ('claimed', 'running')
        ) AS running_dispatch_count,
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
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.sprint_run_id = sr.id
            AND td.status IN ('queued', 'claimed', 'running', 'cancel_requested', 'blocked')
        ) AS active_dispatch_count,
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.sprint_run_id = sr.id
            AND td.status IN ('claimed', 'running')
        ) AS running_dispatch_count,
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
    const activeAttentionItems = this.listActiveAttentionRowsForSprintRuns(telemetrySprintRunIds);

    const recentEvents = telemetrySprintRunIds.length === 0
      ? []
      : this.db.prepare(`
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
          INNER JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
          INNER JOIN sprints s ON s.id = tr.sprint_id
          INNER JOIN tasks t ON t.id = tr.task_id
          LEFT JOIN mcp_connections c ON c.id = tr.connection_id
          WHERE tr.sprint_run_id IN (${telemetrySprintRunIds.map(() => "?").join(", ")})

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
          WHERE sre.sprint_run_id IN (${telemetrySprintRunIds.map(() => "?").join(", ")})
        )
        ORDER BY created_at DESC, id DESC
        LIMIT 80
      `).all(...telemetrySprintRunIds, ...telemetrySprintRunIds) as unknown as ExecutionRuntimeEventSummaryRow[];

    const eventAwareHumanInterventionBySprintRunId = this.buildHumanInterventionSummaryBySprintRun(
      [...activeProjects, ...pausedProjects].map((row) => ({
        id: row.sprint_run_id,
        sprint_id: row.sprint_id,
        status: row.sprint_run_status,
      })),
      activeAttentionItems,
      recentEvents,
    );

    return {
      activeProjects: activeProjects.map((row) => this.mapOverviewTelemetryProjectSummaryRow(
        row,
        eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
      )),
      attentionProjects: pausedProjects
        .filter((row) => Boolean(eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id)))
        .map((row) => this.mapOverviewTelemetryProjectSummaryRow(
          row,
          eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
        )),
      recentEvents: recentEvents.map((row) => this.mapExecutionRuntimeEventSummaryRow(row)),
      updatedAt: new Date().toISOString(),
    };
  }

  updateTaskRun(taskRunId: string, input: UpdateTaskRunInput): TaskRunRecord {
    const current = this.requireTaskRun(taskRunId);
    this.db.prepare(`
      UPDATE task_runs
      SET connection_id = ?, provider = ?, mode = ?, session_id = ?, session_name = ?, state = ?, worker_branch = ?,
          pr_url = ?, started_at = ?, finished_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(
      input.connectionId === undefined ? current.connectionId : input.connectionId,
      input.provider === undefined ? current.provider : input.provider,
      input.mode === undefined ? current.mode : input.mode,
      input.sessionId === undefined ? current.sessionId : input.sessionId,
      input.sessionName === undefined ? current.sessionName : input.sessionName,
      input.state === undefined ? current.state : input.state,
      input.workerBranch === undefined ? current.workerBranch : input.workerBranch,
      input.prUrl === undefined ? current.prUrl : input.prUrl,
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      input.durationMs === undefined ? current.durationMs : input.durationMs,
      taskRunId
    );
    const updated = this.requireTaskRun(taskRunId);
    this.notifyRealtime(updated.projectId, false);
    return updated;
  }

  listLatestTaskRuns(taskIds: string[], sprintRunId?: string): Map<string, TaskRunRecord> {
    const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
    if (uniqueTaskIds.length === 0) {
      return new Map();
    }

    const runClause = sprintRunId ? "AND sprint_run_id = ?" : "";
    const rows = this.db.prepare(`
      SELECT tr.*
      FROM task_runs tr
      INNER JOIN (
        SELECT task_id, MAX(rowid) AS latest_rowid
        FROM task_runs
        WHERE task_id IN (${uniqueTaskIds.map(() => "?").join(", ")})
        ${runClause}
        GROUP BY task_id
      ) latest ON latest.latest_rowid = tr.rowid
      ORDER BY tr.rowid DESC
    `).all(...uniqueTaskIds, ...(sprintRunId ? [sprintRunId] : [])) as unknown as TaskRunRow[];

    const map = new Map<string, TaskRunRecord>();
    for (const row of rows) {
      if (!map.has(row.task_id)) {
        map.set(row.task_id, this.mapTaskRunRow(row));
      }
    }
    return map;
  }

  appendTaskRunEvent(
    taskRunId: string,
    eventType: string,
    originator: string,
    payload: Record<string, unknown>,
    options?: { createdAt?: string; sourceEventKey?: string | null },
  ): boolean {
    this.requireTaskRun(taskRunId);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO task_run_events (id, task_run_id, event_type, originator, payload_json, source_event_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      taskRunId,
      eventType,
      originator,
      JSON.stringify(payload),
      options?.sourceEventKey ?? null,
      options?.createdAt || new Date().toISOString()
    );
    const inserted = Number((result as { changes?: number }).changes || 0) > 0;
    if (inserted) {
      const taskRun = this.requireTaskRun(taskRunId);
      this.notifyRealtime(taskRun.projectId, false);
    }
    return inserted;
  }

  appendSprintRunEvent(
    sprintRunId: string,
    eventType: string,
    originator: string,
    payload: Record<string, unknown>,
    options?: { createdAt?: string; sourceEventKey?: string | null },
  ): boolean {
    this.requireSprintRun(sprintRunId);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO sprint_run_events (id, sprint_run_id, event_type, originator, payload_json, source_event_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      sprintRunId,
      eventType,
      originator,
      JSON.stringify(payload),
      options?.sourceEventKey ?? null,
      options?.createdAt || new Date().toISOString(),
    );
    const inserted = Number((result as { changes?: number }).changes || 0) > 0;
    if (inserted) {
      const sprintRun = this.requireSprintRun(sprintRunId);
      this.notifyRealtime(sprintRun.projectId, true);
    }
    return inserted;
  }

  listTaskRunEvents(taskRunId: string, limit: number = 50): TaskRunEventRecord[] {
    this.requireTaskRun(taskRunId);
    const rows = this.db.prepare(`
      SELECT *
      FROM task_run_events
      WHERE task_run_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(taskRunId, Math.max(1, limit)) as unknown as TaskRunEventRow[];
    return rows.map((row) => this.mapTaskRunEventRow(row));
  }

  listSprintRunEvents(sprintRunId: string, limit: number = 50): SprintRunEventRecord[] {
    this.requireSprintRun(sprintRunId);
    const rows = this.db.prepare(`
      SELECT *
      FROM sprint_run_events
      WHERE sprint_run_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(sprintRunId, Math.max(1, limit)) as unknown as SprintRunEventRow[];
    return rows.map((row) => this.mapSprintRunEventRow(row));
  }

  claimNextTaskDispatch(args: {
    projectId: string;
    executorType: TaskDispatchRecord["executorType"];
    connectionId?: string | null;
    sprintId?: string;
    sprintRunId?: string;
  }): TaskDispatchRecord | null {
    const queue = this.listTaskDispatches({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId,
    }).filter((dispatch) => dispatch.executorType === args.executorType && dispatch.status === "queued");

    const next = queue[0];
    if (!next) {
      return null;
    }

    const now = new Date().toISOString();
    return this.updateTaskDispatch(next.id, {
      connectionId: args.connectionId ?? null,
      status: "claimed",
      claimedAt: now,
      lastHeartbeatAt: now,
    });
  }

  listWorkerProjectAffinity(connectionId: string): string[] {
    const rows = this.db.prepare(`
      SELECT
        project_id,
        SUM(CASE WHEN status IN ('claimed', 'running', 'cancel_requested') THEN 1 ELSE 0 END) AS active_count,
        MAX(COALESCE(last_heartbeat_at, started_at, claimed_at, queued_at, created_at)) AS last_seen_at
      FROM task_dispatches
      WHERE connection_id = ?
        AND executor_type = 'mcp_worker'
      GROUP BY project_id
      ORDER BY active_count DESC, last_seen_at DESC, project_id ASC
    `).all(connectionId) as unknown as WorkerProjectAffinityRow[];

    return rows
      .map((row) => String(row.project_id || "").trim())
      .filter(Boolean);
  }

  acquireLease(input: AcquireExecutionLeaseInput): ExecutionLeaseRecord {
    const existing = this.getLease(input.scopeType, input.scopeId);
    const now = new Date().toISOString();

    if (existing && existing.expiresAt > now && existing.leaseToken !== input.leaseToken) {
      throw new Error(`Lease already held for ${input.scopeType}:${input.scopeId}`);
    }

    if (existing) {
      this.db.prepare(`
        UPDATE execution_leases
        SET owner_key = ?, lease_token = ?, acquired_at = ?, expires_at = ?, last_heartbeat_at = ?
        WHERE scope_type = ? AND scope_id = ?
      `).run(
        input.ownerKey,
        input.leaseToken,
        now,
        input.expiresAt,
        now,
        input.scopeType,
        input.scopeId
      );
      const updated = this.requireLease(input.scopeType, input.scopeId);
      this.notifyRealtimeForLease(input.scopeType, input.scopeId);
      return updated;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO execution_leases (id, scope_type, scope_id, owner_key, lease_token, acquired_at, expires_at, last_heartbeat_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.scopeType,
      input.scopeId,
      input.ownerKey,
      input.leaseToken,
      now,
      input.expiresAt,
      now
    );
    const created = this.requireLease(input.scopeType, input.scopeId);
    this.notifyRealtimeForLease(input.scopeType, input.scopeId);
    return created;
  }

  renewLease(input: RenewExecutionLeaseInput): ExecutionLeaseRecord {
    const current = this.requireLease(input.scopeType, input.scopeId);
    if (current.leaseToken !== input.leaseToken) {
      throw new Error(`Lease token mismatch for ${input.scopeType}:${input.scopeId}`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE execution_leases
      SET expires_at = ?, last_heartbeat_at = ?
      WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
    `).run(input.expiresAt, now, input.scopeType, input.scopeId, input.leaseToken);
    return this.requireLease(input.scopeType, input.scopeId);
  }

  releaseLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string, leaseToken?: string): void {
    const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
    if (leaseToken) {
      this.db.prepare(`
        DELETE FROM execution_leases
        WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
      `).run(scopeType, scopeId, leaseToken);
      if (projectId) {
        this.notifyRealtime(projectId, false);
      }
      return;
    }

    this.db.prepare(`
      DELETE FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).run(scopeType, scopeId);
    if (projectId) {
      this.notifyRealtime(projectId, false);
    }
  }

  releaseStaleSprintLease(projectId: string, sprintId: string): boolean {
    this.requireProject(projectId);
    this.requireSprint(sprintId, projectId);

    const lease = this.getLease("sprint", sprintId);
    if (!lease) {
      return false;
    }

    const activeRun = this.findActiveSprintRun(projectId, sprintId);
    if (activeRun) {
      return false;
    }

    this.releaseLease("sprint", sprintId, lease.leaseToken);
    return true;
  }

  getLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId) as ExecutionLeaseRow | undefined;
    return row ? this.mapExecutionLeaseRow(row) : null;
  }

  listExpiredLeases(scopeType?: ExecutionLeaseRecord["scopeType"], now = new Date()): ExecutionLeaseRecord[] {
    const nowIso = now.toISOString();
    const rows = scopeType
      ? this.db.prepare(`
        SELECT *
        FROM execution_leases
        WHERE scope_type = ?
          AND expires_at <= ?
        ORDER BY expires_at ASC
      `).all(scopeType, nowIso)
      : this.db.prepare(`
        SELECT *
        FROM execution_leases
        WHERE expires_at <= ?
        ORDER BY expires_at ASC
      `).all(nowIso);

    return (rows as unknown as ExecutionLeaseRow[]).map((row) => this.mapExecutionLeaseRow(row));
  }

  hasActiveTaskDispatches(sprintRunId: string): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM task_dispatches
      WHERE sprint_run_id = ?
        AND status IN ('queued', 'claimed', 'running', 'cancel_requested')
    `).get(sprintRunId) as { total: number | string } | undefined;
    return toNumber(row?.total || 0) > 0;
  }

  finalizeSprintRunCancellationIfIdle(sprintRunId: string): SprintRunRecord | null {
    const sprintRun = this.getSprintRun(sprintRunId);
    if (!sprintRun || sprintRun.status !== "cancel_requested" || this.hasActiveTaskDispatches(sprintRunId)) {
      return null;
    }

    const now = new Date().toISOString();
    const updated = this.updateSprintRun(sprintRunId, {
      status: "cancelled",
      finishedAt: now,
      lastHeartbeatAt: now,
    });
    this.appendSprintRunEvent(sprintRunId, "sprint_cancelled", "system", {
      reason: "cancel_request_completed",
    }, {
      sourceEventKey: `sprint-cancelled:${sprintRunId}:cancel-request-completed`,
    });
    this.releaseStaleSprintLease(updated.projectId, updated.sprintId);
    return updated;
  }

  private requireSprintRun(runId: string): SprintRunRecord {
    const run = this.getSprintRun(runId);
    if (!run) {
      throw new Error(`Sprint run not found: ${runId}`);
    }
    return run;
  }

  private requireTaskDispatch(dispatchId: string): TaskDispatchRecord {
    const dispatch = this.getTaskDispatch(dispatchId);
    if (!dispatch) {
      throw new Error(`Task dispatch not found: ${dispatchId}`);
    }
    return dispatch;
  }

  private requireTaskRun(taskRunId: string): TaskRunRecord {
    const taskRun = this.getTaskRun(taskRunId);
    if (!taskRun) {
      throw new Error(`Task run not found: ${taskRunId}`);
    }
    return taskRun;
  }

  private requireLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord {
    const lease = this.getLease(scopeType, scopeId);
    if (!lease) {
      throw new Error(`Execution lease not found: ${scopeType}:${scopeId}`);
    }
    return lease;
  }

  private requireProject(projectId: string): void {
    const row = this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }

  private requireSprint(sprintId: string, projectId?: string): void {
    const row = this.db.prepare(`
      SELECT id, project_id
      FROM sprints
      WHERE id = ?
    `).get(sprintId) as { id: string; project_id: string } | undefined;
    if (!row) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }
    if (projectId && row.project_id !== projectId) {
      throw new Error(`Sprint ${sprintId} does not belong to project ${projectId}`);
    }
  }

  private requireTask(taskId: string, projectId?: string, sprintId?: string): void {
    const row = this.db.prepare(`
      SELECT id, project_id, sprint_id
      FROM tasks
      WHERE id = ?
    `).get(taskId) as { id: string; project_id: string; sprint_id: string } | undefined;
    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (projectId && row.project_id !== projectId) {
      throw new Error(`Task ${taskId} does not belong to project ${projectId}`);
    }
    if (sprintId && row.sprint_id !== sprintId) {
      throw new Error(`Task ${taskId} does not belong to sprint ${sprintId}`);
    }
  }

  private requireSprintRunScoped(runId: string, projectId: string, sprintId: string): void {
    const run = this.requireSprintRun(runId);
    if (run.projectId !== projectId || run.sprintId !== sprintId) {
      throw new Error(`Sprint run ${runId} does not belong to ${projectId}/${sprintId}`);
    }
  }

  private requireConnection(connectionId: string): void {
    const row = this.db.prepare(`SELECT id FROM mcp_connections WHERE id = ?`).get(connectionId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
  }

  private mapSprintRunRow(row: SprintRunRow): SprintRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      status: row.status as SprintRunRecord["status"],
      triggerType: row.trigger_type as SprintRunRecord["triggerType"],
      triggeredBy: row.triggered_by,
      executorMode: row.executor_mode as SprintRunRecord["executorMode"],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTaskDispatchRow(row: TaskDispatchRow): TaskDispatchRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      connectionId: row.connection_id,
      executorType: row.executor_type as TaskDispatchRecord["executorType"],
      status: row.status as TaskDispatchRecord["status"],
      priority: toNumber(row.priority),
      queuedAt: row.queued_at,
      claimedAt: row.claimed_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapExecutionLeaseRow(row: ExecutionLeaseRow): ExecutionLeaseRecord {
    return {
      id: row.id,
      scopeType: row.scope_type as ExecutionLeaseRecord["scopeType"],
      scopeId: row.scope_id,
      ownerKey: row.owner_key,
      leaseToken: row.lease_token,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
      lastHeartbeatAt: row.last_heartbeat_at,
    };
  }

  private mapTaskRunRow(row: TaskRunRow): TaskRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      connectionId: row.connection_id,
      provider: row.provider,
      mode: row.mode,
      sessionId: row.session_id,
      sessionName: row.session_name,
      state: row.state as TaskRunRecord["state"],
      workerBranch: row.worker_branch,
      prUrl: row.pr_url,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms === null ? null : toNumber(row.duration_ms),
    };
  }

  private mapTaskRunEventRow(row: TaskRunEventRow): TaskRunEventRecord {
    return {
      id: row.id,
      taskRunId: row.task_run_id,
      eventType: row.event_type,
      originator: row.originator,
      payload: parsePayloadJson(row.payload_json),
      sourceEventKey: row.source_event_key,
      createdAt: row.created_at,
    };
  }

  private mapSprintRunEventRow(row: SprintRunEventRow): SprintRunEventRecord {
    return {
      id: row.id,
      sprintRunId: row.sprint_run_id,
      eventType: row.event_type,
      originator: row.originator,
      payload: parsePayloadJson(row.payload_json),
      sourceEventKey: row.source_event_key,
      createdAt: row.created_at,
    };
  }

  private mapExecutionSprintRunSummaryRow(
    row: ExecutionSprintRunSummaryRow,
    humanIntervention: ExecutionHumanInterventionSummary | null,
  ): ExecutionSprintRunSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      status: row.status,
      triggerType: row.trigger_type,
      triggeredBy: row.triggered_by,
      executorMode: row.executor_mode,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      activeLeaseOwnerKey: row.active_lease_owner_key,
      activeLeaseExpiresAt: row.active_lease_expires_at,
      humanIntervention,
    };
  }

  private mapExecutionTaskDispatchSummaryRow(row: ExecutionTaskDispatchSummaryRow): ExecutionTaskDispatchSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintRunId: row.sprint_run_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      status: row.status,
      executorType: row.executor_type,
      priority: toNumber(row.priority),
      connectionId: row.connection_id,
      connectionDisplayName: row.connection_display_name,
      connectionRole: row.connection_role,
      taskRunId: row.task_run_id,
      taskRunState: row.task_run_state,
      provider: row.provider,
      sessionId: row.session_id,
      sessionName: row.session_name,
      workerBranch: row.worker_branch,
      prUrl: row.pr_url,
      queuedAt: row.queued_at,
      claimedAt: row.claimed_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      errorMessage: row.error_message,
      activeLeaseOwnerKey: row.active_lease_owner_key,
      activeLeaseExpiresAt: row.active_lease_expires_at,
    };
  }

  private mapExecutionRuntimeEventSummaryRow(row: ExecutionRuntimeEventSummaryRow): ExecutionRuntimeEventSummary {
    return {
      id: row.id,
      scopeType: row.scope_type === "sprint_run" ? "sprint_run" : "task_run",
      taskRunId: row.task_run_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      sprintRunStatus: row.sprint_run_status,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      taskRunState: row.task_run_state,
      eventType: row.event_type,
      originator: row.originator,
      sourceEventKey: row.source_event_key,
      provider: row.provider,
      sessionId: row.session_id,
      sessionName: row.session_name,
      workerBranch: row.worker_branch,
      prUrl: row.pr_url,
      connectionId: row.connection_id,
      connectionDisplayName: row.connection_display_name,
      connectionRole: row.connection_role,
      createdAt: row.created_at,
      payload: parsePayloadJson(row.payload_json),
    };
  }

  private mapOverviewTelemetryProjectSummaryRow(
    row: OverviewTelemetryProjectSummaryRow,
    humanIntervention: ExecutionHumanInterventionSummary | null,
  ): OverviewTelemetryProjectSummary {
    return {
      projectId: row.project_id,
      projectName: row.project_name,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      sprintRunId: row.sprint_run_id,
      sprintRunStatus: row.sprint_run_status,
      activeDispatchCount: toNumber(row.active_dispatch_count),
      runningDispatchCount: toNumber(row.running_dispatch_count),
      updatedAt: row.updated_at,
      humanIntervention,
    };
  }

  private listActiveAttentionRowsForProject(projectId: string): ProjectAttentionSummaryRow[] {
    return this.db.prepare(`
      SELECT
        id,
        project_id,
        sprint_id,
        sprint_run_id,
        attention_type,
        severity,
        owner_type,
        status,
        title,
        summary_markdown,
        payload_json,
        updated_at
      FROM project_attention_items
      WHERE project_id = ?
        AND status IN ('open', 'claimed')
      ORDER BY updated_at DESC, opened_at DESC, id DESC
    `).all(projectId) as unknown as ProjectAttentionSummaryRow[];
  }

  private listActiveAttentionRowsForSprintRuns(sprintRunIds: string[]): ProjectAttentionSummaryRow[] {
    if (sprintRunIds.length === 0) {
      return [];
    }

    return this.db.prepare(`
      SELECT
        id,
        project_id,
        sprint_id,
        sprint_run_id,
        attention_type,
        severity,
        owner_type,
        status,
        title,
        summary_markdown,
        payload_json,
        updated_at
      FROM project_attention_items
      WHERE sprint_run_id IN (${sprintRunIds.map(() => "?").join(", ")})
        AND status IN ('open', 'claimed')
      ORDER BY updated_at DESC, opened_at DESC, id DESC
    `).all(...sprintRunIds) as unknown as ProjectAttentionSummaryRow[];
  }

  private buildHumanInterventionSummaryBySprintRun(
    sprintRuns: Array<{ id: string; sprint_id: string; status: string }>,
    attentionRows: ProjectAttentionSummaryRow[],
    recentEvents: ExecutionRuntimeEventSummaryRow[],
  ): Map<string, ExecutionHumanInterventionSummary> {
    const bySprintRunId = new Map<string, ExecutionHumanInterventionSummary>();
    const attentionBySprintRunId = new Map<string, ProjectAttentionSummaryRow[]>();
    const eventsBySprintRunId = new Map<string, ExecutionRuntimeEventSummaryRow[]>();

    for (const row of attentionRows) {
      const sprintRunId = asNonEmptyString(row.sprint_run_id);
      if (!sprintRunId || !this.isOperatorInterventionAttentionRow(row)) {
        continue;
      }
      const existing = attentionBySprintRunId.get(sprintRunId) || [];
      existing.push(row);
      attentionBySprintRunId.set(sprintRunId, existing);
    }

    for (const event of recentEvents) {
      const sprintRunId = asNonEmptyString(event.sprint_run_id);
      if (!sprintRunId) {
        continue;
      }
      const existing = eventsBySprintRunId.get(sprintRunId) || [];
      existing.push(event);
      eventsBySprintRunId.set(sprintRunId, existing);
    }

    for (const sprintRun of sprintRuns) {
      const attentionSummary = this.buildHumanInterventionSummaryFromAttentionRows(
        attentionBySprintRunId.get(sprintRun.id) || [],
      );
      if (attentionSummary) {
        bySprintRunId.set(sprintRun.id, attentionSummary);
        continue;
      }
      const eventSummary = this.buildHumanInterventionSummaryFromEvents(
        sprintRun.status,
        eventsBySprintRunId.get(sprintRun.id) || [],
      );
      if (eventSummary) {
        bySprintRunId.set(sprintRun.id, eventSummary);
      }
    }

    return bySprintRunId;
  }

  private buildHumanInterventionSummaryFromAttentionRows(
    attentionRows: ProjectAttentionSummaryRow[],
  ): ExecutionHumanInterventionSummary | null {
    const bestRow = [...attentionRows].sort((left, right) => this.compareAttentionPriority(left, right))[0];
    if (!bestRow) {
      return null;
    }

    const payload = parsePayloadJson(bestRow.payload_json);
    const title = bestRow.title.trim() || "Human intervention required";
    const reason = stripMarkdown(bestRow.summary_markdown || title) || title;

    switch (bestRow.attention_type) {
      case "merge_required": {
        const featureBranch = asNonEmptyString(payload?.featureBranch);
        const workerBranch = asNonEmptyString(payload?.workerBranch);
        const prUrl = asNonEmptyString(payload?.prUrl);
        const taskKey = asNonEmptyString(payload?.taskKey);
        const instructions = prUrl
          ? `Review and merge the completed task PR (${prUrl})${featureBranch ? ` into ${featureBranch}` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`
          : `Merge${taskKey ? ` ${taskKey}` : " the completed task"}${workerBranch ? ` from ${workerBranch}` : ""}${featureBranch ? ` into ${featureBranch}` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`;
        return this.createHumanInterventionSummary(bestRow, title, reason, instructions);
      }
      case "merge_conflict": {
        const featureBranch = asNonEmptyString(payload?.featureBranch);
        const workerBranch = asNonEmptyString(payload?.workerBranch);
        const prUrl = asNonEmptyString(payload?.prUrl);
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          prUrl
            ? `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the PR is clean. (${prUrl})`
            : `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the branches merge cleanly.`,
        );
      }
      case "action_required": {
        const interventionOwner = String(payload?.interventionOwner || "").toUpperCase();
        const sessionState = asNonEmptyString(payload?.sessionState);
        const provider = asNonEmptyString(payload?.provider);
        const instructions = interventionOwner === "HUMAN" || bestRow.owner_type === "human"
          ? `Open the blocked task${provider ? ` in ${provider}` : ""}${sessionState ? ` (${sessionState})` : ""}, provide the requested input or approval, then resume the sprint.`
          : `Review the blocked task${provider ? ` in ${provider}` : ""}${sessionState ? ` (${sessionState})` : ""}, resolve the action-required state, then resume the sprint if worker automation does not clear it.`;
        return this.createHumanInterventionSummary(bestRow, title, reason, instructions);
      }
      case "manual_attention":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Open the Live view, inspect the attention queue and blocked tasks, resolve the blocker, then resume the sprint.",
        );
      case "dashboard_reply_required":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Open the project conversation thread, send the requested dashboard reply, then resolve the attention item and resume the sprint.",
        );
      case "human_escalation_required":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Open the project handoff thread, perform the requested manual action, then resolve the attention item and resume the sprint.",
        );
      case "worker_dispatch_blocked":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Review the blocked worker dispatch in Live view, address the worker error, then retry or resume the sprint.",
        );
      case "worker_lease_expired":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Check the assigned worker connection, restart or reassign it if needed, then retry or resume the sprint.",
        );
      case "dispatch_cancel_stalled":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Review the stalled cancellation in Live view and force cancel or clean up the run before restarting the sprint.",
        );
      default:
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Review the active attention item in Live view, resolve the blocker, then resume the sprint.",
        );
    }
  }

  private buildHumanInterventionSummaryFromEvents(
    sprintRunStatus: string,
    recentEvents: ExecutionRuntimeEventSummaryRow[],
  ): ExecutionHumanInterventionSummary | null {
    if (recentEvents.length === 0) {
      return null;
    }

    const latestRelevantEvent = recentEvents.find((event) => (
      event.event_type === "branch_preflight_blocked"
      || event.event_type === "planning_preflight_blocked"
      || event.event_type === "sprint_merge_required"
      || event.event_type === "sprint_no_more_actions"
      || event.event_type === "sprint_paused"
    ));
    if (!latestRelevantEvent) {
      return null;
    }

    const payload = parsePayloadJson(latestRelevantEvent.payload_json);

    switch (latestRelevantEvent.event_type) {
      case "branch_preflight_blocked": {
        const featureBranch = asNonEmptyString(payload?.featureBranch) || "the sprint feature branch";
        return {
          title: "Branch preparation blocked",
          reason: `Sprint OS could not prepare ${featureBranch} automatically.`,
          instructions: "Check git authentication, remote push permissions, and local branch state, then resume the sprint.",
          attentionType: null,
          severity: "high",
          ownerType: "human",
        };
      }
      case "planning_preflight_blocked": {
        const planningTarget = asNonEmptyString(payload?.planningTarget) || "this sprint";
        return {
          title: "Sprint planning required",
          reason: `${planningTarget} must be planned into executable tasks before orchestration can continue.`,
          instructions: "Use Plan Sprint on the Sprints page, review the generated tasks, then start the sprint again.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      }
      case "sprint_merge_required": {
        const awaitingMergeCount = Number(payload?.awaitingMergeCount || 0);
        return {
          title: "Manual merge required",
          reason: `Sprint execution paused because ${awaitingMergeCount || "one or more"} completed task${awaitingMergeCount === 1 ? "" : "s"} still need manual merge work.`,
          instructions: "Merge the completed task branches or PRs into the sprint branch, then resume the sprint. You can enable feature PR automerge later to reduce manual merges.",
          attentionType: null,
          severity: "high",
          ownerType: "human",
        };
      }
      case "sprint_no_more_actions":
      case "sprint_paused":
        if (sprintRunStatus !== "paused") {
          return null;
        }
        return {
          title: "Manual attention required",
          reason: "Sprint execution paused because no further automatic action was available.",
          instructions: "Open the Live view, inspect the blocked tasks and attention queue, resolve the blocker, then resume the sprint.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      default:
        return null;
    }
  }

  private isOperatorInterventionAttentionRow(row: ProjectAttentionSummaryRow): boolean {
    if (row.status !== "open" && row.status !== "claimed") {
      return false;
    }

    if (
      row.attention_type === "merge_required"
      || row.attention_type === "manual_attention"
      || row.attention_type === "dashboard_reply_required"
      || row.attention_type === "human_escalation_required"
      || row.attention_type === "worker_dispatch_blocked"
      || row.attention_type === "worker_lease_expired"
      || row.attention_type === "dispatch_cancel_stalled"
    ) {
      return true;
    }

    if (row.attention_type === "merge_conflict") {
      return row.owner_type !== "worker";
    }

    if (row.attention_type !== "action_required") {
      return row.owner_type !== "worker";
    }

    const payload = parsePayloadJson(row.payload_json);
    return row.owner_type === "human" || String(payload?.interventionOwner || "").toUpperCase() === "HUMAN";
  }

  private compareAttentionPriority(left: ProjectAttentionSummaryRow, right: ProjectAttentionSummaryRow): number {
    const attentionPriority = (value: string): number => {
      switch (value) {
        case "human_escalation_required":
          return 0;
        case "dashboard_reply_required":
          return 1;
        case "merge_conflict":
          return 2;
        case "merge_required":
          return 3;
        case "action_required":
          return 4;
        case "manual_attention":
          return 5;
        case "worker_dispatch_blocked":
          return 6;
        case "worker_lease_expired":
          return 7;
        case "dispatch_cancel_stalled":
          return 8;
        default:
          return 9;
      }
    };
    const severityPriority = (value: string): number => {
      switch (value) {
        case "critical":
          return 0;
        case "high":
          return 1;
        case "medium":
          return 2;
        default:
          return 3;
      }
    };

    return attentionPriority(left.attention_type) - attentionPriority(right.attention_type)
      || severityPriority(left.severity) - severityPriority(right.severity)
      || right.updated_at.localeCompare(left.updated_at)
      || left.id.localeCompare(right.id);
  }

  private createHumanInterventionSummary(
    row: ProjectAttentionSummaryRow,
    title: string,
    reason: string,
    instructions: string,
  ): ExecutionHumanInterventionSummary {
    return {
      title,
      reason,
      instructions,
      attentionType: row.attention_type,
      severity: row.severity,
      ownerType: row.owner_type,
    };
  }

  private notifyRealtime(projectId: string, includeOverview: boolean): void {
    this.realtimeNotifier?.scheduleProjectExecutionRefresh(projectId, { includeOverview });
  }

  private shouldPublishSprintRunUpdate(input: UpdateSprintRunInput): boolean {
    return input.status !== undefined
      || input.executorMode !== undefined
      || input.startedAt !== undefined
      || input.finishedAt !== undefined;
  }

  private shouldPublishTaskDispatchUpdate(input: UpdateTaskDispatchInput): boolean {
    return input.connectionId !== undefined
      || input.status !== undefined
      || input.claimedAt !== undefined
      || input.startedAt !== undefined
      || input.finishedAt !== undefined
      || input.errorMessage !== undefined;
  }

  private notifyRealtimeForLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): void {
    const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
    if (projectId) {
      this.notifyRealtime(projectId, false);
    }
  }

  private resolveLeaseProjectId(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): string | null {
    if (scopeType === "sprint") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM sprints
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      return row?.project_id || null;
    }

    if (scopeType === "task_dispatch") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM task_dispatches
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      return row?.project_id || null;
    }

    return null;
  }
}
