import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { toNumber } from "./repository-utils.js";
import type { GuardrailJobType } from "../contracts/app-types.js";
import { GUARDRAIL_JOB_TYPES } from "./settings-defaults.js";

/**
 * Purposes recorded in the ledger. A superset of {@link GuardrailJobType} that also
 * includes `qa_review` — QA is capped via the dedicated `qaRunsCap` setting (kept out
 * of `GuardrailJobType` to avoid colliding with `agents.qualityAssurance.maxTaskReviewRuns`)
 * but is still tracked in the same ledger for visibility and resets.
 */
export type GuardrailLedgerPurpose = GuardrailJobType | "qa_review";

export interface GuardrailRefundResult {
  applied: boolean;
  count: number;
}

export interface GuardrailRecordResult {
  applied: boolean;
  count: number;
}

export const GUARDRAIL_LEDGER_PURPOSES: GuardrailLedgerPurpose[] = [...GUARDRAIL_JOB_TYPES, "qa_review"];

interface GuardrailLedgerRow {
  purpose: string;
  count: number | string | null;
}

/**
 * Persistent per-task ledger of guardrail-tracked job invocations. Keyed by
 * (task_id, purpose); the single source of truth for how many times each agent
 * job type has been started for a task. Replaces the legacy in-memory retry Maps.
 */
export class GuardrailRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  /**
   * Atomically increments the counter for (taskId, purpose) and returns the new count.
   * The first invocation yields 1.
   */
  record(input: { projectId: string; taskId: string; purpose: GuardrailLedgerPurpose }): number {
    const now = new Date().toISOString();
    const id = `gr_${randomUUID().replace(/-/g, "")}`;
    this.db.prepare(`
      INSERT INTO guardrail_ledger (id, project_id, task_id, purpose, count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(task_id, purpose) DO UPDATE SET
        count = count + 1,
        updated_at = excluded.updated_at
    `).run(id, input.projectId, input.taskId, input.purpose, now, now);
    return this.getCount(input.taskId, input.purpose);
  }

  /**
   * Atomically records an invocation once for a durable attempt key. Replaying the
   * same provider attempt after a process restart returns the existing count.
   */
  recordOnce(input: {
    projectId: string;
    taskId: string;
    purpose: GuardrailLedgerPurpose;
    sourceKey: string;
    reason?: string;
  }): GuardrailRecordResult {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const inserted = this.db.prepare(`
        INSERT OR IGNORE INTO guardrail_ledger_adjustments
          (id, project_id, task_id, purpose, adjustment, source_key, reason, created_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        `gra_${randomUUID().replace(/-/g, "")}`,
        input.projectId,
        input.taskId,
        input.purpose,
        input.sourceKey,
        input.reason ?? null,
        now,
      ).changes > 0;
      if (inserted) {
        const id = `gr_${randomUUID().replace(/-/g, "")}`;
        this.db.prepare(`
          INSERT INTO guardrail_ledger (id, project_id, task_id, purpose, count, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(task_id, purpose) DO UPDATE SET
            count = count + 1,
            updated_at = excluded.updated_at
        `).run(id, input.projectId, input.taskId, input.purpose, now, now);
      }
      return { applied: inserted, count: this.getCount(input.taskId, input.purpose) };
    });
  }

  /**
   * Atomically refunds one recorded invocation exactly once. Operational recovery uses the
   * interrupted task-run id as `sourceKey`, preventing repeated startup passes from reducing
   * a task's real attempt count more than once.
   */
  refund(input: {
    projectId: string;
    taskId: string;
    purpose: GuardrailLedgerPurpose;
    sourceKey: string;
    reason?: string;
  }): GuardrailRefundResult {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const inserted = this.db.prepare(`
        INSERT OR IGNORE INTO guardrail_ledger_adjustments
          (id, project_id, task_id, purpose, adjustment, source_key, reason, created_at)
        VALUES (?, ?, ?, ?, -1, ?, ?, ?)
      `).run(
        `gra_${randomUUID().replace(/-/g, "")}`,
        input.projectId,
        input.taskId,
        input.purpose,
        input.sourceKey,
        input.reason ?? null,
        now,
      ).changes > 0;
      if (inserted) {
        this.db.prepare(`
          UPDATE guardrail_ledger
          SET count = MAX(0, count - 1), updated_at = ?
          WHERE task_id = ? AND purpose = ?
        `).run(now, input.taskId, input.purpose);
      }
      return { applied: inserted, count: this.getCount(input.taskId, input.purpose) };
    });
  }

  getCount(taskId: string, purpose: GuardrailLedgerPurpose): number {
    const row = this.db.prepare(`
      SELECT count FROM guardrail_ledger WHERE task_id = ? AND purpose = ?
    `).get(taskId, purpose) as { count: number | string | null } | undefined;
    return row ? toNumber(row.count) : 0;
  }

  getCounts(taskId: string): Record<GuardrailLedgerPurpose, number> {
    const rows = this.db.prepare(`
      SELECT purpose, count FROM guardrail_ledger WHERE task_id = ?
    `).all(taskId) as unknown as GuardrailLedgerRow[];
    const counts = GUARDRAIL_LEDGER_PURPOSES.reduce((acc, purpose) => {
      acc[purpose] = 0;
      return acc;
    }, {} as Record<GuardrailLedgerPurpose, number>);
    for (const row of rows) {
      if ((GUARDRAIL_LEDGER_PURPOSES as string[]).includes(row.purpose)) {
        counts[row.purpose as GuardrailLedgerPurpose] = toNumber(row.count);
      }
    }
    return counts;
  }

  getTotal(taskId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(count), 0) AS total FROM guardrail_ledger WHERE task_id = ?
    `).get(taskId) as { total: number | string | null } | undefined;
    return row ? toNumber(row.total) : 0;
  }

  reset(taskId: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM guardrail_ledger_adjustments WHERE task_id = ?`).run(taskId);
      this.db.prepare(`DELETE FROM guardrail_ledger WHERE task_id = ?`).run(taskId);
    });
  }

  resetPurpose(taskId: string, purpose: GuardrailLedgerPurpose): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM guardrail_ledger_adjustments WHERE task_id = ? AND purpose = ?`).run(taskId, purpose);
      this.db.prepare(`DELETE FROM guardrail_ledger WHERE task_id = ? AND purpose = ?`).run(taskId, purpose);
    });
  }
}
