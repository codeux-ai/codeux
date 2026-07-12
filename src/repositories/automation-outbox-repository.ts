import { createHash, randomUUID } from "node:crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import type { NodeFlowJsonObject } from "../contracts/node-flow-types.js";

export type AutomationOutboxStatus = "pending" | "sending" | "sent" | "failed" | "attention_required";
export interface AutomationOutboxRecord {
  id: string; idempotencyKey: string; projectId: string; flowId: string; publicationId: string;
  runId: string; nodeId: string; logicalItem: string; effectType: string; status: AutomationOutboxStatus;
  payload: NodeFlowJsonObject; providerMessageId: string | null; attemptCount: number;
  lastError: string | null; createdAt: string; updatedAt: string; sentAt: string | null;
}
interface OutboxRow {
  id: string; idempotency_key: string; project_id: string; flow_id: string; publication_id: string;
  run_id: string; node_id: string; logical_item: string; effect_type: string; status: AutomationOutboxStatus;
  payload_json: string; provider_message_id: string | null; attempt_count: number;
  last_error: string | null; created_at: string; updated_at: string; sent_at: string | null;
}

export function deriveOutboxIdempotencyKey(input: { publicationId: string; runId: string; nodeId: string; logicalItem: string }): string {
  return createHash("sha256").update([input.publicationId, input.runId, input.nodeId, input.logicalItem].join("\0")).digest("hex");
}

export class AutomationOutboxRepository {
  private readonly db: DatabaseAdapter;
  constructor(storage: AppDbStorage = new AppDbStorage()) { this.db = storage.getDatabase(); }

  enqueue(input: Omit<AutomationOutboxRecord, "id" | "idempotencyKey" | "status" | "providerMessageId" | "attemptCount" | "lastError" | "createdAt" | "updatedAt" | "sentAt">): AutomationOutboxRecord {
    const idempotencyKey = deriveOutboxIdempotencyKey(input);
    const existing = this.getByKey(idempotencyKey);
    if (existing) return existing;
    const id = randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO automation_outbox
      (id, idempotency_key, project_id, flow_id, publication_id, run_id, node_id, logical_item,
       effect_type, status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(id, idempotencyKey, input.projectId, input.flowId, input.publicationId, input.runId,
        input.nodeId, input.logicalItem, input.effectType, JSON.stringify(input.payload), now, now);
    return this.getByKey(idempotencyKey)!;
  }

  get(id: string): AutomationOutboxRecord | null {
    const row = this.db.prepare("SELECT * FROM automation_outbox WHERE id = ?").get(id) as OutboxRow | undefined;
    return row ? this.map(row) : null;
  }
  getByKey(key: string): AutomationOutboxRecord | null {
    const row = this.db.prepare("SELECT * FROM automation_outbox WHERE idempotency_key = ?").get(key) as OutboxRow | undefined;
    return row ? this.map(row) : null;
  }
  listForRun(runId: string): AutomationOutboxRecord[] {
    return (this.db.prepare("SELECT * FROM automation_outbox WHERE run_id = ? ORDER BY created_at").all(runId) as OutboxRow[]).map((row) => this.map(row));
  }
  claim(id: string): AutomationOutboxRecord | null {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE automation_outbox SET status = 'sending', attempt_count = attempt_count + 1,
      updated_at = ? WHERE id = ? AND status IN ('pending', 'failed')`).run(now, id);
    return result.changes > 0 ? this.get(id) : null;
  }
  markSent(id: string, providerMessageId: string): AutomationOutboxRecord {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE automation_outbox SET status = 'sent', provider_message_id = ?, last_error = NULL,
      sent_at = ?, updated_at = ? WHERE id = ?`).run(providerMessageId, now, now, id);
    return this.get(id)!;
  }
  markFailed(id: string, error: string, unknownOutcome = false): AutomationOutboxRecord {
    this.db.prepare("UPDATE automation_outbox SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(unknownOutcome ? "attention_required" : "failed", error, new Date().toISOString(), id);
    return this.get(id)!;
  }
  recoverSending(): number {
    return this.db.prepare(`UPDATE automation_outbox SET status = 'attention_required',
      last_error = COALESCE(last_error, 'Process restarted while provider outcome was unknown.'), updated_at = ?
      WHERE status = 'sending'`).run(new Date().toISOString()).changes;
  }
  private map(row: OutboxRow): AutomationOutboxRecord {
    return { id: row.id, idempotencyKey: row.idempotency_key, projectId: row.project_id,
      flowId: row.flow_id, publicationId: row.publication_id, runId: row.run_id, nodeId: row.node_id,
      logicalItem: row.logical_item, effectType: row.effect_type, status: row.status,
      payload: JSON.parse(row.payload_json) as NodeFlowJsonObject, providerMessageId: row.provider_message_id,
      attemptCount: Number(row.attempt_count), lastError: row.last_error, createdAt: row.created_at,
      updatedAt: row.updated_at, sentAt: row.sent_at };
  }
}
