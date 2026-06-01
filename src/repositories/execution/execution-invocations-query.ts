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
    SELECT
      execution_invocations.*,
      provider_invocations.input_tokens AS input_tokens,
      provider_invocations.cached_input_tokens AS cached_input_tokens,
      provider_invocations.output_tokens AS output_tokens,
      provider_invocations.total_tokens AS total_tokens
    FROM execution_invocations
    LEFT JOIN provider_invocations ON execution_invocations.provider_invocation_id = provider_invocations.id
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
    SELECT
      execution_invocations.*,
      provider_invocations.input_tokens AS input_tokens,
      provider_invocations.cached_input_tokens AS cached_input_tokens,
      provider_invocations.output_tokens AS output_tokens,
      provider_invocations.total_tokens AS total_tokens
    FROM execution_invocations
    LEFT JOIN provider_invocations ON execution_invocations.provider_invocation_id = provider_invocations.id
    WHERE execution_invocations.provider_invocation_id = ?
    ORDER BY execution_invocations.started_at DESC, execution_invocations.rowid DESC
  `).all(providerInvocationId) as ExecutionInvocationRow[];

  return rows.map(mapExecutionInvocationRow);
}

export function queryRunningRetryExecutionInvocations(db: Database): ExecutionInvocationRecord[] {
  const rows = db.prepare(`
    SELECT
      execution_invocations.*,
      provider_invocations.input_tokens AS input_tokens,
      provider_invocations.cached_input_tokens AS cached_input_tokens,
      provider_invocations.output_tokens AS output_tokens,
      provider_invocations.total_tokens AS total_tokens
    FROM execution_invocations
    LEFT JOIN provider_invocations ON execution_invocations.provider_invocation_id = provider_invocations.id
    WHERE execution_invocations.status = 'running'
      AND execution_invocations.last_retry_after_iso IS NOT NULL
      AND execution_invocations.last_error_category IN ('QUOTA_EXHAUSTED', 'RATE_LIMITED')
    ORDER BY execution_invocations.started_at ASC, execution_invocations.rowid ASC
  `).all() as ExecutionInvocationRow[];

  return rows.map(mapExecutionInvocationRow);
}
