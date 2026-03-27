export type ExecutionInvocationStatus = "running" | "completed" | "failed" | "cancelled" | "paused";

export interface ExecutionInvocationRecord {
  id: string;
  projectId: string;
  sprintId: string | null;
  taskId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  taskRunId: string | null;
  attentionItemId: string | null;
  providerInvocationId: string | null;
  type: string;
  status: ExecutionInvocationStatus;
  provider: string | null;
  model: string | null;
  systemPrompt: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionInvocationMessageRecord {
  id: string;
  invocationId: string;
  role: "system" | "user" | "assistant" | "tool";
  contentMarkdown: string;
  toolCallsJson: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateExecutionInvocationInput {
  projectId: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  taskRunId?: string | null;
  attentionItemId?: string | null;
  providerInvocationId?: string | null;
  type: string;
  status?: ExecutionInvocationStatus;
  provider?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface UpdateExecutionInvocationInput {
  status?: ExecutionInvocationStatus;
  providerInvocationId?: string | null;
  provider?: string | null;
  model?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface AppendExecutionInvocationMessageInput {
  role: "system" | "user" | "assistant" | "tool";
  contentMarkdown: string;
  toolCallsJson?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}
