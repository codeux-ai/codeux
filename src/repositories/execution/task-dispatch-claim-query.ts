import { DatabaseAdapter } from "../db/database-adapter.js";
import type { TaskDispatchRecord } from "../../contracts/execution-types.js";

export interface ClaimedTaskDispatchLease {
  dispatchId: string;
  leaseToken: string;
}

export function claimNextTaskDispatchTransaction(
  db: DatabaseAdapter,
  args: {
    projectId: string;
    executorType: TaskDispatchRecord["executorType"];
    connectionId?: string | null;
    ownerKey: string;
    leaseToken: string;
    leaseExpiresAt: string;
    sprintId?: string;
    sprintRunId?: string;
    nowIso: string;
  }
): ClaimedTaskDispatchLease | null {
  return db.transaction(() => {
    const clauses = ["project_id = ?", "executor_type = ?", "status = 'queued'"];
    const values: string[] = [args.projectId, args.executorType];

    if (args.sprintId) {
      clauses.push("sprint_id = ?");
      values.push(args.sprintId);
    }
    if (args.sprintRunId) {
      clauses.push("sprint_run_id = ?");
      values.push(args.sprintRunId);
    }

    const selectSql = `
      SELECT id
      FROM task_dispatches
      WHERE ${clauses.join(" AND ")}
        AND NOT EXISTS (
          SELECT 1
          FROM execution_leases el
          WHERE el.scope_type = 'task_dispatch'
            AND el.scope_id = task_dispatches.id
            AND el.expires_at > ?
        )
      ORDER BY priority DESC, queued_at ASC, created_at ASC
      LIMIT 1
    `;

    const row = db.prepare(selectSql).get(...values, args.nowIso) as { id: string } | undefined;
    if (!row) {
      return null;
    }

    const updateSql = `
      UPDATE task_dispatches
      SET connection_id = ?, status = 'claimed', claimed_at = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `;

    const result = db.prepare(updateSql).run(
      args.connectionId ?? null,
      args.nowIso,
      args.nowIso,
      args.nowIso,
      row.id
    );

    if (result.changes > 0) {
      db.prepare(`
        DELETE FROM execution_leases
        WHERE scope_type = 'task_dispatch'
          AND scope_id = ?
          AND expires_at <= ?
      `).run(row.id, args.nowIso);

      db.prepare(`
        INSERT INTO execution_leases (
          id,
          scope_type,
          scope_id,
          owner_key,
          lease_token,
          acquired_at,
          expires_at,
          last_heartbeat_at
        ) VALUES (?, 'task_dispatch', ?, ?, ?, ?, ?, ?)
      `).run(
        `${row.id}:${args.leaseToken}`,
        row.id,
        args.ownerKey,
        args.leaseToken,
        args.nowIso,
        args.leaseExpiresAt,
        args.nowIso,
      );

      return {
        dispatchId: row.id,
        leaseToken: args.leaseToken,
      };
    }

    // Someone else claimed it before us or status changed.
    return null;
  });
}
