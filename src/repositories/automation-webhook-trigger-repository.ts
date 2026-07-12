import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, ValidationError } from "./repository-utils.js";

export interface AutomationWebhookTriggerRecord {
  id: string; projectId: string; flowId: string; enabled: boolean;
  createdAt: string; updatedAt: string; lastTriggeredAt: string | null;
}
interface WebhookRow { id: string; project_id: string; flow_id: string; path_token_hash: string; secret_hash: string; enabled: number; created_at: string; updated_at: string; last_triggered_at: string | null }
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export class AutomationWebhookTriggerRepository {
  private readonly db: DatabaseAdapter;
  constructor(storage: AppDbStorage = new AppDbStorage()) { this.db = storage.getDatabase(); }
  create(projectId: string, flowId: string): { trigger: AutomationWebhookTriggerRecord; pathToken: string; secret: string } {
    const flow = this.db.prepare("SELECT project_id FROM node_flows WHERE id = ?").get(flowId) as { project_id: string } | undefined;
    if (!flow) throw new EntityNotFoundError(`Node flow not found: ${flowId}`);
    if (flow.project_id !== projectId) throw new ValidationError("Node flow does not belong to the requested project.");
    const pathToken = randomBytes(24).toString("base64url"); const secret = randomBytes(32).toString("base64url");
    const id = randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO automation_webhook_triggers
      (id, project_id, flow_id, path_token_hash, secret_hash, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(project_id, flow_id) DO UPDATE SET path_token_hash=excluded.path_token_hash,
      secret_hash=excluded.secret_hash, enabled=1, updated_at=excluded.updated_at`)
      .run(id, projectId, flowId, digest(pathToken), digest(secret), now, now);
    return { trigger: this.getByFlow(flowId)!, pathToken, secret };
  }
  getByFlow(flowId: string): AutomationWebhookTriggerRecord | null {
    const row = this.db.prepare("SELECT * FROM automation_webhook_triggers WHERE flow_id = ?").get(flowId) as WebhookRow | undefined;
    return row ? this.map(row) : null;
  }
  authenticate(pathToken: string, secret: string): AutomationWebhookTriggerRecord | null {
    const row = this.db.prepare("SELECT * FROM automation_webhook_triggers WHERE path_token_hash = ? AND enabled = 1")
      .get(digest(pathToken)) as WebhookRow | undefined;
    if (!row) return null;
    const expected = Buffer.from(row.secret_hash, "hex"); const actual = Buffer.from(digest(secret), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    this.db.prepare("UPDATE automation_webhook_triggers SET last_triggered_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), row.id);
    return this.map(row);
  }
  setEnabled(flowId: string, enabled: boolean): AutomationWebhookTriggerRecord {
    this.db.prepare("UPDATE automation_webhook_triggers SET enabled = ?, updated_at = ? WHERE flow_id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), flowId);
    const record = this.getByFlow(flowId); if (!record) throw new EntityNotFoundError(`Webhook trigger not found for flow: ${flowId}`);
    return record;
  }
  private map(row: WebhookRow): AutomationWebhookTriggerRecord { return { id: row.id, projectId: row.project_id, flowId: row.flow_id, enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at, lastTriggeredAt: row.last_triggered_at }; }
}
