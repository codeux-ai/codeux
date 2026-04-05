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
    SELECT *
    FROM execution_invocations
    WHERE id = ?
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

  const row = purpose
    ? db.prepare(`
      SELECT *
      FROM provider_invocations
      WHERE session_id = ?
        AND purpose = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(trimmedSessionId, purpose) as ProviderInvocationUsageRow | undefined
    : db.prepare(`
      SELECT *
      FROM provider_invocations
      WHERE session_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(trimmedSessionId) as ProviderInvocationUsageRow | undefined;

  return row ? mapProviderInvocationUsageRow(row) : null;
}
