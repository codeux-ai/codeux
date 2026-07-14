import { randomUUID } from "node:crypto";
import type {
  AutomationAuditRecord,
  AuditOutcome,
  CodeUxPrincipal,
} from "../contracts/headless-security-types.js";
import type { AppDbStorage } from "../repositories/app-db-storage.js";
import type { DatabaseAdapter } from "../repositories/db/database-adapter.js";
import { redactMetadata } from "../shared/security/redaction.js";
import { getCorrelationId, generateCorrelationId } from "../shared/logging/correlation-id.js";

interface AuditRow {
  id: string;
  occurred_at: string;
  correlation_id: string;
  principal_id: string;
  principal_kind: AutomationAuditRecord["principalKind"];
  action: string;
  resource_type: string;
  resource_id: string | null;
  project_id: string | null;
  outcome: AuditOutcome;
  metadata_json: string;
}

export interface RecordAutomationAuditInput {
  correlationId: string;
  principal: CodeUxPrincipal;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  projectId?: string | null;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
}

export class AutomationAuditExportService {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage) {
    this.db = storage.getDatabase();
  }

  health(): boolean {
    try {
      this.db.prepare("SELECT 1 FROM automation_audit_records LIMIT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  record(input: RecordAutomationAuditInput): AutomationAuditRecord {
    const record: AutomationAuditRecord = {
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      correlationId: input.correlationId,
      principalId: input.principal.id,
      principalKind: input.principal.kind,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      projectId: input.projectId ?? null,
      outcome: input.outcome,
      metadata: redactMetadata(input.metadata ?? {}) as Record<string, unknown>,
    };
    this.db.prepare(`
      INSERT INTO automation_audit_records (
        id, occurred_at, correlation_id, principal_id, principal_kind, action,
        resource_type, resource_id, project_id, outcome, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.occurredAt,
      record.correlationId,
      record.principalId,
      record.principalKind,
      record.action,
      record.resourceType,
      record.resourceId,
      record.projectId,
      record.outcome,
      JSON.stringify(record.metadata),
    );
    return record;
  }

  recordSystem(input: Omit<RecordAutomationAuditInput, "correlationId" | "principal"> & { principalId?: string }): AutomationAuditRecord {
    return this.record({
      ...input,
      correlationId: getCorrelationId() ?? generateCorrelationId(),
      principal: {
        id: input.principalId ?? "code-ux-runtime",
        displayName: "Code UX runtime",
        kind: "service",
        roles: ["automation_runner"],
        projectIds: input.projectId ? [input.projectId] : [],
        authenticatedAt: new Date().toISOString(),
        authenticationMethod: "service_token",
      },
    });
  }

  list(input: { projectId?: string; since?: string; limit?: number } = {}): AutomationAuditRecord[] {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (input.projectId) {
      clauses.push("project_id = ?");
      parameters.push(input.projectId);
    }
    if (input.since) {
      clauses.push("occurred_at >= ?");
      parameters.push(input.since);
    }
    const limit = Math.min(10_000, Math.max(1, input.limit ?? 1_000));
    parameters.push(limit);
    const rows = this.db.prepare(`
      SELECT * FROM automation_audit_records
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY occurred_at ASC, id ASC
      LIMIT ?
    `).all(...parameters) as AuditRow[];
    return rows.map((row) => this.map(row));
  }

  exportNdjson(input: { projectId?: string; since?: string; limit?: number } = {}): string {
    const lines = this.list(input).map((record) => JSON.stringify(record));
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }

  private map(row: AuditRow): AutomationAuditRecord {
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      correlationId: row.correlation_id,
      principalId: row.principal_id,
      principalKind: row.principal_kind,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      projectId: row.project_id,
      outcome: row.outcome,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    };
  }
}
