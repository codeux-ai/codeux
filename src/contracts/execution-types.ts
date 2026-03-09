export type SprintRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type SprintRunTriggerType = "manual" | "dashboard" | "mcp" | "system";
export type SprintRunExecutorMode = "mixed" | "docker_cli" | "jules" | "mcp_worker";

export type TaskDispatchExecutorType = "docker_cli" | "jules" | "mcp_worker";
export type TaskDispatchStatus = "queued" | "claimed" | "running" | "completed" | "failed" | "cancelled" | "blocked";

export type ExecutionLeaseScopeType = "project" | "sprint_run" | "task_dispatch";

export interface SprintRunRecord {
  id: string;
  projectId: string;
  sprintId: string;
  status: SprintRunStatus;
  triggerType: SprintRunTriggerType;
  triggeredBy: string | null;
  executorMode: SprintRunExecutorMode;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDispatchRecord {
  id: string;
  projectId: string;
  sprintId: string;
  taskId: string;
  sprintRunId: string;
  connectionId: string | null;
  executorType: TaskDispatchExecutorType;
  status: TaskDispatchStatus;
  priority: number;
  queuedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLeaseRecord {
  id: string;
  scopeType: ExecutionLeaseScopeType;
  scopeId: string;
  ownerKey: string;
  leaseToken: string;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string | null;
}

export interface CreateSprintRunInput {
  projectId: string;
  sprintId: string;
  triggerType?: SprintRunTriggerType;
  triggeredBy?: string | null;
  executorMode?: SprintRunExecutorMode;
  status?: SprintRunStatus;
}

export interface UpdateSprintRunInput {
  status?: SprintRunStatus;
  executorMode?: SprintRunExecutorMode;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastHeartbeatAt?: string | null;
}

export interface CreateTaskDispatchInput {
  projectId: string;
  sprintId: string;
  taskId: string;
  sprintRunId: string;
  connectionId?: string | null;
  executorType: TaskDispatchExecutorType;
  status?: TaskDispatchStatus;
  priority?: number;
  queuedAt?: string;
}

export interface UpdateTaskDispatchInput {
  connectionId?: string | null;
  status?: TaskDispatchStatus;
  claimedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastHeartbeatAt?: string | null;
  errorMessage?: string | null;
}

export interface AcquireExecutionLeaseInput {
  scopeType: ExecutionLeaseScopeType;
  scopeId: string;
  ownerKey: string;
  leaseToken: string;
  expiresAt: string;
}

export interface RenewExecutionLeaseInput {
  scopeType: ExecutionLeaseScopeType;
  scopeId: string;
  leaseToken: string;
  expiresAt: string;
}
