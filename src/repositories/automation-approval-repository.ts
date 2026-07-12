import { randomUUID } from "node:crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, ValidationError } from "./repository-utils.js";
import type { NodeFlowJsonObject } from "../contracts/node-flow-types.js";

export type AutomationApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface AutomationApprovalRecord {
  id: string;
  projectId: string;
  flowId: string;
  runId: string;
  nodeId: string;
  logicalItem: string;
  status: AutomationApprovalStatus;
  request: NodeFlowJsonObject;
  decision: NodeFlowJsonObject | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalRow {
  id: string; project_id: string; flow_id: string; run_id: string; node_id: string;
  logical_item: string; status: AutomationApprovalStatus; request_json: string;
  decision_json: string | null; requested_at: string; decided_at: string | null;
  decided_by: string | null; expires_at: string | null; created_at: string; updated_at: string;
}

export class AutomationApprovalRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  request(input: {
    projectId: string; flowId: string; runId: string; nodeId: string;
    logicalItem: string; request: NodeFlowJsonObject; expiresAt?: string | null;
  }): AutomationApprovalRecord {
    const logicalItem = input.logicalItem.trim() || "default";
    const existing = this.getForItem(input.runId, input.nodeId, logicalItem);
    if (existing) return existing;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO automation_approvals
      (id, project_id, flow_id, run_id, node_id, logical_item, status, request_json,
       requested_at, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
      .run(id, input.projectId, input.flowId, input.runId, input.nodeId, logicalItem,
        JSON.stringify(input.request), now, input.expiresAt ?? null, now, now);
    return this.require(id);
  }

  get(id: string): AutomationApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM automation_approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
    return row ? this.map(row) : null;
  }

  getForItem(runId: string, nodeId: string, logicalItem = "default"): AutomationApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM automation_approvals WHERE run_id = ? AND node_id = ? AND logical_item = ?")
      .get(runId, nodeId, logicalItem) as ApprovalRow | undefined;
    return row ? this.map(row) : null;
  }

  listForRun(runId: string): AutomationApprovalRecord[] {
    return (this.db.prepare("SELECT * FROM automation_approvals WHERE run_id = ? ORDER BY created_at").all(runId) as ApprovalRow[])
      .map((row) => this.map(row));
  }

  decide(id: string, input: { status: "approved" | "rejected"; decidedBy: string; decision?: NodeFlowJsonObject }): AutomationApprovalRecord {
    const current = this.require(id);
    if (current.status !== "pending") {
      if (current.status === input.status) return current;
      throw new ValidationError(`Approval ${id} has already been decided.`);
    }
    const decidedBy = input.decidedBy.trim();
    if (!decidedBy) throw new ValidationError("decidedBy is required.");
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE automation_approvals SET status = ?, decision_json = ?, decided_at = ?,
      decided_by = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(input.status, JSON.stringify(input.decision ?? {}), now, decidedBy, now, id);
    return this.require(id);
  }

  expireDue(now = new Date()): number {
    return this.db.prepare(`UPDATE automation_approvals SET status = 'expired', updated_at = ?
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`)
      .run(now.toISOString(), now.toISOString()).changes;
  }

  private require(id: string): AutomationApprovalRecord {
    const record = this.get(id);
    if (!record) throw new EntityNotFoundError(`Automation approval not found: ${id}`);
    return record;
  }

  private map(row: ApprovalRow): AutomationApprovalRecord {
    return {
      id: row.id, projectId: row.project_id, flowId: row.flow_id, runId: row.run_id,
      nodeId: row.node_id, logicalItem: row.logical_item, status: row.status,
      request: JSON.parse(row.request_json) as NodeFlowJsonObject,
      decision: row.decision_json ? JSON.parse(row.decision_json) as NodeFlowJsonObject : null,
      requestedAt: row.requested_at, decidedAt: row.decided_at, decidedBy: row.decided_by,
      expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
