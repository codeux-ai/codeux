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

  const sortKeyMap = {
    startedAt: "execution_invocations.started_at",
    durationMs: "provider_invocations.duration_ms",
    totalTokens: "provider_invocations.total_tokens",
    costCents: "provider_invocations.cost_cents"
  };

  const sortCol = params.sortKey ? sortKeyMap[params.sortKey] || "execution_invocations.started_at" : "execution_invocations.started_at";
  const sortDir = params.sortDir === "asc" ? "ASC" : "DESC";

  const orderBy = `ORDER BY ${sortCol} ${sortDir}, execution_invocations.rowid DESC`;

  const countSql = `
    SELECT COUNT(*) as count
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
  `;

  const totalCount = (db.prepare(countSql).get(...values) as any).count;

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const sql = `
    SELECT${INVOCATION_SELECT}
    FROM execution_invocations${INVOCATION_JOINS}
    WHERE ${conditions.join(" AND ")}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...values, limit, offset) as ExecutionInvocationRow[];
  const items = rows.map(mapExecutionInvocationRow);

  return { items, totalCount };
}
