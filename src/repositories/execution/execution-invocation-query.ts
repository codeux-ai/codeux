import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import {
  ExecutionInvocationRecord
} from "../../contracts/invocation-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import {
  ExecutionInvocationRow,
  ProviderInvocationUsageRow
} from "./execution-repository-types.js";
import {
  mapExecutionInvocationRow,
  mapProviderInvocationUsageRow
} from "./execution-read-model-mappers.js";

export function queryExecutionInvocation(
  db: Database,
  id: string
): ExecutionInvocationRecord | null {
  const row = db.prepare(`
    SELECT
      execution_invocations.*,
      provider_invocations.input_tokens AS input_tokens,
      provider_invocations.cached_input_tokens AS cached_input_tokens,
      provider_invocations.output_tokens AS output_tokens,
      provider_invocations.total_tokens AS total_tokens
    FROM execution_invocations
    LEFT JOIN provider_invocations ON execution_invocations.provider_invocation_id = provider_invocations.id
    WHERE execution_invocations.id = ?
  `).get(id) as ExecutionInvocationRow | undefined;

  if (!row) return null;
  return mapExecutionInvocationRow(row);
}

export function queryProviderInvocationUsage(
  db: Database,
  invocationId: string
): ProviderInvocationUsageRecord | null {
  const row = db.prepare(`
    SELECT *
    FROM provider_invocations
    WHERE id = ?
  `).get(invocationId) as ProviderInvocationUsageRow | undefined;
  return row ? mapProviderInvocationUsageRow(row) : null;
}

export function queryLatestProviderInvocationUsageBySession(
  db: Database,
  sessionId: string,
  purpose?: ProviderInvocationUsageRecord["purpose"],
): ProviderInvocationUsageRecord | null {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    return null;
  }

  const rawId = trimmedSessionId.replace(/^sessions\//, "");
  const prefixedName = `sessions/${rawId}`;

  const row = purpose
    ? db.prepare(`
      SELECT *
      FROM provider_invocations
      WHERE (session_id = ? OR session_id = ?)
        AND purpose = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(rawId, prefixedName, purpose) as ProviderInvocationUsageRow | undefined
    : db.prepare(`
      SELECT *
      FROM provider_invocations
      WHERE (session_id = ? OR session_id = ?)
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(rawId, prefixedName) as ProviderInvocationUsageRow | undefined;

  return row ? mapProviderInvocationUsageRow(row) : null;
}

export function queryRunningProviderInvocationUsages(
  db: Database,
  providers?: string[],
): ProviderInvocationUsageRecord[] {
  const clauses = ["status = 'running'"];
  const values: string[] = [];

  if (providers && providers.length > 0) {
    clauses.push(`provider IN (${providers.map(() => "?").join(", ")})`);
    values.push(...providers);
  }

  const rows = db.prepare(`
    SELECT *
    FROM provider_invocations
    WHERE ${clauses.join(" AND ")}
    ORDER BY started_at DESC, rowid DESC
  `).all(...values) as ProviderInvocationUsageRow[];

  return rows.map(mapProviderInvocationUsageRow);
}
