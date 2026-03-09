import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import type {
  AcquireExecutionLeaseInput,
  CreateSprintRunInput,
  CreateTaskDispatchInput,
  ExecutionLeaseRecord,
  RenewExecutionLeaseInput,
  SprintRunRecord,
  TaskDispatchRecord,
  UpdateSprintRunInput,
  UpdateTaskDispatchInput,
} from "../contracts/execution-types.js";

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

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

export class ExecutionRepository {
  private readonly db: DatabaseSync;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
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

    return this.requireSprintRun(id);
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
    return this.requireSprintRun(runId);
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

    return this.requireTaskDispatch(id);
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
    return this.requireTaskDispatch(dispatchId);
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
      return this.requireLease(input.scopeType, input.scopeId);
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
    return this.requireLease(input.scopeType, input.scopeId);
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
    if (leaseToken) {
      this.db.prepare(`
        DELETE FROM execution_leases
        WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
      `).run(scopeType, scopeId, leaseToken);
      return;
    }

    this.db.prepare(`
      DELETE FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).run(scopeType, scopeId);
  }

  getLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId) as ExecutionLeaseRow | undefined;
    return row ? this.mapExecutionLeaseRow(row) : null;
  }

  private requireSprintRun(runId: string): SprintRunRecord {
    const run = this.getSprintRun(runId);
    if (!run) {
      throw new Error(`Sprint run not found: ${runId}`);
    }
    return run;
  }

  private requireTaskDispatch(dispatchId: string): TaskDispatchRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE id = ?
    `).get(dispatchId) as TaskDispatchRow | undefined;
    if (!row) {
      throw new Error(`Task dispatch not found: ${dispatchId}`);
    }
    return this.mapTaskDispatchRow(row);
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
}
