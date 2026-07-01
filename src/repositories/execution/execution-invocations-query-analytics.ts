import { ExecutionInvocationsSummaryRow, ExecutionInvocationsSprintRow, ExecutionInvocationsApiRow, ExecutionInvocationsErrorRow } from "./execution-repository-types.js";
import { DatabaseAdapter as Database } from "../db/database-adapter.js";

export function computeBasicSummary(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {



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
  return db.prepare(summarySql).get(...values) as ExecutionInvocationsSummaryRow;
}

export function computeP95Duration(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {
  interface CountRow { count: number; }
  interface DurationRow { duration_ms: number; }
  let p95DurationMs = 0;
  const p95CountSql = `
    SELECT COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")} AND provider_invocations.duration_ms IS NOT NULL
  `;
  const p95Count = (db.prepare(p95CountSql).get(...values) as CountRow).count;

  if (p95Count > 0) {
    const p95Offset = Math.max(0, Math.ceil(0.95 * p95Count) - 1);
    const p95Sql = `
      SELECT provider_invocations.duration_ms as duration_ms
      FROM execution_invocations${INVOCATION_JOINS}
      WHERE ${conditions.join(" AND ")} AND provider_invocations.duration_ms IS NOT NULL
      ORDER BY provider_invocations.duration_ms ASC
      LIMIT 1 OFFSET ?
    `;
    const p95Row = db.prepare(p95Sql).get(...values, p95Offset) as DurationRow;
    if (p95Row) {
      p95DurationMs = p95Row.duration_ms;
    }
  }
  return p95DurationMs;
}

export function computeSprintStateSummary(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {
  interface ExecutionInvocationsSprintRow { sprintId: string; status: string; count: number; }
  const sprintsSql = `
    SELECT
      COALESCE(execution_invocations.sprint_id, '') as sprintId,
      execution_invocations.status as status,
      COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    GROUP BY sprintId, execution_invocations.status
  `;
  const sprintRows = db.prepare(sprintsSql).all(...values) as ExecutionInvocationsSprintRow[];

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

  return {
    totalSprints: Array.from(sprintMap.keys()).filter(id => id !== '').length,
    activeSprints,
    completedSprints,
    failedSprints,
    totalTasks,
    runningTasks,
    blockedTasks
  };
}

export function computeExternalApiMetrics(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {
  interface ExecutionInvocationsApiRow { type: string; purpose: string; provider: string; finishedAt: string | null; duration_ms: number | null; count: number; }
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
  const apiRows = db.prepare(apiSql).all(...values) as ExecutionInvocationsApiRow[];

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
  return externalApiMetrics;
}

export function computeErrorsByCategory(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {
  interface ExecutionInvocationsErrorRow { msg: string; status: string; count: number; }
  const errorsSql = `
    SELECT LOWER(COALESCE(execution_invocations.last_error_message, '')) as msg, execution_invocations.status as status, COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")} AND (execution_invocations.status = 'failed' OR execution_invocations.status = 'cancelled')
    GROUP BY msg, execution_invocations.status
  `;
  const errRows = db.prepare(errorsSql).all(...values) as ExecutionInvocationsErrorRow[];

  const errorsByCategory = { timeout: 0, rateLimit: 0, apiError: 0, modelError: 0, cancelled: 0, other: 0 };
  for (const row of errRows) {
    if (row.msg.includes('timeout')) errorsByCategory.timeout += row.count;
    else if (row.msg.includes('rate') || row.msg.includes('429')) errorsByCategory.rateLimit += row.count;
    else if (row.msg.includes('model')) errorsByCategory.modelError += row.count;
    else if (row.msg.includes('api') || row.msg.includes('http')) errorsByCategory.apiError += row.count;
    else if (row.msg.includes('cancel') || row.status === 'cancelled') errorsByCategory.cancelled += row.count;
    else errorsByCategory.other += row.count;
  }
  return errorsByCategory;
}

export function computeAvailablePurposes(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {
  interface PurposeRow { purpose: string; }
  const purposesRows = db.prepare(`SELECT DISTINCT TRIM(execution_invocations.type) as purpose FROM execution_invocations${INVOCATION_JOINS} WHERE ${conditions.join(" AND ")} AND TRIM(execution_invocations.type) != '' ORDER BY purpose ASC`).all(...values) as PurposeRow[];
  return purposesRows.map(r => r.purpose);
}

export function computeAvailableProviders(db: Database, conditions: string[], values: any[], INVOCATION_JOINS: string) {
  interface ProviderRow { provider: string; }
  const providersRows = db.prepare(`SELECT DISTINCT TRIM(execution_invocations.provider) as provider FROM execution_invocations${INVOCATION_JOINS} WHERE ${conditions.join(" AND ")} AND TRIM(execution_invocations.provider) != '' ORDER BY provider ASC`).all(...values) as ProviderRow[];
  return providersRows.map(r => r.provider);
}
