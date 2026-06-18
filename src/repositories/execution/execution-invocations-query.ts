import { DatabaseAdapter as Database } from "../db/database-adapter.js";
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

// Shared projection: invocation columns + provider usage + the sprint key /
// task key context the dashboard renders (and links) on each invocation card.
const INVOCATION_SELECT = `
      execution_invocations.*,
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
    LEFT JOIN sprints ON execution_invocations.sprint_id = sprints.id
    LEFT JOIN tasks ON execution_invocations.task_id = tasks.id`;

export function queryExecutionInvocations(
  db: Database,
  params: {
    projectId: string;
    sprintRunId?: string;
    taskRunId?: string;
    limit?: number;
    offset?: number;
  }
): ExecutionInvocationRecord[] {
  const conditions = ["execution_invocations.project_id = ?"];
  const values: any[] = [params.projectId];

  if (params.sprintRunId) {
    conditions.push("execution_invocations.sprint_run_id = ?");
    values.push(params.sprintRunId);
  }

  if (params.taskRunId) {
    conditions.push("execution_invocations.task_run_id = ?");
    values.push(params.taskRunId);
  }

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const sql = `
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    ORDER BY execution_invocations.started_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...values, limit, offset) as ExecutionInvocationRow[];
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

  // We need to fetch all matching rows WITHOUT limit to compute the dashboard metrics
  // Wait, if we fetch all matching rows into memory, isn't that a scalability flaw?
  // Yes, but computing sprint metrics and error metrics perfectly requires grouping.
  // We can do it in SQL!

  // 1. Basic Summary
  const summarySql = `
    SELECT
      COUNT(*) as totalInvocations,
      SUM(CASE WHEN execution_invocations.status = 'running' THEN 1 ELSE 0 END) as runningCount,
      SUM(CASE WHEN execution_invocations.status = 'failed' THEN 1 ELSE 0 END) as failedCount,
      SUM(CASE WHEN execution_invocations.status = 'completed' THEN 1 ELSE 0 END) as completedCount,
      SUM(CASE WHEN execution_invocations.status = 'cancelled' THEN 1 ELSE 0 END) as cancelledCount,
      SUM(CASE WHEN execution_invocations.status = 'paused' THEN 1 ELSE 0 END) as pausedCount,
      SUM(COALESCE(provider_invocations.total_tokens, 0)) as totalTokens,
      SUM(COALESCE(provider_invocations.input_tokens, 0)) as totalInputTokens,
      SUM(COALESCE(provider_invocations.output_tokens, 0)) as totalOutputTokens,
      SUM(COALESCE(provider_invocations.cached_input_tokens, 0)) as totalCachedTokens,
      AVG(provider_invocations.duration_ms) as avgDurationMs
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
  `;
  const summaryRow = db.prepare(summarySql).get(...values) as any;

  // P95 Duration using OFFSET
  let p95DurationMs = 0;
  const p95CountSql = `
    SELECT COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")} AND provider_invocations.duration_ms IS NOT NULL
  `;
  const p95Count = (db.prepare(p95CountSql).get(...values) as any).count;

  if (p95Count > 0) {
    const p95Offset = Math.max(0, Math.ceil(0.95 * p95Count) - 1);
    const p95Sql = `
      SELECT provider_invocations.duration_ms as duration_ms
      FROM execution_invocations${INVOCATION_JOINS}
      WHERE ${conditions.join(" AND ")} AND provider_invocations.duration_ms IS NOT NULL
      ORDER BY provider_invocations.duration_ms ASC
      LIMIT 1 OFFSET ?
    `;
    const p95Row = db.prepare(p95Sql).get(...values, p95Offset) as any;
    if (p95Row) {
      p95DurationMs = p95Row.duration_ms;
    }
  }

  // Sprints
  const sprintsSql = `
    SELECT
      COALESCE(execution_invocations.sprint_id, '') as sprintId,
      execution_invocations.status as status,
      COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    GROUP BY sprintId, execution_invocations.status
  `;
  const sprintRows = db.prepare(sprintsSql).all(...values) as any[];

  let totalTasks = 0;
  let runningTasks = 0;
  let blockedTasks = 0;
  const sprintMap = new Map<string, Record<string, number>>();

  for (const row of sprintRows) {
    const { sprintId, status, count } = row;
    if (!sprintMap.has(sprintId)) sprintMap.set(sprintId, {});
    sprintMap.get(sprintId)![status] = (sprintMap.get(sprintId)![status] || 0) + count;

    totalTasks += count;
    if (status === 'running') runningTasks += count;
    if (status === 'paused') blockedTasks += count;
  }

  let activeSprints = 0;
  let completedSprints = 0;
  let failedSprints = 0;
  for (const [sprintId, counts] of sprintMap.entries()) {
    if (!sprintId) continue;
    const totalInSprint = Object.values(counts).reduce((a, b) => a + b, 0);
    if ((counts['running'] || 0) > 0) activeSprints++;
    if ((counts['failed'] || 0) > 0) failedSprints++;
    if ((counts['completed'] || 0) === totalInSprint && totalInSprint > 0) completedSprints++;
  }

  const sprintStateSummary = {
    totalSprints: Array.from(sprintMap.keys()).filter(id => id !== '').length,
    activeSprints,
    completedSprints,
    failedSprints,
    totalTasks,
    runningTasks,
    blockedTasks
  };

  // API metrics
  const apiSql = `
    SELECT
      LOWER(COALESCE(execution_invocations.type, '')) as type,
      LOWER(COALESCE(provider_invocations.purpose, '')) as purpose,
      LOWER(COALESCE(execution_invocations.provider, '')) as provider,
      execution_invocations.finished_at as finishedAt,
      provider_invocations.duration_ms as duration_ms,
      COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    GROUP BY type, purpose, execution_invocations.provider, finishedAt IS NOT NULL, duration_ms
  `;
  const apiRows = db.prepare(apiSql).all(...values) as any[];

  const externalApiMetrics = {
    git: { calls: 0, avgDurationMs: 0 },
    jules: { calls: 0, avgDurationMs: 0 },
    jira: { calls: 0, avgDurationMs: 0 },
    other: { calls: 0, avgDurationMs: 0 },
  };
  const extTotals = { git: 0, jules: 0, jira: 0, other: 0 };
  const extFinished = { git: 0, jules: 0, jira: 0, other: 0 };

  for (const row of apiRows) {
    const isModel = row.type === 'coding' || row.type === 'planning' || row.type === 'qa';
    let cat: 'git' | 'jules' | 'jira' | 'other' | null = null;

    if (row.type.includes('git') || row.purpose.includes('git')) cat = 'git';
    else if (row.provider === 'jules' || row.type.includes('jules')) cat = 'jules';
    else if (row.type.includes('jira') || row.purpose.includes('jira')) cat = 'jira';
    else if (!isModel) cat = 'other';

    if (cat) {
      externalApiMetrics[cat].calls += row.count;
      if (row.finishedAt) {
        extTotals[cat] += (row.duration_ms || 0) * row.count;
        extFinished[cat] += row.count;
      }
    }
  }

  for (const k of ['git', 'jules', 'jira', 'other'] as const) {
    if (extFinished[k] > 0) externalApiMetrics[k].avgDurationMs = extTotals[k] / extFinished[k];
  }

  // Errors by category
  const errorsSql = `
    SELECT LOWER(COALESCE(execution_invocations.last_error_message, '')) as msg, execution_invocations.status as status, COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")} AND (execution_invocations.status = 'failed' OR execution_invocations.status = 'cancelled')
    GROUP BY msg, execution_invocations.status
  `;
  const errRows = db.prepare(errorsSql).all(...values) as any[];

  const errorsByCategory = { timeout: 0, rateLimit: 0, apiError: 0, modelError: 0, cancelled: 0, other: 0 };
  for (const row of errRows) {
    if (row.msg.includes('timeout')) errorsByCategory.timeout += row.count;
    else if (row.msg.includes('rate') || row.msg.includes('429')) errorsByCategory.rateLimit += row.count;
    else if (row.msg.includes('model')) errorsByCategory.modelError += row.count;
    else if (row.msg.includes('api') || row.msg.includes('http')) errorsByCategory.apiError += row.count;
    else if (row.msg.includes('cancel') || row.status === 'cancelled') errorsByCategory.cancelled += row.count;
    else errorsByCategory.other += row.count;
  }

  const purposesRows = db.prepare(`SELECT DISTINCT TRIM(execution_invocations.type) as purpose FROM execution_invocations${INVOCATION_JOINS} WHERE ${conditions.join(" AND ")} AND TRIM(execution_invocations.type) != '' ORDER BY purpose ASC`).all(...values) as any[];
  const availablePurposes = purposesRows.map(r => r.purpose);

  const providersRows = db.prepare(`SELECT DISTINCT TRIM(execution_invocations.provider) as provider FROM execution_invocations${INVOCATION_JOINS} WHERE ${conditions.join(" AND ")} AND TRIM(execution_invocations.provider) != '' ORDER BY provider ASC`).all(...values) as any[];
  const availableProviders = providersRows.map(r => r.provider);

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
