import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import type {
  DashboardRealtimeEvent,
  DashboardRealtimeScopeType,
} from "../contracts/app-types.js";

interface DashboardRealtimeEventRow {
  sequence: number | string;
  scope_type: string;
  scope_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  sprint_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  dispatch_id: string | null;
  sprint_run_id: string | null;
  task_run_id: string | null;
  connection_id: string | null;
  correlation_id: string | null;
  is_replayable: number | string;
  payload_json: string | null;
  created_at: string;
}

export interface AppendDashboardRealtimeEventInput {
  scopeType: DashboardRealtimeScopeType;
  scopeId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  sprintId?: string | null;
  threadId?: string | null;
  taskId?: string | null;
  dispatchId?: string | null;
  sprintRunId?: string | null;
  taskRunId?: string | null;
  connectionId?: string | null;
  correlationId?: string | null;
  replayable?: boolean;
  payload?: unknown;
  emittedAt?: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

function parsePayload(value: string | null): unknown {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function buildScope(scopeType: DashboardRealtimeScopeType, scopeId: string): string {
  if (scopeType === "overview") {
    return "overview";
  }
  if (scopeType === "projects") {
    return "projects";
  }
  return `${scopeType}:${scopeId}`;
}

export function parseDashboardRealtimeScope(scope: string): {
  scopeType: DashboardRealtimeScopeType;
  scopeId: string;
} | null {
  const normalized = String(scope || "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized === "overview") {
    return { scopeType: "overview", scopeId: "overview" };
  }
  if (normalized === "projects") {
    return { scopeType: "projects", scopeId: "projects" };
  }

  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const scopeType = normalized.slice(0, separatorIndex).trim();
  const scopeId = normalized.slice(separatorIndex + 1).trim();
  if (!scopeId || (scopeType !== "project" && scopeType !== "thread")) {
    return null;
  }

  return {
    scopeType,
    scopeId,
  } as { scopeType: DashboardRealtimeScopeType; scopeId: string };
}

export class DashboardRealtimeEventRepository {
  private readonly db: DatabaseSync;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  appendEvent(input: AppendDashboardRealtimeEventInput): DashboardRealtimeEvent {
    const emittedAt = input.emittedAt || new Date().toISOString();
    const replayable = input.replayable !== false;
    const result = this.db.prepare(`
      INSERT INTO dashboard_realtime_events (
        scope_type,
        scope_id,
        event_type,
        entity_type,
        entity_id,
        project_id,
        sprint_id,
        thread_id,
        task_id,
        dispatch_id,
        sprint_run_id,
        task_run_id,
        connection_id,
        correlation_id,
        is_replayable,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.scopeType,
      input.scopeId,
      input.eventType,
      input.entityType,
      input.entityId,
      input.projectId ?? null,
      input.sprintId ?? null,
      input.threadId ?? null,
      input.taskId ?? null,
      input.dispatchId ?? null,
      input.sprintRunId ?? null,
      input.taskRunId ?? null,
      input.connectionId ?? null,
      input.correlationId ?? null,
      Number(replayable),
      replayable && input.payload !== undefined ? JSON.stringify(input.payload) : null,
      emittedAt,
    );

    return this.buildEvent(
      Number((result as { lastInsertRowid?: number | bigint }).lastInsertRowid ?? 0),
      input,
      emittedAt,
    );
  }

  private buildScopePredicates(count: number): string {
    return Array(count).fill("(scope_type = ? AND scope_id = ?)").join(" OR ");
  }

  private buildScopeValues(scopes: { scopeType: string; scopeId: string }[]): string[] {
    const values: string[] = [];
    for (const scope of scopes) {
      values.push(scope.scopeType, scope.scopeId);
    }
    return values;
  }

  listEventsSince(scopes: string[], afterSequence: number, limit: number = 200): DashboardRealtimeEvent[] {
    const parsedScopes = this.parseScopes(scopes);

    if (parsedScopes.length === 0) {
      return [];
    }

    const predicates = this.buildScopePredicates(parsedScopes.length);
    const values: Array<string | number> = [
      Math.max(0, afterSequence),
      ...this.buildScopeValues(parsedScopes),
      Math.max(1, limit),
    ];

    const rows = this.db.prepare(`
      SELECT *
      FROM dashboard_realtime_events
      WHERE sequence > ?
        AND is_replayable = 1
        AND (${predicates})
      ORDER BY sequence ASC
      LIMIT ?
    `).all(...values) as unknown as DashboardRealtimeEventRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getLatestSequenceForScopes(scopes: string[]): number | null {
    const parsedScopes = this.parseScopes(scopes);
    if (parsedScopes.length === 0) {
      return null;
    }

    const predicates = this.buildScopePredicates(parsedScopes.length);
    const values = this.buildScopeValues(parsedScopes);

    const row = this.db.prepare(`
      SELECT MAX(sequence) AS max_sequence
      FROM dashboard_realtime_events
      WHERE ${predicates}
    `).get(...values) as { max_sequence?: number | string | null } | undefined;

    if (!row || row.max_sequence === null || row.max_sequence === undefined) {
      return null;
    }

    return toNumber(row.max_sequence);
  }

  hasNonReplayableEventsSince(scopes: string[], afterSequence: number): boolean {
    const parsedScopes = this.parseScopes(scopes);
    if (parsedScopes.length === 0) {
      return false;
    }

    const predicates = this.buildScopePredicates(parsedScopes.length);
    const values: Array<string | number> = [
      Math.max(0, afterSequence),
      ...this.buildScopeValues(parsedScopes),
    ];

    const row = this.db.prepare(`
      SELECT 1 AS has_match
      FROM dashboard_realtime_events
      WHERE sequence > ?
        AND is_replayable = 0
        AND (${predicates})
      LIMIT 1
    `).get(...values) as { has_match?: number | string } | undefined;

    return row !== undefined;
  }

  getLatestSequence(): number | null {
    const row = this.db.prepare(`
      SELECT MAX(sequence) AS max_sequence
      FROM dashboard_realtime_events
    `).get() as { max_sequence?: number | string | null } | undefined;

    if (!row || row.max_sequence === null || row.max_sequence === undefined) {
      return null;
    }

    return toNumber(row.max_sequence);
  }

  private mapRow(row: DashboardRealtimeEventRow): DashboardRealtimeEvent {
    return this.buildEvent(
      toNumber(row.sequence),
      {
        scopeType: row.scope_type as DashboardRealtimeScopeType,
        scopeId: row.scope_id,
        eventType: row.event_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        projectId: row.project_id,
        sprintId: row.sprint_id,
        threadId: row.thread_id,
        taskId: row.task_id,
        dispatchId: row.dispatch_id,
        sprintRunId: row.sprint_run_id,
        taskRunId: row.task_run_id,
        connectionId: row.connection_id,
        correlationId: row.correlation_id,
        payload: parsePayload(row.payload_json),
      },
      row.created_at,
    );
  }

  private buildEvent(
    sequence: number,
    input: Omit<AppendDashboardRealtimeEventInput, "emittedAt">,
    emittedAt: string,
  ): DashboardRealtimeEvent {
    return {
      sequence,
      emittedAt,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      scope: buildScope(input.scopeType, input.scopeId),
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId ?? null,
      sprintId: input.sprintId ?? null,
      threadId: input.threadId ?? null,
      taskId: input.taskId ?? null,
      dispatchId: input.dispatchId ?? null,
      sprintRunId: input.sprintRunId ?? null,
      taskRunId: input.taskRunId ?? null,
      connectionId: input.connectionId ?? null,
      correlationId: input.correlationId ?? null,
      payload: input.payload ?? null,
    };
  }

  private parseScopes(scopes: string[]): Array<{ scopeType: DashboardRealtimeScopeType; scopeId: string }> {
    return scopes
      .map((scope) => parseDashboardRealtimeScope(scope))
      .filter((scope): scope is { scopeType: DashboardRealtimeScopeType; scopeId: string } => scope !== null);
  }
}
