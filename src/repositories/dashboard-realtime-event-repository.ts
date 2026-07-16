import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import { toNumber } from "./repository-utils.js";
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

function isConversationRealtimeEvent(eventType: string): boolean {
  return String(eventType || "").startsWith("conversation.");
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

function getDashboardRealtimeEventRoutingScopes(
  event: Pick<DashboardRealtimeEvent, "scope" | "eventType" | "projectId" | "threadId">,
): string[] {
  const scopes = new Set<string>([event.scope]);
  if (isConversationRealtimeEvent(event.eventType)) {
    if (event.projectId) {
      scopes.add(`project:${event.projectId}`);
    }
    if (event.threadId) {
      scopes.add(`thread:${event.threadId}`);
    }
  }
  return [...scopes];
}

export function resolveDashboardRealtimeEventScope(
  event: DashboardRealtimeEvent,
  subscribedScopes: Iterable<string>,
): string | null {
  const subscriptions = subscribedScopes instanceof Set
    ? subscribedScopes
    : new Set(subscribedScopes);

  for (const scope of getDashboardRealtimeEventRoutingScopes(event)) {
    if (subscriptions.has(scope)) {
      return scope;
    }
  }
  return null;
}

export function routeDashboardRealtimeEventToScope(
  event: DashboardRealtimeEvent,
  scope: string,
): DashboardRealtimeEvent {
  if (event.scope === scope) {
    return event;
  }

  const parsedScope = parseDashboardRealtimeScope(scope);
  if (!parsedScope) {
    return event;
  }

  return {
    ...event,
    scopeType: parsedScope.scopeType,
    scopeId: parsedScope.scopeId,
    scope,
  };
}

export class DashboardRealtimeEventRepository {
  private readonly db: DatabaseAdapter;

  // Sequence allocation and snapshot watermarks are tracked in memory rather than in
  // SQLite. Non-replayable snapshot events (project.live.updated, overview.telemetry.updated,
  // etc.) used to be INSERTed on every dashboard tick purely to bump a sequence/watermark —
  // they are never returned by replay (which filters is_replayable = 1). That was ~99.6% of
  // all rows and a relentless synchronous write load on the experimental node:sqlite
  // connection. We now allocate sequences from an in-memory counter (seeded from the max
  // persisted row) and only persist replayable events, which carry payloads worth replaying.
  private nextSequence: number;
  private readonly latestSequenceByScope = new Map<string, number>();
  private readonly latestNonReplayableSequenceByScope = new Map<string, number>();

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
    this.nextSequence = this.readMaxPersistedSequence();
  }

  appendEvent(input: AppendDashboardRealtimeEventInput): DashboardRealtimeEvent {
    const emittedAt = input.emittedAt || new Date().toISOString();
    const replayable = input.replayable !== false;
    const sequence = ++this.nextSequence;
    const scope = buildScope(input.scopeType, input.scopeId);

    for (const routingScope of getDashboardRealtimeEventRoutingScopes({
      scope,
      eventType: input.eventType,
      projectId: input.projectId ?? null,
      threadId: input.threadId ?? null,
    })) {
      this.latestSequenceByScope.set(routingScope, sequence);
      if (!replayable) {
        this.latestNonReplayableSequenceByScope.set(routingScope, sequence);
      }
    }

    if (replayable) {
      this.db.prepare(`
        INSERT INTO dashboard_realtime_events (
          sequence,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sequence,
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
        input.payload !== undefined ? JSON.stringify(input.payload) : null,
        emittedAt,
      );
    }

    return this.buildEvent(sequence, input, emittedAt);
  }

  private readMaxPersistedSequence(): number {
    const row = this.db.prepare(`
      SELECT MAX(sequence) AS max_sequence
      FROM dashboard_realtime_events
    `).get() as { max_sequence?: number | string | null } | undefined;

    if (!row || row.max_sequence === null || row.max_sequence === undefined) {
      return 0;
    }
    return toNumber(row.max_sequence);
  }

  private buildScopeQuery(scopes: Array<{ scopeType: DashboardRealtimeScopeType; scopeId: string }>): {
    predicates: string;
    values: string[];
  } {
    const predicates: string[] = [];
    const values: string[] = [];

    for (const scope of scopes) {
      if (scope.scopeType === "thread") {
        predicates.push(
          "((scope_type = ? AND scope_id = ?) OR (event_type LIKE 'conversation.%' AND thread_id = ?))",
        );
        values.push(scope.scopeType, scope.scopeId, scope.scopeId);
      } else {
        predicates.push("(scope_type = ? AND scope_id = ?)");
        values.push(scope.scopeType, scope.scopeId);
      }
    }

    return {
      predicates: predicates.join(" OR "),
      values,
    };
  }

  private deduplicateLegacyConversationScopeCopies(
    rows: DashboardRealtimeEventRow[],
  ): DashboardRealtimeEventRow[] {
    const deduplicated: DashboardRealtimeEventRow[] = [];
    const pendingProjectRows = new Map<string, {
      index: number;
      sequence: number;
    }>();

    for (const row of rows) {
      if (!isConversationRealtimeEvent(row.event_type) || !row.thread_id) {
        deduplicated.push(row);
        continue;
      }

      const logicalKey = [
        row.event_type,
        row.entity_type,
        row.entity_id,
        row.project_id ?? "",
        row.thread_id,
        row.payload_json ?? "",
      ].join("\u0000");
      const sequence = toNumber(row.sequence);

      if (row.scope_type === "project") {
        pendingProjectRows.set(logicalKey, {
          index: deduplicated.length,
          sequence,
        });
        deduplicated.push(row);
        continue;
      }

      const pendingProject = pendingProjectRows.get(logicalKey);
      if (
        row.scope_type === "thread"
        && pendingProject
        && sequence === pendingProject.sequence + 1
      ) {
        deduplicated[pendingProject.index] = row;
        pendingProjectRows.delete(logicalKey);
        continue;
      }

      deduplicated.push(row);
    }

    return deduplicated;
  }

  listEventsSince(scopes: string[], afterSequence: number, limit: number = 200): DashboardRealtimeEvent[] {
    const parsedScopes = this.parseScopes(scopes);

    if (parsedScopes.length === 0) {
      return [];
    }

    const query = this.buildScopeQuery(parsedScopes);
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : 200;
    const values: Array<string | number> = [
      Math.max(0, afterSequence),
      ...query.values,
      boundedLimit * 2,
    ];

    const rows = this.db.prepare(`
      SELECT *
      FROM dashboard_realtime_events
      WHERE sequence > ?
        AND is_replayable = 1
        AND (${query.predicates})
      ORDER BY sequence ASC
      LIMIT ?
    `).all(...values) as unknown as DashboardRealtimeEventRow[];

    const requestedScopes = new Set(parsedScopes.map((scope) => buildScope(scope.scopeType, scope.scopeId)));
    return this.deduplicateLegacyConversationScopeCopies(rows)
      .map((row) => this.mapRow(row))
      .map((event) => {
        const matchedScope = resolveDashboardRealtimeEventScope(event, requestedScopes);
        return matchedScope ? routeDashboardRealtimeEventToScope(event, matchedScope) : event;
      })
      .slice(0, boundedLimit);
  }

  getLatestSequenceForScopes(scopes: string[]): number | null {
    const parsedScopes = this.parseScopes(scopes);
    if (parsedScopes.length === 0) {
      return null;
    }

    let latest = 0;
    for (const parsed of parsedScopes) {
      const scope = buildScope(parsed.scopeType, parsed.scopeId);
      const inMemory = this.latestSequenceByScope.get(scope);
      if (inMemory !== undefined && inMemory > latest) {
        latest = inMemory;
      }
    }

    // Persisted (replayable) events from before a restart may have a higher sequence than
    // anything we've emitted this run, so fold in the persisted max for these scopes too.
    const query = this.buildScopeQuery(parsedScopes);
    const row = this.db.prepare(`
      SELECT MAX(sequence) AS max_sequence
      FROM dashboard_realtime_events
      WHERE ${query.predicates}
    `).get(...query.values) as { max_sequence?: number | string | null } | undefined;
    if (row && row.max_sequence !== null && row.max_sequence !== undefined) {
      const persisted = toNumber(row.max_sequence);
      if (persisted > latest) {
        latest = persisted;
      }
    }

    return latest > 0 ? latest : null;
  }

  hasNonReplayableEventsSince(scopes: string[], afterSequence: number): boolean {
    const parsedScopes = this.parseScopes(scopes);
    if (parsedScopes.length === 0) {
      return false;
    }

    const threshold = Math.max(0, afterSequence);
    for (const parsed of parsedScopes) {
      const scope = buildScope(parsed.scopeType, parsed.scopeId);
      const latestNonReplayable = this.latestNonReplayableSequenceByScope.get(scope);
      if (latestNonReplayable !== undefined && latestNonReplayable > threshold) {
        return true;
      }
    }
    return false;
  }

  getLatestSequence(): number | null {
    return this.nextSequence > 0 ? this.nextSequence : null;
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
