import { randomUUID } from "crypto";
import { DatabaseAdapter } from "../db/database-adapter.js";
import { Logger } from "../../shared/logging/logger.js";
import { RepositoryError, EntityNotFoundError, ValidationError } from "../repository-utils.js";
import {
  requireProject,
  requireSprint,
  requireTask,
  requireSprintRun,
  requireTaskDispatch,
  requireTaskRun
} from "./execution-validators.js";
import type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
  CreateExecutionInvocationInput,
  UpdateExecutionInvocationInput,
  AppendExecutionInvocationMessageInput
} from "../../contracts/execution-types.js";

// Helper methods needed for validation
interface ValidationGetters {
  getSprintRun: (id: string) => any;
  getTaskDispatch: (id: string) => any;
  getTaskRun: (id: string) => any;
  getExecutionInvocation: (id: string) => ExecutionInvocationRecord | null;
}

export function writeExecutionInvocation(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ValidationGetters,
  input: CreateExecutionInvocationInput,
  notifyRealtime: (projectId: string, includeOverview: boolean) => void
): ExecutionInvocationRecord {
  try {
    if (!input.skipValidation) {
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
    }

    let taskAgentPresetId: string | null = null;
    if (input.taskId) {
      const taskRow = db.prepare(`SELECT agent_preset_id FROM tasks WHERE id = ?`).get(input.taskId) as { agent_preset_id: string | null } | undefined;
      taskAgentPresetId = taskRow?.agent_preset_id || null;
    }

    const id = `xi_${randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    const startedAt = input.startedAt || now;

    const record: ExecutionInvocationRecord = {
      id,
      projectId: input.projectId,
      sprintId: input.sprintId || null,
      taskId: input.taskId || null,
      sprintRunId: input.sprintRunId || null,
      dispatchId: input.dispatchId || null,
      taskRunId: input.taskRunId || null,
      attentionItemId: input.attentionItemId || null,
      providerInvocationId: input.providerInvocationId || null,
      type: input.type,
      status: input.status || "running",
      provider: input.provider || null,
      model: input.model || null,
      systemPrompt: input.systemPrompt || null,
      startedAt,
      finishedAt: input.finishedAt || null,
      errorMessage: input.errorMessage || null,
      lastErrorCategory: input.lastErrorCategory || null,
      lastErrorMessage: input.lastErrorMessage || null,
      lastRetryAfterIso: input.lastRetryAfterIso || null,
      invocationSource: input.invocationSource || "internal",
      agentPresetId: taskAgentPresetId,
      messageCount: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = db.prepare(`
      INSERT INTO execution_invocations (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, task_run_id, attention_item_id, provider_invocation_id,
        type, status, provider, model, system_prompt, started_at, finished_at, error_message, message_count, last_message_at,
        last_error_category, last_error_message, last_retry_after_iso, invocation_source, agent_preset_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.projectId,
      record.sprintId,
      record.taskId,
      record.sprintRunId,
      record.dispatchId,
      record.taskRunId,
      record.attentionItemId,
      record.providerInvocationId,
      record.type,
      record.status,
      record.provider,
      record.model,
      record.systemPrompt,
      record.startedAt,
      record.finishedAt,
      record.errorMessage,
      record.messageCount,
      record.lastMessageAt,
      record.lastErrorCategory,
      record.lastErrorMessage,
      record.lastRetryAfterIso,
      record.invocationSource || "internal",
      record.agentPresetId,
      record.createdAt,
      record.updatedAt
    );

    notifyRealtime(record.projectId, true);
    return record;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    if (error instanceof Error && (error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) {
      throw new ValidationError(error.message);
    }
    logger.error("Operation failed", { error, projectId: input.projectId });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}

export function writeExecutionInvocationUpdate(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ValidationGetters,
  id: string,
  input: UpdateExecutionInvocationInput,
  notifyRealtime: (projectId: string, includeOverview: boolean) => void
): ExecutionInvocationRecord {
  try {
    const existing = getters.getExecutionInvocation(id);
    if (!existing) {
      throw new EntityNotFoundError(`Execution invocation not found: ${id}`);
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: any[] = [];

    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
      existing.status = input.status;
    }
    if (input.providerInvocationId !== undefined) {
      updates.push("provider_invocation_id = ?");
      values.push(input.providerInvocationId);
      existing.providerInvocationId = input.providerInvocationId;
    }
    if (input.provider !== undefined) {
      updates.push("provider = ?");
      values.push(input.provider);
      existing.provider = input.provider;
    }
    if (input.model !== undefined) {
      updates.push("model = ?");
      values.push(input.model);
      existing.model = input.model;
    }
    if (input.finishedAt !== undefined) {
      updates.push("finished_at = ?");
      values.push(input.finishedAt);
      existing.finishedAt = input.finishedAt;
    }
    if (input.errorMessage !== undefined) {
      updates.push("error_message = ?");
      values.push(input.errorMessage);
      existing.errorMessage = input.errorMessage;
    }
    if (input.lastErrorCategory !== undefined) {
      updates.push("last_error_category = ?");
      values.push(input.lastErrorCategory);
      existing.lastErrorCategory = input.lastErrorCategory;
    }
    if (input.lastErrorMessage !== undefined) {
      updates.push("last_error_message = ?");
      values.push(input.lastErrorMessage);
      existing.lastErrorMessage = input.lastErrorMessage;
    }
    if (input.lastRetryAfterIso !== undefined) {
      updates.push("last_retry_after_iso = ?");
      values.push(input.lastRetryAfterIso);
      existing.lastRetryAfterIso = input.lastRetryAfterIso;
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(now);
      existing.updatedAt = now;

      values.push(id);
      const sql = `UPDATE execution_invocations SET ${updates.join(", ")} WHERE id = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...values);

      notifyRealtime(existing.projectId, true);
    }

    return existing;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    logger.error("Operation failed", { error, id });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}

export function writeClearExecutionInvocationMessages(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ValidationGetters,
  invocationId: string,
  notifyRealtime: (projectId: string, includeOverview: boolean) => void
): void {
  try {
    const invocation = getters.getExecutionInvocation(invocationId);
    if (!invocation) {
      throw new EntityNotFoundError(`Execution invocation not found: ${invocationId}`);
    }

    db.prepare(`
      DELETE FROM execution_invocation_messages
      WHERE invocation_id = ?
    `).run(invocationId);

    db.prepare(`
      UPDATE execution_invocations
      SET message_count = 0,
          last_message_at = null,
          updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), invocationId);

    notifyRealtime(invocation.projectId, false);
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    logger.error("Operation failed", { error, invocationId });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}

export function writeExecutionInvocationMessage(
  db: DatabaseAdapter,
  logger: Logger,
  getters: ValidationGetters,
  invocationId: string,
  input: AppendExecutionInvocationMessageInput,
  notifyRealtime: (projectId: string, includeOverview: boolean) => void
): ExecutionInvocationMessageRecord {
  try {
    const invocation = getters.getExecutionInvocation(invocationId);
    if (!invocation) {
      throw new EntityNotFoundError(`Execution invocation not found: ${invocationId}`);
    }

    const id = `xim_${randomUUID().replace(/-/g, "")}`;
    const now = input.createdAt || new Date().toISOString();

    const record: ExecutionInvocationMessageRecord = {
      id,
      invocationId,
      role: input.role,
      contentMarkdown: input.contentMarkdown,
      toolCallsJson: input.toolCallsJson || null,
      metadata: input.metadata || null,
      createdAt: now,
    };

    const stmt = db.prepare(`
      INSERT INTO execution_invocation_messages (
        id, invocation_id, role, content_markdown, tool_calls_json, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.invocationId,
      record.role,
      record.contentMarkdown,
      record.toolCallsJson ? JSON.stringify(record.toolCallsJson) : null,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.createdAt
    );

    const updateStmt = db.prepare(`
      UPDATE execution_invocations
      SET message_count = message_count + 1,
          last_message_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(now, now, invocationId);

    notifyRealtime(invocation.projectId, false);
    return record;
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    logger.error("Operation failed", { error, invocationId });
    throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
  }
}
