import { DatabaseAdapter } from "../db/database-adapter.js";
import type { TaskDispatchRecord } from "../../contracts/execution-types.js";

export function claimNextTaskDispatchTransaction(
  db: DatabaseAdapter,
  args: {
    projectId: string;
    executorType: TaskDispatchRecord["executorType"];
    connectionId?: string | null;
    sprintId?: string;
    sprintRunId?: string;
    nowIso: string;
  }
): string | null {
  return db.transaction(() => {
    const clauses = ["project_id = ?", "executor_type = ?", "status = 'queued'"];
    const values: any[] = [args.projectId, args.executorType];

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
      ORDER BY priority DESC, queued_at ASC, created_at ASC
      LIMIT 1
    `;

    const row = db.prepare(selectSql).get(...values) as { id: string } | undefined;
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
      return row.id;
    }

    // Someone else claimed it before us or status changed.
    return null;
  });
}
