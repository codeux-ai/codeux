import { randomUUID } from "crypto";
import type {
  CreateProviderInvocationUsageInput,
  ProviderInvocationUsageRecord,
  UpdateProviderInvocationUsageInput,
} from "../../contracts/execution-types.js";
import type { Logger } from "../../shared/logging/logger.js";
import { getCorrelationId } from "../../shared/logging/correlation-id.js";
import type { DatabaseAdapter } from "../db/database-adapter.js";
import { RepositoryError } from "../repository-utils.js";
import {
  requireProject,
  requireProviderInvocationUsage,
  requireSprint,
  requireSprintRun,
  requireTask,
  requireTaskDispatch,
  requireTaskRun,
} from "./execution-validators.js";

export interface ProviderInvocationUsageWriteGetters {
  getSprintRun: ExecutionScopedGetters["getSprintRun"];
  getTaskDispatch: ExecutionScopedGetters["getTaskDispatch"];
  getTaskRun: ExecutionScopedGetters["getTaskRun"];
  getProviderInvocationUsage: (id: string) => ProviderInvocationUsageRecord | null;
}

interface ExecutionScopedGetters {
  getSprintRun: Parameters<typeof requireSprintRun>[0];
  getTaskDispatch: Parameters<typeof requireTaskDispatch>[0];
  getTaskRun: Parameters<typeof requireTaskRun>[0];
}

type NotifyRealtime = (projectId: string, includeOverview: boolean) => void;

function listDefinedUpdateFields(input: UpdateProviderInvocationUsageInput): string[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

function calculateDurationMs(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) {
    return null;
  }
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  return Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
    ? Math.max(0, finishedAtMs - startedAtMs)
    : null;
}

export function writeProviderInvocationUsage(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ProviderInvocationUsageWriteGetters,
  input: CreateProviderInvocationUsageInput,
  notifyRealtime: NotifyRealtime,
): ProviderInvocationUsageRecord {
  try {
    requireProject(db, input.projectId);
    if (input.sprintId) {
      requireSprint(db, input.sprintId, input.projectId);
    }
    if (input.taskId) {
      requireTask(db, input.taskId, input.projectId, input.sprintId || undefined);
    }
    if (input.sprintRunId) {
      requireSprintRun(getters.getSprintRun, input.sprintRunId);
    }
    if (input.dispatchId) {
      requireTaskDispatch(getters.getTaskDispatch, input.dispatchId);
    }
    if (input.taskRunId) {
      requireTaskRun(getters.getTaskRun, input.taskRunId);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const status = input.status || "running";
    const terminalAt = status === "running" ? null : now;
    db.prepare(`
      INSERT INTO provider_invocations (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, task_run_id, attention_item_id,
        session_id, provider, purpose, status, model, execution_mode, native_session_id, started_at, finished_at, duration_ms,
        prompt_chars, transcript_chars, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
        total_tokens, token_accounting_version, tool_call_count, jules_tokens, usage_source, invocation_source, raw_usage_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId ?? null,
      input.taskId ?? null,
      input.sprintRunId ?? null,
      input.dispatchId ?? null,
      input.taskRunId ?? null,
      input.attentionItemId ?? null,
      input.sessionId,
      input.provider,
      input.purpose,
      status,
      input.model ?? null,
      input.executionMode ?? null,
      input.nativeSessionId ?? null,
      input.startedAt || now,
      terminalAt,
      terminalAt ? 0 : null,
      input.promptChars ?? 0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      2,
      input.julesTokens ?? 0,
      "unavailable",
      input.invocationSource ?? "internal",
      null,
      now,
      now,
    );

    const created = requireProviderInvocationUsage(getters.getProviderInvocationUsage, id);
    notifyRealtime(created.projectId, false);
    return created;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    logger.error("Operation failed", { error, projectId: input.projectId });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}

export function writeProviderInvocationUsageIfSlotAvailable(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ProviderInvocationUsageWriteGetters,
  input: CreateProviderInvocationUsageInput,
  limit: number,
  notifyRealtime: NotifyRealtime,
): ProviderInvocationUsageRecord | null {
  if (limit <= 0) {
    return writeProviderInvocationUsage(db, logger, getters, input, notifyRealtime);
  }

  return db.transaction(() => {
    const runningRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM provider_invocations
      WHERE status = 'running'
        AND finished_at IS NULL
        AND provider = ?
        AND (
          provider <> 'jules'
          OR task_run_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM task_runs
            WHERE task_runs.id = provider_invocations.task_run_id
              AND task_runs.state = 'RUNNING'
          )
        )
    `).get(input.provider) as { count: number };

    if (runningRow.count >= limit) {
      return null;
    }

    return writeProviderInvocationUsage(db, logger, getters, input, notifyRealtime);
  });
}

export function writeProviderInvocationSessionAssociation(
  db: DatabaseAdapter,
  invocationId: string,
  sessionId: string,
  nativeSessionId?: string | null,
): void {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return;
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE provider_invocations
    SET session_id = ?, native_session_id = ?, updated_at = ?
    WHERE id = ?
  `).run(trimmed, nativeSessionId ?? trimmed, now, invocationId);
}

export function writeProviderInvocationRuntimeAssociation(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ProviderInvocationUsageWriteGetters,
  invocationId: string,
  input: { sprintRunId?: string | null; dispatchId?: string | null; taskRunId?: string | null },
  notifyRealtime: NotifyRealtime,
): ProviderInvocationUsageRecord {
  try {
    const current = requireProviderInvocationUsage(getters.getProviderInvocationUsage, invocationId);
    const sprintRunId = input.sprintRunId === undefined ? current.sprintRunId : input.sprintRunId;
    const dispatchId = input.dispatchId === undefined ? current.dispatchId : input.dispatchId;
    const taskRunId = input.taskRunId === undefined ? current.taskRunId : input.taskRunId;

    if (sprintRunId) {
      requireSprintRun(getters.getSprintRun, sprintRunId);
    }
    if (dispatchId) {
      requireTaskDispatch(getters.getTaskDispatch, dispatchId);
    }
    if (taskRunId) {
      requireTaskRun(getters.getTaskRun, taskRunId);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE provider_invocations
      SET sprint_run_id = ?, dispatch_id = ?, task_run_id = ?, updated_at = ?
      WHERE id = ?
    `).run(sprintRunId ?? null, dispatchId ?? null, taskRunId ?? null, now, invocationId);

    const updated = requireProviderInvocationUsage(getters.getProviderInvocationUsage, invocationId);
    notifyRealtime(updated.projectId, false);
    return updated;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    logger.error("Operation failed", { error, invocationId });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}

export function writeProviderInvocationUsageUpdate(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ProviderInvocationUsageWriteGetters,
  invocationId: string,
  input: UpdateProviderInvocationUsageInput,
  notifyRealtime: NotifyRealtime,
): ProviderInvocationUsageRecord {
  try {
    const current = requireProviderInvocationUsage(getters.getProviderInvocationUsage, invocationId);
    const now = new Date().toISOString();
    const nextStatus = input.status || current.status;
    const nextFinishedAt = nextStatus === "running"
      ? null
      : (input.finishedAt || current.finishedAt || now);
    const nextDurationMs = nextStatus === "running"
      ? null
      : (input.durationMs === undefined
          ? current.durationMs ?? calculateDurationMs(current.startedAt, nextFinishedAt)
          : input.durationMs);
    db.prepare(`
      UPDATE provider_invocations
      SET status = ?, model = ?, execution_mode = ?, native_session_id = ?, finished_at = ?, duration_ms = ?, transcript_chars = ?,
        input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?, total_tokens = ?,
        token_accounting_version = 2, tool_call_count = ?, jules_tokens = ?, usage_source = ?, invocation_source = ?, raw_usage_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextStatus,
      input.model === undefined ? current.model : input.model,
      input.executionMode === undefined ? current.executionMode : input.executionMode,
      input.nativeSessionId === undefined ? current.nativeSessionId : input.nativeSessionId,
      nextFinishedAt,
      nextDurationMs,
      input.transcriptChars === undefined ? current.transcriptChars : input.transcriptChars,
      input.inputTokens === undefined ? current.inputTokens : input.inputTokens,
      input.cachedInputTokens === undefined ? current.cachedInputTokens : input.cachedInputTokens,
      input.outputTokens === undefined ? current.outputTokens : input.outputTokens,
      input.reasoningOutputTokens === undefined ? current.reasoningOutputTokens : input.reasoningOutputTokens,
      input.totalTokens === undefined ? current.totalTokens : input.totalTokens,
      input.toolCallCount === undefined ? current.toolCallCount : input.toolCallCount,
      input.julesTokens === undefined ? current.julesTokens : input.julesTokens,
      input.usageSource === undefined ? current.usageSource : input.usageSource,
      input.invocationSource === undefined ? current.invocationSource : input.invocationSource,
      input.rawUsageJson === undefined
        ? JSON.stringify(current.rawUsageJson)
        : (input.rawUsageJson === null ? null : JSON.stringify(input.rawUsageJson)),
      now,
      invocationId,
    );

    const updated = requireProviderInvocationUsage(getters.getProviderInvocationUsage, invocationId);
    logger.info("Provider invocation usage updated", {
      logPurpose: "invocation",
      eventType: "provider_invocation_usage_updated",
      correlationId: getCorrelationId(),
      providerInvocationId: invocationId,
      projectId: updated.projectId,
      sprintId: updated.sprintId,
      taskId: updated.taskId,
      sprintRunId: updated.sprintRunId,
      dispatchId: updated.dispatchId,
      taskRunId: updated.taskRunId,
      sessionId: updated.sessionId,
      nativeSessionId: updated.nativeSessionId || undefined,
      provider: updated.provider,
      purpose: updated.purpose,
      status: updated.status,
      model: updated.model || undefined,
      executionMode: updated.executionMode || undefined,
      durationMs: updated.durationMs,
      transcriptChars: updated.transcriptChars,
      inputTokens: updated.inputTokens,
      cachedInputTokens: updated.cachedInputTokens,
      outputTokens: updated.outputTokens,
      reasoningOutputTokens: updated.reasoningOutputTokens,
      totalTokens: updated.totalTokens,
      toolCallCount: updated.toolCallCount,
      usageSource: updated.usageSource,
      invocationSource: updated.invocationSource,
      rawUsageJsonPresent: updated.rawUsageJson !== null,
      updatedFields: listDefinedUpdateFields(input),
    });
    notifyRealtime(updated.projectId, false);
    return updated;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    logger.error("Operation failed", { error, invocationId });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}
