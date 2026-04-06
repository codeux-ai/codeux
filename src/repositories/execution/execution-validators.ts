import type { DatabaseAdapter } from "../db/database-adapter.js";
import type {
  ExecutionLeaseRecord,
  ProviderInvocationUsageRecord,
  SprintRunRecord,
  TaskDispatchRecord,
  TaskRunRecord
} from "../../contracts/execution-types.js";

export function requireProject(db: DatabaseAdapter, projectId: string): void {
  const row = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId) as { id: string } | undefined;
  if (!row) {
    throw new Error(`Project not found: ${projectId}`);
  }
}

export function requireSprint(db: DatabaseAdapter, sprintId: string, projectId?: string): void {
  const row = db.prepare(`
    SELECT id, project_id
    FROM sprints
    WHERE id = ?
  `).get(sprintId) as { id: string; project_id: string } | undefined;
  if (!row) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }
  if (projectId && row.project_id !== projectId) {
    throw new Error(`Sprint ${sprintId} does not belong to project ${projectId}`);
  }
}

export function requireTask(db: DatabaseAdapter, taskId: string, projectId?: string, sprintId?: string): void {
  const row = db.prepare(`
    SELECT id, project_id, sprint_id
    FROM tasks
    WHERE id = ?
  `).get(taskId) as { id: string; project_id: string; sprint_id: string } | undefined;
  if (!row) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (projectId && row.project_id !== projectId) {
    throw new Error(`Task ${taskId} does not belong to project ${projectId}`);
  }
  if (sprintId && row.sprint_id !== sprintId) {
    throw new Error(`Task ${taskId} does not belong to sprint ${sprintId}`);
  }
}

export function requireConnection(db: DatabaseAdapter, connectionId: string): void {
  const row = db.prepare(`SELECT id FROM mcp_connections WHERE id = ?`).get(connectionId) as { id: string } | undefined;
  if (!row) {
    throw new Error(`Connection not found: ${connectionId}`);
  }
}

export function requireSprintRun(
  getSprintRun: (id: string) => SprintRunRecord | null,
  runId: string
): SprintRunRecord {
  const run = getSprintRun(runId);
  if (!run) {
    throw new Error(`Sprint run not found: ${runId}`);
  }
  return run;
}

export function requireSprintRunScoped(
  getSprintRun: (id: string) => SprintRunRecord | null,
  runId: string,
  projectId: string,
  sprintId: string
): void {
  const run = requireSprintRun(getSprintRun, runId);
  if (run.projectId !== projectId || run.sprintId !== sprintId) {
    throw new Error(`Sprint run ${runId} does not belong to ${projectId}/${sprintId}`);
  }
}

export function requireTaskDispatch(
  getTaskDispatch: (id: string) => TaskDispatchRecord | null,
  dispatchId: string
): TaskDispatchRecord {
  const dispatch = getTaskDispatch(dispatchId);
  if (!dispatch) {
    throw new Error(`Task dispatch not found: ${dispatchId}`);
  }
  return dispatch;
}

export function requireTaskRun(
  getTaskRun: (id: string) => TaskRunRecord | null,
  taskRunId: string
): TaskRunRecord {
  const taskRun = getTaskRun(taskRunId);
  if (!taskRun) {
    throw new Error(`Task run not found: ${taskRunId}`);
  }
  return taskRun;
}

export function requireProviderInvocationUsage(
  getProviderInvocationUsage: (id: string) => ProviderInvocationUsageRecord | null,
  invocationId: string
): ProviderInvocationUsageRecord {
  const invocation = getProviderInvocationUsage(invocationId);
  if (!invocation) {
    throw new Error(`Provider invocation not found: ${invocationId}`);
  }
  return invocation;
}

export function requireLease(
  getLease: (scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string) => ExecutionLeaseRecord | null,
  scopeType: ExecutionLeaseRecord["scopeType"],
  scopeId: string
): ExecutionLeaseRecord {
  const lease = getLease(scopeType, scopeId);
  if (!lease) {
    throw new Error(`Execution lease not found: ${scopeType}:${scopeId}`);
  }
  return lease;
}
