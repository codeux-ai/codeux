import type { DatabaseAdapter } from "../db/database-adapter.js";
import { requireEntity, requireEntityByGetter } from "../shared/validation-utils.js";
import type {
  ExecutionLeaseRecord,
  ProviderInvocationUsageRecord,
  SprintRunRecord,
  TaskDispatchRecord,
  TaskRunRecord
} from "../../contracts/execution-types.js";

export function requireProject(db: DatabaseAdapter, projectId: string): void {
  requireEntity<{ id: string }>(db, "Project", "projects", projectId);
}

export function requireSprint(db: DatabaseAdapter, sprintId: string, projectId?: string): void {
  requireEntity<{ id: string; project_id: string }>(
    db,
    "Sprint",
    "sprints",
    sprintId,
    "id, project_id",
    (row) => {
      if (projectId && row.project_id !== projectId) {
        throw new Error(`Sprint ${sprintId} does not belong to project ${projectId}`);
      }
    }
  );
}

export function requireTask(db: DatabaseAdapter, taskId: string, projectId?: string, sprintId?: string): void {
  requireEntity<{ id: string; project_id: string; sprint_id: string }>(
    db,
    "Task",
    "tasks",
    taskId,
    "id, project_id, sprint_id",
    (row) => {
      if (projectId && row.project_id !== projectId) {
        throw new Error(`Task ${taskId} does not belong to project ${projectId}`);
      }
      if (sprintId && row.sprint_id !== sprintId) {
        throw new Error(`Task ${taskId} does not belong to sprint ${sprintId}`);
      }
    }
  );
}

export function requireConnection(db: DatabaseAdapter, connectionId: string): void {
  requireEntity<{ id: string }>(db, "Connection", "mcp_connections", connectionId);
}

export function requireSprintRun(
  getSprintRun: (id: string) => SprintRunRecord | null,
  runId: string
): SprintRunRecord {
  return requireEntityByGetter("Sprint run", runId, getSprintRun);
}

export function requireSprintRunScoped(
  getSprintRun: (id: string) => SprintRunRecord | null,
  runId: string,
  projectId: string,
  sprintId: string
): void {
  requireEntityByGetter("Sprint run", runId, getSprintRun, (run) => {
    if (run.projectId !== projectId || run.sprintId !== sprintId) {
      throw new Error(`Sprint run ${runId} does not belong to ${projectId}/${sprintId}`);
    }
  });
}

export function requireTaskDispatch(
  getTaskDispatch: (id: string) => TaskDispatchRecord | null,
  dispatchId: string
): TaskDispatchRecord {
  return requireEntityByGetter("Task dispatch", dispatchId, getTaskDispatch);
}

export function requireTaskRun(
  getTaskRun: (id: string) => TaskRunRecord | null,
  taskRunId: string
): TaskRunRecord {
  return requireEntityByGetter("Task run", taskRunId, getTaskRun);
}

export function requireProviderInvocationUsage(
  getProviderInvocationUsage: (id: string) => ProviderInvocationUsageRecord | null,
  invocationId: string
): ProviderInvocationUsageRecord {
  return requireEntityByGetter("Provider invocation", invocationId, getProviderInvocationUsage);
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
