export type SprintRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type SprintRunTriggerType = "manual" | "dashboard" | "mcp" | "system";
export type SprintRunExecutorMode = "mixed" | "docker_cli" | "jules" | "mcp_worker";

export type TaskDispatchExecutorType = "docker_cli" | "jules" | "mcp_worker";
export type TaskDispatchStatus = "queued" | "claimed" | "running" | "completed" | "failed" | "cancelled" | "blocked";
export type TaskRunState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";

export type ExecutionLeaseScopeType = "project" | "sprint" | "sprint_run" | "task_dispatch";

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

export interface TaskRunRecord {
  id: string;
  projectId: string;
  sprintId: string;
  taskId: string;
  sprintRunId: string | null;
  dispatchId: string | null;
  connectionId: string | null;
  provider: string | null;
  mode: string | null;
  sessionId: string | null;
  sessionName: string | null;
  state: TaskRunState;
  workerBranch: string | null;
  prUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
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

export interface CreateTaskRunInput {
  projectId: string;
  sprintId: string;
  taskId: string;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  connectionId?: string | null;
  provider?: string | null;
  mode?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  state: TaskRunState;
  workerBranch?: string | null;
  prUrl?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
}

export interface UpdateTaskRunInput {
  connectionId?: string | null;
  provider?: string | null;
  mode?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  state?: TaskRunState;
  workerBranch?: string | null;
  prUrl?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
}

export interface WorkerTaskDispatchClaim {
  dispatch: TaskDispatchRecord;
  leaseToken: string;
  project: {
    id: string;
    name: string;
    baseDir: string;
    sourceType: string;
    sourceRef: string;
    defaultBranch: string | null;
    featureBranchPrefix: string | null;
  };
  sprint: {
    id: string;
    name: string;
    number: number | null;
    goal: string;
    featureBranch: string | null;
  };
  task: {
    id: string;
    taskKey: string;
    title: string;
    promptMarkdown: string;
    description: string;
    priority: string;
    dependsOnTaskIds: string[];
    executorType: "auto" | TaskDispatchExecutorType;
  };
  executionContext: {
    repoPath: string;
    defaultBranch: string;
    featureBranch: string;
  };
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
