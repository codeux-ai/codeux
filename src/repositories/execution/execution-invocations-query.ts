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
  const conditions = ["project_id = ?"];
  const values: any[] = [params.projectId];

  if (params.sprintRunId) {
    conditions.push("sprint_run_id = ?");
    values.push(params.sprintRunId);
  }

  if (params.taskRunId) {
    conditions.push("task_run_id = ?");
    values.push(params.taskRunId);
  }

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const sql = `
    SELECT *
    FROM execution_invocations
    WHERE ${conditions.join(" AND ")}
    ORDER BY started_at DESC
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
