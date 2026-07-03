import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import type { SQLiteParam } from "../repository-utils.js";
import {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord
} from "../../contracts/invocation-types.js";
import {
  ExecutionInvocationRow,
  ExecutionInvocationMessageRow
} from "./execution-repository-types.js";
import {
  mapExecutionInvocationRow,
  mapExecutionInvocationMessageRow
} from "./execution-read-model-mappers.js";
import {
  computeBasicSummary,
  computeP95Duration,
  computeSprintStateSummary,
  computeExternalApiMetrics,
  computeErrorsByCategory,
  computeAvailablePurposes,
  computeAvailableProviders
} from "./execution-invocations-query-analytics.js";


// Shared projection: invocation columns + provider usage + the sprint key /
// task key context the dashboard renders (and links) on each invocation card.
const INVOCATION_SELECT = `
      execution_invocations.id,
      execution_invocations.project_id,
      COALESCE(execution_invocations.sprint_id, provider_invocations.sprint_id) AS sprint_id,
      COALESCE(execution_invocations.task_id, provider_invocations.task_id) AS task_id,
      COALESCE(execution_invocations.sprint_run_id, provider_invocations.sprint_run_id) AS sprint_run_id,
      COALESCE(execution_invocations.dispatch_id, provider_invocations.dispatch_id) AS dispatch_id,
      COALESCE(execution_invocations.task_run_id, provider_invocations.task_run_id) AS task_run_id,
      COALESCE(execution_invocations.attention_item_id, provider_invocations.attention_item_id) AS attention_item_id,
      execution_invocations.provider_invocation_id,
      execution_invocations.type,
      execution_invocations.status,
      execution_invocations.provider,
      execution_invocations.model,
      execution_invocations.system_prompt,
      execution_invocations.started_at,
      execution_invocations.finished_at,
      execution_invocations.error_message,
      execution_invocations.last_error_category,
      execution_invocations.last_error_message,
      execution_invocations.last_retry_after_iso,
      execution_invocations.preserved_at,
      execution_invocations.message_count,
      execution_invocations.last_message_at,
      execution_invocations.invocation_source,
      execution_invocations.agent_preset_id,
      execution_invocations.created_at,
      execution_invocations.updated_at,
      provider_invocations.input_tokens AS input_tokens,
      provider_invocations.cached_input_tokens AS cached_input_tokens,
      provider_invocations.output_tokens AS output_tokens,
      provider_invocations.total_tokens AS total_tokens,
      sprints.number AS sprint_number,
      sprints.name AS sprint_name,
      sprints.slug AS sprint_slug,
      tasks.task_key AS task_key,
      tasks.title AS task_title`;

const INVOCATION_JOINS = `
    LEFT JOIN provider_invocations ON execution_invocations.provider_invocation_id = provider_invocations.id
    LEFT JOIN sprints ON COALESCE(execution_invocations.sprint_id, provider_invocations.sprint_id) = sprints.id
    LEFT JOIN tasks ON COALESCE(execution_invocations.task_id, provider_invocations.task_id) = tasks.id`;

export function queryExecutionInvocations(
  db: Database,
  params: {
    projectId: string;
    sprintId?: string;
    sprintRunId?: string;
    sprintRunIds?: string[];
    taskRunId?: string;
    limit?: number | null;
    offset?: number;
  }
): ExecutionInvocationRecord[] {
  const conditions = ["execution_invocations.project_id = ?"];
  const values: any[] = [params.projectId];

  if (params.sprintId) {
    conditions.push("COALESCE(execution_invocations.sprint_id, provider_invocations.sprint_id) = ?");
    values.push(params.sprintId);
  }

  if (params.sprintRunId) {
    conditions.push("COALESCE(execution_invocations.sprint_run_id, provider_invocations.sprint_run_id) = ?");
    values.push(params.sprintRunId);
  }

  if (params.sprintRunIds && params.sprintRunIds.length > 0) {
    conditions.push(`COALESCE(execution_invocations.sprint_run_id, provider_invocations.sprint_run_id) IN (${params.sprintRunIds.map(() => "?").join(", ")})`);
    values.push(...params.sprintRunIds);
  }

  if (params.taskRunId) {
    conditions.push("COALESCE(execution_invocations.task_run_id, provider_invocations.task_run_id) = ?");
    values.push(params.taskRunId);
  }

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  const limitClause = params.limit === null ? "LIMIT -1 OFFSET ?" : "LIMIT ? OFFSET ?";
  const paginationValues = params.limit === null ? [offset] : [limit, offset];

  const sql = `
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    ORDER BY execution_invocations.started_at DESC, execution_invocations.rowid DESC
    ${limitClause}
  `;

  const rows = db.prepare(sql).all(...values, ...paginationValues) as ExecutionInvocationRow[];
  return rows.map(mapExecutionInvocationRow);
}

export function queryProjectExecutionSnapshotInvocations(
  db: Database,
  params: {
    projectId: string;
    sprintRunIds: string[];
    selectedSprintId?: string | null;
  },
): ExecutionInvocationRecord[] {
  const scopePredicates = [`
    execution_invocations.id IN (
      SELECT id
      FROM execution_invocations
      WHERE project_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 24
    )
  `];
  const values: SQLiteParam[] = [params.projectId, params.projectId];

  if (params.sprintRunIds.length > 0) {
    scopePredicates.push(
      `COALESCE(execution_invocations.sprint_run_id, provider_invocations.sprint_run_id) IN (${params.sprintRunIds.map(() => "?").join(", ")})`,
    );
    values.push(...params.sprintRunIds);
  }

  if (params.selectedSprintId) {
    scopePredicates.push("COALESCE(execution_invocations.sprint_id, provider_invocations.sprint_id) = ?");
    values.push(params.selectedSprintId);
  }

  const rows = db.prepare(`
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE execution_invocations.project_id = ?
      AND (${scopePredicates.join(" OR ")})
    ORDER BY execution_invocations.started_at DESC, execution_invocations.rowid DESC
  `).all(...values) as ExecutionInvocationRow[];

  return rows.map(mapExecutionInvocationRow);
}

export function queryExecutionInvocationMessages(
  db: Database,
  invocationId: string
): ExecutionInvocationMessageRecord[] {
  const sql = `
    SELECT *
    FROM execution_invocation_messages
    WHERE invocation_id = ?
    ORDER BY created_at ASC
  `;
  const rows = db.prepare(sql).all(invocationId) as ExecutionInvocationMessageRow[];
  return rows.map(mapExecutionInvocationMessageRow);
}

export function queryExecutionInvocationsByProviderInvocationId(
  db: Database,
  providerInvocationId: string,
): ExecutionInvocationRecord[] {
  const rows = db.prepare(`
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE execution_invocations.provider_invocation_id = ?
    ORDER BY execution_invocations.started_at DESC, execution_invocations.rowid DESC
  `).all(providerInvocationId) as ExecutionInvocationRow[];

  return rows.map(mapExecutionInvocationRow);
}

export function queryRunningRetryExecutionInvocations(db: Database): ExecutionInvocationRecord[] {
  const rows = db.prepare(`
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE execution_invocations.status = 'running'
      AND execution_invocations.last_retry_after_iso IS NOT NULL
      AND execution_invocations.last_error_category IN ('QUOTA_EXHAUSTED', 'RATE_LIMITED')
    ORDER BY execution_invocations.started_at ASC, execution_invocations.rowid ASC
  `).all() as ExecutionInvocationRow[];

  return rows.map(mapExecutionInvocationRow);
}

export function queryActiveExecutionInvocationsByTypes(
  db: Database,
  types: string[],
): ExecutionInvocationRecord[] {
  if (types.length === 0) {
    return [];
  }

  const rows = db.prepare(`
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE execution_invocations.status IN ('running', 'paused')
      AND execution_invocations.type IN (${types.map(() => "?").join(", ")})
    ORDER BY execution_invocations.started_at DESC, execution_invocations.rowid DESC
  `).all(...types) as ExecutionInvocationRow[];

  return rows.map(mapExecutionInvocationRow);
}

export function queryProjectInvocations(
  db: import("../db/database-adapter.js").DatabaseAdapter,
  params: import("../../contracts/invocation-types.js").ProjectInvocationsQuery & { projectId: string }
): import("../../contracts/invocation-types.js").ProjectInvocationsQueryResult {
  const conditions = ["execution_invocations.project_id = ?"];
  const values = [params.projectId];

  if (params.status) {
    conditions.push("execution_invocations.status = ?");
    values.push(params.status);
  }

  if (params.provider) {
    conditions.push("execution_invocations.provider = ?");
    values.push(params.provider);
  }

  if (params.purpose) {
    conditions.push("provider_invocations.purpose = ?");
    values.push(params.purpose);
  }

  if (params.search) {
    conditions.push("(sprints.name LIKE ? OR sprints.slug LIKE ? OR tasks.task_key LIKE ? OR tasks.title LIKE ? OR execution_invocations.model LIKE ?)");
    const searchTerm = `%${params.search}%`;
    values.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (params.errorCategories && params.errorCategories.length > 0) {
    const errorConditions: string[] = [];
    for (const cat of params.errorCategories) {
      if (cat === "timeout") errorConditions.push("LOWER(execution_invocations.last_error_message) LIKE '%timeout%'");
      else if (cat === "rateLimit") errorConditions.push("(LOWER(execution_invocations.last_error_message) LIKE '%rate%' OR LOWER(execution_invocations.last_error_message) LIKE '%429%')");
      else if (cat === "modelError") errorConditions.push("LOWER(execution_invocations.last_error_message) LIKE '%model%'");
      else if (cat === "apiError") errorConditions.push("(LOWER(execution_invocations.last_error_message) LIKE '%api%' OR LOWER(execution_invocations.last_error_message) LIKE '%http%')");
      else if (cat === "cancelled") errorConditions.push("(LOWER(execution_invocations.last_error_message) LIKE '%cancel%' OR execution_invocations.status = 'cancelled')");
    }
    if (errorConditions.length > 0) {
      conditions.push(`(${errorConditions.join(" OR ")})`);
    }
  }

  const sortKeyMap: Record<string, string> = {
    startedAt: "execution_invocations.started_at",
    durationMs: "provider_invocations.duration_ms",
    totalTokens: "provider_invocations.total_tokens",
    costCents: "provider_invocations.cost_cents"
  };

  let orderBy = "ORDER BY execution_invocations.started_at DESC, execution_invocations.rowid DESC";
  if (params.sortKey && sortKeyMap[params.sortKey]) {
    const dir = params.sortDir === "asc" ? "ASC" : "DESC";
    orderBy = `ORDER BY ${sortKeyMap[params.sortKey]} ${dir}, execution_invocations.rowid DESC`;
  }

  const countSql = `
    SELECT COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
  `;
  const totalCount = (db.prepare(countSql).get(...values) as any).count;

  const summaryRow = computeBasicSummary(db, conditions, values, INVOCATION_JOINS);
  const p95DurationMs = computeP95Duration(db, conditions, values, INVOCATION_JOINS);
  const sprintStateSummary = computeSprintStateSummary(db, conditions, values, INVOCATION_JOINS);
  const externalApiMetrics = computeExternalApiMetrics(db, conditions, values, INVOCATION_JOINS);
  const errorsByCategory = computeErrorsByCategory(db, conditions, values, INVOCATION_JOINS);
  const availablePurposes = computeAvailablePurposes(db, conditions, values, INVOCATION_JOINS);
  const availableProviders = computeAvailableProviders(db, conditions, values, INVOCATION_JOINS);

  const summary = {
    totalInvocations: Number(summaryRow.totalInvocations) || 0,
    runningCount: Number(summaryRow.runningCount) || 0,
    failedCount: Number(summaryRow.failedCount) || 0,
    completedCount: Number(summaryRow.completedCount) || 0,
    cancelledCount: Number(summaryRow.cancelledCount) || 0,
    pausedCount: Number(summaryRow.pausedCount) || 0,
    totalTokens: Number(summaryRow.totalTokens) || 0,
    totalInputTokens: Number(summaryRow.totalInputTokens) || 0,
    totalOutputTokens: Number(summaryRow.totalOutputTokens) || 0,
    totalCachedTokens: Number(summaryRow.totalCachedTokens) || 0,
    avgDurationMs: Number(summaryRow.avgDurationMs) || 0,
    p95DurationMs,
    externalApiMetrics,
    sprintStateSummary,
    errorsByCategory
  };

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  const sql = `
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...values, limit, offset) as import("./execution-repository-types.js").ExecutionInvocationRow[];
  const items = rows.map(mapExecutionInvocationRow);

  return { items, totalCount, summary, availablePurposes, availableProviders };
}
