import type { ProviderErrorCategory } from "../shared/providers/provider-error-classifier.js";
import type { CliExecutionMode } from "./app-types.js";

export type ExecutionInvocationStatus = "running" | "completed" | "failed" | "cancelled" | "paused";

export interface ProjectInvocationsQuery {
  limit?: number;
  offset?: number;
  status?: ExecutionInvocationStatus;
  purpose?: string;
  provider?: string;
  agentPresetId?: string;
  search?: string;
  errorCategories?: string[];
  sortKey?: "startedAt" | "durationMs" | "totalTokens" | "costCents";
  sortDir?: "asc" | "desc";
}

export interface ProjectInvocationsQueryResult {
  items: ExecutionInvocationRecord[];
  totalCount: number;
  summary: {
    totalInvocations: number;
    runningCount: number;
    failedCount: number;
    completedCount: number;
    cancelledCount: number;
    pausedCount: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    totalCostCents: number;
    avgDurationMs: number;
    p95DurationMs: number;
    externalApiMetrics: {
      git: { calls: number; avgDurationMs: number };
      jules: { calls: number; avgDurationMs: number };
      jira: { calls: number; avgDurationMs: number };
      other: { calls: number; avgDurationMs: number };
    };
    sprintStateSummary: {
      totalSprints: number;
      activeSprints: number;
      completedSprints: number;
      failedSprints: number;
      totalTasks: number;
      runningTasks: number;
      blockedTasks: number;
    };
    errorsByCategory: {
      timeout: number;
      rateLimit: number;
      apiError: number;
      modelError: number;
      cancelled: number;
      other: number;
    };
  };
  availablePurposes: string[];
  availableProviders: string[];
}

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
  executionMode?: CliExecutionMode | null;
  systemPrompt: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  lastErrorCategory: ProviderErrorCategory | null;
  lastErrorMessage: string | null;
  lastRetryAfterIso: string | null;
  preservedAt?: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  invocationSource?: "internal" | "EXTERNAL_API";
  agentPresetId?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptChars?: number;
  transcriptChars?: number;
  costCents?: number | null;
  // Joined sprint/task context for display + deep-linking on the dashboard.
  sprintNumber?: number | null;
  sprintName?: string | null;
  sprintSlug?: string | null;
  taskKey?: string | null;
  taskTitle?: string | null;
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
  skipValidation?: boolean;
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
  lastErrorCategory?: ProviderErrorCategory | null;
  lastErrorMessage?: string | null;
  lastRetryAfterIso?: string | null;
  preservedAt?: string | null;
  invocationSource?: "internal" | "EXTERNAL_API";
  agentPresetId?: string | null;
}

export interface UpdateExecutionInvocationInput {
  status?: ExecutionInvocationStatus;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  taskRunId?: string | null;
  attentionItemId?: string | null;
  providerInvocationId?: string | null;
  provider?: string | null;
  model?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  lastErrorCategory?: ProviderErrorCategory | null;
  lastErrorMessage?: string | null;
  lastRetryAfterIso?: string | null;
  preservedAt?: string | null;
}

export interface AppendExecutionInvocationMessageInput {
  role: "system" | "user" | "assistant" | "tool";
  contentMarkdown: string;
  toolCallsJson?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface SyncExecutionInvocationMessagesResult {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export interface SyncExecutionInvocationMessagesOptions {
  /** Stable ordinal at which reconciliation should begin. Prefix rows are trusted unchanged. */
  changedFromIndex?: number;
}
