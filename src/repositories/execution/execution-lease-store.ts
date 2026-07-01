import { randomUUID } from "crypto";
interface Logger { error(message: string, obj?: any): void; }
import type {
  ExecutionLeaseRecord,
  AcquireExecutionLeaseInput,
  RenewExecutionLeaseInput,
  SprintRunRecord,
} from "../../contracts/execution-types.js";
import type { DatabaseAdapter } from "../db/database-adapter.js";
import {
  ConcurrencyConflictError,
  RepositoryError,
} from "../repository-utils.js";
import {
  requireProject,
  requireSprint,
  requireLease,
} from "./execution-validators.js";

export interface ExecutionLeaseRow {
  id: string;
  scope_type: string;
  scope_id: string;
  owner_key: string;
  lease_token: string;
  acquired_at: string;
  expires_at: string;
  last_heartbeat_at: string | null;
}

export class ExecutionLeaseStore {
  private readonly leaseProjectCache = new Map<string, string>();

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly notifyRealtime: (projectId: string, includeOverview: boolean) => void,
    private readonly logger: Logger,
    private readonly queries: {
      hasActiveTaskDispatches: (sprintRunId: string) => boolean;
      findActiveSprintRun: (projectId: string, sprintId: string) => SprintRunRecord | null;
    }
  ) {}

  public acquireLease(input: AcquireExecutionLeaseInput): ExecutionLeaseRecord {
    try {
      const existing = this.getLease(input.scopeType, input.scopeId);
      const now = new Date().toISOString();

      if (existing && existing.expiresAt > now && existing.leaseToken !== input.leaseToken) {
        throw new ConcurrencyConflictError(`Lease already held for ${input.scopeType}:${input.scopeId}`);
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
        const updated = requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
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
      const created = requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
      this.notifyRealtimeForLease(input.scopeType, input.scopeId);
      return created;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, scopeType: input.scopeType, scopeId: input.scopeId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  public renewLease(input: RenewExecutionLeaseInput): ExecutionLeaseRecord {
    try {
      const current = requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
      if (current.leaseToken !== input.leaseToken) {
        throw new ConcurrencyConflictError(`Lease token mismatch for ${input.scopeType}:${input.scopeId}`);
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE execution_leases
        SET expires_at = ?, last_heartbeat_at = ?
        WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
      `).run(input.expiresAt, now, input.scopeType, input.scopeId, input.leaseToken);
      return requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, scopeType: input.scopeType, scopeId: input.scopeId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  public releaseLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string, leaseToken?: string): void {
    try {
      const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
      this.leaseProjectCache.delete(`${scopeType}:${scopeId}`);

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
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, scopeType, scopeId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  public releaseStaleSprintLease(projectId: string, sprintId: string): boolean {
    try {
      requireProject(this.db, projectId);
      requireSprint(this.db, sprintId, projectId);

      const lease = this.getLease("sprint", sprintId);
      if (!lease) {
        return false;
      }

      const activeRun = this.queries.findActiveSprintRun(projectId, sprintId);
      if (activeRun) {
        if (activeRun.status === "running" || activeRun.status === "queued") {
          return false;
        }
        if (activeRun.status === "cancel_requested" && this.queries.hasActiveTaskDispatches(activeRun.id)) {
          return false;
        }
      }

      this.releaseLease("sprint", sprintId, lease.leaseToken);
      return true;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId, sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  public getLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId) as ExecutionLeaseRow | undefined;
    return row ? this.mapExecutionLeaseRow(row) : null;
  }

  public listAllLeases(scopeType?: ExecutionLeaseRecord["scopeType"]): ExecutionLeaseRecord[] {
    const rows = scopeType
      ? this.db.prepare(`
        SELECT *
        FROM execution_leases
        WHERE scope_type = ?
      `).all(scopeType)
      : this.db.prepare(`
        SELECT *
        FROM execution_leases
      `).all();

    return (rows as unknown as ExecutionLeaseRow[]).map((row) => this.mapExecutionLeaseRow(row));
  }

  public listExpiredLeases(scopeType?: ExecutionLeaseRecord["scopeType"], now = new Date()): ExecutionLeaseRecord[] {
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

  public resolveLeaseProjectId(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): string | null {
    const cacheKey = `${scopeType}:${scopeId}`;
    const cached = this.leaseProjectCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let projectId: string | null = null;

    if (scopeType === "sprint") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM sprints
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      projectId = row?.project_id || null;
    } else if (scopeType === "task_dispatch") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM task_dispatches
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      projectId = row?.project_id || null;
    }

    if (projectId !== null) {
      if (this.leaseProjectCache.size >= 1000) {
        this.leaseProjectCache.delete(this.leaseProjectCache.keys().next().value!);
      }
      this.leaseProjectCache.set(cacheKey, projectId);
    }

    return projectId;
  }

  private notifyRealtimeForLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): void {
    const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
    if (projectId) {
      this.notifyRealtime(projectId, false);
    }
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
