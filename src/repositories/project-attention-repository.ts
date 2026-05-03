import { randomUUID } from "crypto";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import { executeChunkedInQuery } from "./repository-utils.js";
import { requireRecord } from "./repository-utils.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import type {
  ProjectAttentionItemRecord,
  ProjectAttentionOwnerType,
  ProjectAttentionSeverity,
  ProjectAttentionStatus,
  ProjectAttentionType,
} from "../contracts/project-attention-types.js";

interface ProjectAttentionItemRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  task_id: string | null;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  assigned_worker_endpoint_id: string | null;
  title: string;
  summary_markdown: string;
  payload_json: string | null;
  opened_at: string;
  claimed_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function serializePayload(payload?: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }
  return JSON.stringify(payload);
}

export interface OpenProjectAttentionItemInput {
  projectId: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  attentionType: ProjectAttentionType;
  severity: ProjectAttentionSeverity;
  ownerType: ProjectAttentionOwnerType;
  assignedWorkerEndpointId?: string | null;
  title: string;
  summaryMarkdown: string;
  payload?: Record<string, unknown> | null;
}

export interface ResolveProjectAttentionItemsFilter {
  projectId?: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  attentionTypes?: ProjectAttentionType[];
}

export interface ClaimProjectAttentionItemInput {
  assignedWorkerEndpointId: string;
  claimReason?: string;
}

export interface ResolveProjectAttentionItemInput {
  status?: Extract<ProjectAttentionStatus, "resolved" | "dismissed" | "expired">;
  reason?: string;
  resolutionSummaryMarkdown?: string;
  resolvedByWorkerEndpointId?: string | null;
  payloadPatch?: Record<string, unknown> | null;
}

export class ProjectAttentionRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }

  listProjectAttentionItems(
    projectId: string,
    options?: { statuses?: ProjectAttentionStatus[]; limit?: number },
  ): ProjectAttentionItemRecord[] {
    const statuses = (options?.statuses || []).filter(Boolean);
    const statusClause = statuses.length > 0
      ? `AND status IN (${statuses.map(() => "?").join(", ")})`
      : "";
    const rows = this.db.prepare(`
      SELECT *
      FROM project_attention_items
      WHERE project_id = ?
        ${statusClause}
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        opened_at DESC,
        id DESC
      LIMIT ?
    `).all(projectId, ...statuses, Math.max(1, options?.limit || 50)) as unknown as ProjectAttentionItemRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getAttentionItem(itemId: string): ProjectAttentionItemRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM project_attention_items
      WHERE id = ?
    `).get(itemId) as ProjectAttentionItemRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  openOrRefreshItems(inputs: OpenProjectAttentionItemInput[]): ProjectAttentionItemRecord[] {
    if (inputs.length === 0) return [];

    return this.db.transaction(() => {
      const results: ProjectAttentionItemRecord[] = [];
      const now = new Date().toISOString();
      const updatedProjectIds = new Set<string>();

      for (const input of inputs) {
        const existing = this.findActiveDuplicate(input);
        let itemId: string;

        if (existing) {
          this.db.prepare(`
            UPDATE project_attention_items
            SET severity = ?,
                assigned_worker_endpoint_id = ?,
                title = ?,
                summary_markdown = ?,
                payload_json = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            input.severity,
            input.assignedWorkerEndpointId ?? existing.assignedWorkerEndpointId,
            input.title.trim(),
            input.summaryMarkdown.trim(),
            serializePayload(input.payload),
            now,
            existing.id,
          );
          itemId = existing.id;
        } else {
          itemId = randomUUID();
          this.db.prepare(`
            INSERT INTO project_attention_items (
              id,
              project_id,
              sprint_id,
              task_id,
              sprint_run_id,
              dispatch_id,
              attention_type,
              severity,
              owner_type,
              status,
              assigned_worker_endpoint_id,
              title,
              summary_markdown,
              payload_json,
              opened_at,
              claimed_at,
              resolved_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL, NULL, ?)
          `).run(
            itemId,
            input.projectId,
            input.sprintId ?? null,
            input.taskId ?? null,
            input.sprintRunId ?? null,
            input.dispatchId ?? null,
            input.attentionType,
            input.severity,
            input.ownerType,
            input.assignedWorkerEndpointId ?? null,
            input.title.trim(),
            input.summaryMarkdown.trim(),
            serializePayload(input.payload),
            now,
            now,
          );
        }

        const item = this.mapRow(requireRecord(this.db.prepare('SELECT * FROM project_attention_items WHERE id = ?').get(itemId) as any, "Project attention item", itemId));
        results.push(item);
        updatedProjectIds.add(item.projectId);
      }

      for (const projectId of updatedProjectIds) {
        this.notifyProjectRefresh(projectId, true);
      }

      return results;
    });
  }

  openItems(inputs: OpenProjectAttentionItemInput[]): ProjectAttentionItemRecord[] {
    return this.openOrRefreshItems(inputs);
  }

  openOrRefreshItem(input: OpenProjectAttentionItemInput): ProjectAttentionItemRecord {
    const results = this.openOrRefreshItems([input]);
    return results[0];
  }

  resolveAttentionItemsForDispatch(dispatchId: string, resolution: { status?: Extract<ProjectAttentionStatus, "resolved" | "dismissed" | "expired">; reason?: string }): number {
    return this.resolveAttentionItems(
      {
        dispatchId,
      },
      resolution,
    );
  }

  resolveItemsBatch(
    inputs: Array<{ filter: ResolveProjectAttentionItemsFilter; resolution: { status?: Extract<ProjectAttentionStatus, "resolved" | "dismissed" | "expired">; reason?: string } }>,
  ): number {
    if (inputs.length === 0) return 0;

    return this.db.transaction(() => {
      let totalAffectedRows = 0;
      const updatedProjectIds = new Set<string>();
      const now = new Date().toISOString();

      for (const input of inputs) {
        const { clause, params } = this.buildResolveFilter(input.filter);
        const rows = this.db.prepare(`
          SELECT id, project_id
          FROM project_attention_items
          WHERE status IN ('open', 'claimed')
            ${clause}
        `).all(...params) as Array<{ id: string; project_id: string }>;

        if (rows.length === 0) {
          continue;
        }

        const status = input.resolution.status || "resolved";

        executeChunkedInQuery((sql) => this.db.prepare(sql), {
          sqlPrefix: `
            UPDATE project_attention_items
            SET status = ?,
                resolved_at = ?,
                updated_at = ?,
                payload_json = CASE
                  WHEN payload_json IS NULL THEN json_object('resolutionReason', ?)
                  ELSE json_set(payload_json, '$.resolutionReason', ?)
                END
            WHERE id
          `,
          items: rows.map(r => r.id),
          bindParamsBefore: [status, now, now, input.resolution.reason ?? null, input.resolution.reason ?? null]
        });

        totalAffectedRows += rows.length;
        for (const row of rows) {
          if (row.project_id) {
            updatedProjectIds.add(row.project_id);
          }
        }
      }

      for (const projectId of updatedProjectIds) {
        this.notifyProjectRefresh(projectId, true);
      }

      return totalAffectedRows;
    });
  }

  resolveAttentionItems(
    filter: ResolveProjectAttentionItemsFilter,
    resolution: { status?: Extract<ProjectAttentionStatus, "resolved" | "dismissed" | "expired">; reason?: string },
  ): number {
    return this.resolveItemsBatch([{ filter, resolution }]);
  }


  claimAttentionItem(itemId: string, input: ClaimProjectAttentionItemInput): ProjectAttentionItemRecord {
    const current = this.mapRow(requireRecord(this.db.prepare('SELECT * FROM project_attention_items WHERE id = ?').get(itemId) as any, "Project attention item", itemId));
    if (current.status === "resolved" || current.status === "dismissed" || current.status === "expired") {
      throw new Error(`Attention item ${itemId} is already closed.`);
    }
    if (current.ownerType !== "worker") {
      throw new Error(`Attention item ${itemId} is not worker-claimable.`);
    }
    if (current.assignedWorkerEndpointId && current.assignedWorkerEndpointId !== input.assignedWorkerEndpointId) {
      throw new Error(`Attention item ${itemId} is assigned to another worker endpoint.`);
    }

    const now = new Date().toISOString();
    const nextPayload = {
      ...(current.payload || {}),
      claimedByWorkerEndpointId: input.assignedWorkerEndpointId,
      claimReason: input.claimReason ?? (current.payload || {}).claimReason ?? null,
    };

    this.db.prepare(`
      UPDATE project_attention_items
      SET status = 'claimed',
          assigned_worker_endpoint_id = ?,
          claimed_at = COALESCE(claimed_at, ?),
          updated_at = ?,
          payload_json = ?
      WHERE id = ?
    `).run(
      input.assignedWorkerEndpointId,
      now,
      now,
      serializePayload(nextPayload),
      itemId,
    );

    return this.requireAndNotifyItem(itemId, current.projectId, true);
  }

  resolveAttentionItem(itemId: string, input: ResolveProjectAttentionItemInput): ProjectAttentionItemRecord {
    const current = this.mapRow(requireRecord(this.db.prepare('SELECT * FROM project_attention_items WHERE id = ?').get(itemId) as any, "Project attention item", itemId));
    if (current.status === "resolved" || current.status === "dismissed" || current.status === "expired") {
      return current;
    }

    const now = new Date().toISOString();
    const nextPayload = {
      ...(current.payload || {}),
      resolutionReason: input.reason ?? (current.payload || {}).resolutionReason ?? null,
      resolvedByWorkerEndpointId: input.resolvedByWorkerEndpointId ?? (current.payload || {}).resolvedByWorkerEndpointId ?? null,
      ...(input.payloadPatch || {}),
    };

    this.db.prepare(`
      UPDATE project_attention_items
      SET status = ?,
          resolved_at = ?,
          updated_at = ?,
          summary_markdown = ?,
          payload_json = ?
      WHERE id = ?
    `).run(
      input.status || "resolved",
      now,
      now,
      input.resolutionSummaryMarkdown?.trim() || current.summaryMarkdown,
      serializePayload(nextPayload),
      itemId,
    );

    return this.requireAndNotifyItem(itemId, current.projectId, true);
  }

  private requireAndNotifyItem(itemId: string, projectId: string, includeOverview: boolean): ProjectAttentionItemRecord {
    const item = this.mapRow(requireRecord(this.db.prepare('SELECT * FROM project_attention_items WHERE id = ?').get(itemId) as any, "Project attention item", itemId));
    this.notifyProjectRefresh(projectId, includeOverview);
    return item;
  }

  private notifyProjectRefresh(projectId: string | undefined, includeOverview: boolean): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }
    this.realtimeNotifier?.scheduleProjectExecutionRefresh(normalizedProjectId, {
      includeOverview,
      includeProjects: false,
    });
  }

  private buildResolveFilter(filter: ResolveProjectAttentionItemsFilter): { clause: string; params: Array<string | null> } {
    const conditions: string[] = [];
    const params: Array<string | null> = [];

    if (filter.projectId) {
      conditions.push("AND project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.sprintId !== undefined) {
      conditions.push("AND COALESCE(sprint_id, '') = COALESCE(?, '')");
      params.push(filter.sprintId ?? null);
    }
    if (filter.taskId !== undefined) {
      conditions.push("AND COALESCE(task_id, '') = COALESCE(?, '')");
      params.push(filter.taskId ?? null);
    }
    if (filter.sprintRunId !== undefined) {
      conditions.push("AND COALESCE(sprint_run_id, '') = COALESCE(?, '')");
      params.push(filter.sprintRunId ?? null);
    }
    if (filter.dispatchId !== undefined) {
      conditions.push("AND COALESCE(dispatch_id, '') = COALESCE(?, '')");
      params.push(filter.dispatchId ?? null);
    }
    if (filter.attentionTypes && filter.attentionTypes.length > 0) {
      conditions.push(`AND attention_type IN (${filter.attentionTypes.map(() => "?").join(", ")})`);
      params.push(...filter.attentionTypes);
    }

    return {
      clause: conditions.join("\n        "),
      params,
    };
  }

  private findActiveDuplicate(input: OpenProjectAttentionItemInput): ProjectAttentionItemRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM project_attention_items
      WHERE project_id = ?
        AND COALESCE(sprint_id, '') = COALESCE(?, '')
        AND COALESCE(task_id, '') = COALESCE(?, '')
        AND COALESCE(sprint_run_id, '') = COALESCE(?, '')
        AND COALESCE(dispatch_id, '') = COALESCE(?, '')
        AND attention_type = ?
        AND owner_type = ?
        AND status IN ('open', 'claimed')
      LIMIT 1
    `).get(
      input.projectId,
      input.sprintId ?? null,
      input.taskId ?? null,
      input.sprintRunId ?? null,
      input.dispatchId ?? null,
      input.attentionType,
      input.ownerType,
    ) as ProjectAttentionItemRow | undefined;

    return row ? this.mapRow(row) : null;
  }


  private mapRow(row: ProjectAttentionItemRow): ProjectAttentionItemRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      attentionType: row.attention_type as ProjectAttentionType,
      severity: row.severity as ProjectAttentionSeverity,
      ownerType: row.owner_type as ProjectAttentionOwnerType,
      status: row.status as ProjectAttentionStatus,
      assignedWorkerEndpointId: row.assigned_worker_endpoint_id,
      title: row.title,
      summaryMarkdown: row.summary_markdown,
      payload: parsePayload(row.payload_json),
      openedAt: row.opened_at,
      claimedAt: row.claimed_at,
      resolvedAt: row.resolved_at,
      updatedAt: row.updated_at,
    };
  }
}
