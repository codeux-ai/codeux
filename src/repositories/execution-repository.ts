import {
  queryExecutionInvocation,
  queryProviderInvocationUsage,
  queryLatestProviderInvocationUsageBySession,
  queryRunningProviderInvocationUsages,
} from "./execution/execution-invocation-query.js";
import {
  queryExecutionInvocations,
  queryExecutionInvocationMessages,
  queryExecutionInvocationsByProviderInvocationId,
  queryRunningRetryExecutionInvocations,
} from "./execution/execution-invocations-query.js";
import { randomUUID } from "crypto";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { ConcurrencyConflictError, EntityNotFoundError, RepositoryError } from "./repository-utils.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import { toNumber, parsePayloadJson } from "./repository-utils.js";
import { queryProjectExecutionSnapshot } from "./execution/project-execution-snapshot-query.js";
import {
  mapProviderInvocationUsageRow,
  mapExecutionSprintRunSummaryRow,
  mapExecutionRuntimeEventSummaryRow
} from "./execution/execution-read-model-mappers.js";


import type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
  CreateExecutionInvocationInput,
  UpdateExecutionInvocationInput,
  AppendExecutionInvocationMessageInput
} from "../contracts/execution-types.js";

import type {
  AcquireExecutionLeaseInput,
  CreateProviderInvocationUsageInput,
  SprintRunStatus,
  TaskDispatchStatus,
  CreateTaskRunInput,
  CreateSprintRunInput,
  CreateTaskDispatchInput,
  ExecutionLeaseRecord,
  ProviderInvocationUsageRecord,
  SprintRunEventRecord,
  RenewExecutionLeaseInput,
  SprintRunRecord,
  TaskRunRecord,
  TaskRunEventRecord,
  TaskDispatchRecord,
  UpdateProviderInvocationUsageInput,
  UpdateTaskRunInput,
  UpdateSprintRunInput,
  UpdateTaskDispatchInput,
} from "../contracts/execution-types.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionStatsEntitySummary,
  ExecutionHumanInterventionSummary,
  ExecutionUsageBucketSummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsChartSeries,
  OverviewTelemetryProjectSummary,
  OverviewTelemetrySnapshot,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsResolution,
  ProjectStatsWindow,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  ExecutionGitMetrics,
} from "../contracts/app-types.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import type { ProviderId } from "../contracts/app-types.js";
import { queryExecutionSprintRuns } from "./execution/execution-sprint-runs-query.js";
import { queryExecutionTaskDispatches } from "./execution/execution-task-dispatches-query.js";
import { queryExecutionRuntimeEvents } from "./execution/execution-runtime-events-query.js";
import { normalizeProjectStatsQuery } from "./execution/project-stats-query.js";
import { queryProjectStatsSnapshot } from "./execution/project-stats-snapshot-query.js";
import { OverviewTelemetryQuery } from "./execution/overview-telemetry-query.js";
import { createUsageBuckets, createEmptyUsageTotals } from "./execution/stats-buckets.js";
import { claimNextTaskDispatchTransaction } from "./execution/task-dispatch-claim-query.js";
import {
  requireProject,
  requireSprint,
  requireTask,
  requireConnection,
  requireSprintRun,
  requireSprintRunScoped,
  requireTaskDispatch,
  requireTaskRun,
  requireProviderInvocationUsage,
  requireLease
} from "./execution/execution-validators.js";

import type {
  ExecutionSprintRunSummaryRow,
  ExecutionTaskDispatchSummaryRow,
  ExecutionRuntimeEventSummaryRow,
  ProviderInvocationUsageRow,
  ProjectAttentionSummaryRow
} from "./execution/execution-repository-types.js";


interface SprintRunRow {
  id: string;
  project_id: string;
  sprint_id: string;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  executor_mode: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskDispatchRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_id: string;
  sprint_run_id: string;
  connection_id: string | null;
  executor_type: string;
  status: string;
  priority: number | string;
  queued_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionLeaseRow {
  id: string;
  scope_type: string;
  scope_id: string;
  owner_key: string;
  lease_token: string;
  acquired_at: string;
  expires_at: string;
  last_heartbeat_at: string | null;
}

interface TaskRunRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_id: string;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  connection_id: string | null;
  provider: string | null;
  mode: string | null;
  session_id: string | null;
  session_name: string | null;
  state: string;
  worker_branch: string | null;
  pr_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | string | null;
}

interface TaskRunEventRow {
  id: string;
  task_run_id: string;
  event_type: string;
  originator: string | null;
  payload_json: string | null;
  source_event_key: string | null;
  created_at: string;
}

interface SprintRunEventRow {
  id: string;
  sprint_run_id: string;
  event_type: string;
  originator: string | null;
  payload_json: string | null;
  source_event_key: string | null;
  created_at: string;
}

export interface StatsEntityMetadata {
  label: string;
  secondaryLabel: string | null;
  status: string | null;
  provider: string | null;
  purpose: string | null;
  lastActivityAt: string | null;
}

interface WorkerProjectAffinityRow {
  project_id: string;
  active_count: number | string;
  last_seen_at: string | null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cloneUsageTotals(input?: ExecutionUsageTotals | null): ExecutionUsageTotals {
  return {
    ...createEmptyUsageTotals(),
    ...(input || {}),
  };
}

export class ExecutionRepository {
  private readonly db: DatabaseAdapter;
  private readonly taskWallTimeCache = new Map<string, { finishedMs: number, hasActive: boolean }>();
  private readonly sprintRunWallTimeCache = new Map<string, { finishedMs: number, hasActive: boolean }>();
  private readonly pendingRealtimeProjectRefreshes = new Map<string, { includeOverview: boolean }>();
  private readonly leaseProjectCache = new Map<string, string>();
  private realtimeProjectRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
    private readonly logger: Logger = createLogger({ bindings: { component: "ExecutionRepository" } })
  ) {
    this.db = storage.getDatabase();
  }


  createExecutionInvocation(input: CreateExecutionInvocationInput): ExecutionInvocationRecord {
    try {
      if (!input.skipValidation) {
        requireProject(this.db, input.projectId);
        if (input.sprintId) {
          requireSprint(this.db, input.sprintId, input.projectId);
        }
        if (input.taskId) {
          requireTask(this.db, input.taskId, input.projectId, input.sprintId || undefined);
        }
        if (input.sprintRunId) {
          requireSprintRun((id) => this.getSprintRun(id), input.sprintRunId);
        }
        if (input.dispatchId) {
          requireTaskDispatch((id) => this.getTaskDispatch(id), input.dispatchId);
        }
        if (input.taskRunId) {
          requireTaskRun((id) => this.getTaskRun(id), input.taskRunId);
        }
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
        messageCount: 0,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const stmt = this.db.prepare(`
        INSERT INTO execution_invocations (
          id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, task_run_id, attention_item_id, provider_invocation_id,
          type, status, provider, model, system_prompt, started_at, finished_at, error_message, message_count, last_message_at,
          last_error_category, last_error_message, last_retry_after_iso, invocation_source,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          record.createdAt,
          record.updatedAt
      );

      this.notifyRealtime(record.projectId, true);
      return record;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId: input.projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  updateExecutionInvocation(id: string, input: UpdateExecutionInvocationInput): ExecutionInvocationRecord {
    try {
      const existing = this.getExecutionInvocation(id);
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
        const stmt = this.db.prepare(sql);
        stmt.run(...values);

        this.notifyRealtime(existing.projectId, true);
      }

      return existing;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, id });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  getExecutionInvocation(id: string): ExecutionInvocationRecord | null {
    return queryExecutionInvocation(this.db, id);
  }

  listExecutionInvocations(params: {
    projectId: string;
    sprintRunId?: string;
    taskRunId?: string;
    limit?: number;
    offset?: number;
  }): ExecutionInvocationRecord[] {
    return queryExecutionInvocations(this.db, params);
  }

  listRunningRetryExecutionInvocations(): ExecutionInvocationRecord[] {
    return queryRunningRetryExecutionInvocations(this.db);
  }

  listExecutionInvocationMessages(invocationId: string): ExecutionInvocationMessageRecord[] {
    return queryExecutionInvocationMessages(this.db, invocationId);
  }

  clearExecutionInvocationMessages(invocationId: string): void {
    try {
      const invocation = this.getExecutionInvocation(invocationId);
      if (!invocation) {
        throw new EntityNotFoundError(`Execution invocation not found: ${invocationId}`);
      }

      this.db.prepare(`
        DELETE FROM execution_invocation_messages
        WHERE invocation_id = ?
      `).run(invocationId);

      this.db.prepare(`
        UPDATE execution_invocations
        SET message_count = 0,
            last_message_at = null,
            updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), invocationId);

      this.notifyRealtime(invocation.projectId, false);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, invocationId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }


  appendExecutionInvocationMessage(invocationId: string, input: AppendExecutionInvocationMessageInput): ExecutionInvocationMessageRecord {
    try {
      const invocation = this.getExecutionInvocation(invocationId);
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

      const stmt = this.db.prepare(`
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

      const updateStmt = this.db.prepare(`
        UPDATE execution_invocations
        SET message_count = message_count + 1,
            last_message_at = ?,
            updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(now, now, invocationId);

      this.notifyRealtime(invocation.projectId, false);
      return record;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, invocationId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  createSprintRun(input: CreateSprintRunInput): SprintRunRecord {
    try {
      requireProject(this.db, input.projectId);
      requireSprint(this.db, input.sprintId, input.projectId);
      const id = randomUUID();
      const now = new Date().toISOString();

      this.db.prepare(`
        INSERT INTO sprint_runs (
          id, project_id, sprint_id, status, trigger_type, triggered_by, executor_mode,
          started_at, finished_at, last_heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.sprintId,
        input.status || "queued",
        input.triggerType || "manual",
        input.triggeredBy ?? null,
        input.executorMode || "mixed",
        null,
        null,
        null,
        now,
        now
      );

      const created = requireSprintRun((id) => this.getSprintRun(id), id);
      this.notifyRealtime(created.projectId, true);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId: input.projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  listSprintRuns(projectId: string, sprintId?: string): SprintRunRecord[] {
    requireProject(this.db, projectId);
    const rows = sprintId
      ? this.db.prepare(`
        SELECT *
        FROM sprint_runs
        WHERE project_id = ? AND sprint_id = ?
        ORDER BY created_at DESC, rowid DESC
      `).all(projectId, sprintId)
      : this.db.prepare(`
        SELECT *
        FROM sprint_runs
        WHERE project_id = ?
        ORDER BY created_at DESC, rowid DESC
      `).all(projectId);
    return (rows as unknown as SprintRunRow[]).map((row) => this.mapSprintRunRow(row));
  }

  listSprintRunsByStatus(
    statuses: SprintRunStatus[],
    options?: { projectId?: string; sprintId?: string },
  ): SprintRunRecord[] {
    const normalizedStatuses = Array.from(new Set(statuses.map((status) => String(status || "").trim()).filter(Boolean)));
    if (normalizedStatuses.length === 0) {
      return [];
    }

    const clauses = [`status IN (${normalizedStatuses.map(() => "?").join(", ")})`];
    const values: string[] = [...normalizedStatuses];

    if (options?.projectId) {
      requireProject(this.db, options.projectId);
      clauses.push("project_id = ?");
      values.push(options.projectId);
    }

    if (options?.sprintId) {
      if (options.projectId) {
        requireSprint(this.db, options.sprintId, options.projectId);
      }
      clauses.push("sprint_id = ?");
      values.push(options.sprintId);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM sprint_runs
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC, rowid DESC
    `).all(...values) as unknown as SprintRunRow[];

    return rows.map((row) => this.mapSprintRunRow(row));
  }

  getSprintRun(runId: string): SprintRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM sprint_runs
      WHERE id = ?
    `).get(runId) as SprintRunRow | undefined;
    return row ? this.mapSprintRunRow(row) : null;
  }

  findActiveSprintRun(projectId: string, sprintId: string): SprintRunRecord | null {
    requireProject(this.db, projectId);
    requireSprint(this.db, sprintId, projectId);
    const row = this.db.prepare(`
      SELECT *
      FROM sprint_runs
      WHERE project_id = ? AND sprint_id = ? AND status IN ('queued', 'running', 'paused', 'cancel_requested')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(projectId, sprintId) as SprintRunRow | undefined;
    return row ? this.mapSprintRunRow(row) : null;
  }

  updateSprintRun(runId: string, input: UpdateSprintRunInput): SprintRunRecord {
    try {
      const current = requireSprintRun((id) => this.getSprintRun(id), runId);
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE sprint_runs
        SET status = ?, executor_mode = ?, started_at = ?, finished_at = ?, last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.status || current.status,
        input.executorMode || current.executorMode,
        input.startedAt === undefined ? current.startedAt : input.startedAt,
        input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
        input.lastHeartbeatAt === undefined ? current.lastHeartbeatAt : input.lastHeartbeatAt,
        now,
        runId
      );
      const updated = requireSprintRun((id) => this.getSprintRun(id), runId);
      if (this.shouldPublishSprintRunUpdate(input)) {
        this.notifyRealtime(updated.projectId, true);
      }
      return updated;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, runId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  createTaskDispatch(input: CreateTaskDispatchInput): TaskDispatchRecord {
    try {
      requireProject(this.db, input.projectId);
      requireSprint(this.db, input.sprintId, input.projectId);
      requireTask(this.db, input.taskId, input.projectId, input.sprintId);
      requireSprintRunScoped((id) => this.getSprintRun(id), input.sprintRunId, input.projectId, input.sprintId);
      if (input.connectionId) {
        requireConnection(this.db, input.connectionId);
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const queuedAt = input.queuedAt || now;
      this.db.prepare(`
        INSERT INTO task_dispatches (
          id, project_id, sprint_id, task_id, sprint_run_id, connection_id, executor_type, status, priority,
          queued_at, claimed_at, started_at, finished_at, last_heartbeat_at, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.sprintId,
        input.taskId,
        input.sprintRunId,
        input.connectionId ?? null,
        input.executorType,
        input.status || "queued",
        input.priority ?? 0,
        queuedAt,
        null,
        null,
        null,
        null,
        null,
        now,
        now
      );

      const created = requireTaskDispatch((id) => this.getTaskDispatch(id), id);
      this.notifyRealtime(created.projectId, true);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId: input.projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  listTaskDispatches(args: { projectId: string; sprintId?: string; sprintRunId?: string; taskId?: string }): TaskDispatchRecord[] {
    requireProject(this.db, args.projectId);
    const clauses = ["project_id = ?"];
    const values: string[] = [args.projectId];
    if (args.sprintId) {
      clauses.push("sprint_id = ?");
      values.push(args.sprintId);
    }
    if (args.sprintRunId) {
      clauses.push("sprint_run_id = ?");
      values.push(args.sprintRunId);
    }
    if (args.taskId) {
      clauses.push("task_id = ?");
      values.push(args.taskId);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE ${clauses.join(" AND ")}
      ORDER BY priority DESC, queued_at ASC, created_at ASC
    `).all(...values) as unknown as TaskDispatchRow[];

    return rows.map((row) => this.mapTaskDispatchRow(row));
  }

  listTaskDispatchesByStatus(
    statuses: TaskDispatchStatus[],
    options?: { projectId?: string; sprintId?: string; sprintRunId?: string; taskId?: string; executorType?: TaskDispatchRecord["executorType"] },
  ): TaskDispatchRecord[] {
    const normalizedStatuses = Array.from(new Set(statuses.map((status) => String(status || "").trim()).filter(Boolean)));
    if (normalizedStatuses.length === 0) {
      return [];
    }

    const clauses = [`status IN (${normalizedStatuses.map(() => "?").join(", ")})`];
    const values: string[] = [...normalizedStatuses];

    if (options?.projectId) {
      requireProject(this.db, options.projectId);
      clauses.push("project_id = ?");
      values.push(options.projectId);
    }
    if (options?.sprintId) {
      clauses.push("sprint_id = ?");
      values.push(options.sprintId);
    }
    if (options?.sprintRunId) {
      clauses.push("sprint_run_id = ?");
      values.push(options.sprintRunId);
    }
    if (options?.taskId) {
      clauses.push("task_id = ?");
      values.push(options.taskId);
    }
    if (options?.executorType) {
      clauses.push("executor_type = ?");
      values.push(options.executorType);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE ${clauses.join(" AND ")}
      ORDER BY priority DESC, queued_at ASC, created_at ASC
    `).all(...values) as unknown as TaskDispatchRow[];

    return rows.map((row) => this.mapTaskDispatchRow(row));
  }

  listStaleCancelRequestedDispatches(cutoffIso: string): TaskDispatchRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE status = 'cancel_requested'
        AND COALESCE(last_heartbeat_at, updated_at, started_at, queued_at) <= ?
      ORDER BY COALESCE(last_heartbeat_at, updated_at, started_at, queued_at) ASC
    `).all(cutoffIso) as unknown as TaskDispatchRow[];

    return rows.map((row) => this.mapTaskDispatchRow(row));
  }

  updateTaskDispatchesBatch(dispatches: Array<{id: string} & UpdateTaskDispatchInput>): void {
    if (dispatches.length === 0) return;
    this.db.transaction(() => {
      for (const dispatch of dispatches) {
        this.updateTaskDispatch(dispatch.id, dispatch);
      }
    });
  }

  updateTaskDispatch(dispatchId: string, input: UpdateTaskDispatchInput): TaskDispatchRecord {
    try {
      const current = requireTaskDispatch((id) => this.getTaskDispatch(id), dispatchId);
      if (input.connectionId) {
        requireConnection(this.db, input.connectionId);
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE task_dispatches
        SET connection_id = ?, status = ?, claimed_at = ?, started_at = ?, finished_at = ?, last_heartbeat_at = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.connectionId === undefined ? current.connectionId : input.connectionId,
        input.status || current.status,
        input.claimedAt === undefined ? current.claimedAt : input.claimedAt,
        input.startedAt === undefined ? current.startedAt : input.startedAt,
        input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
        input.lastHeartbeatAt === undefined ? current.lastHeartbeatAt : input.lastHeartbeatAt,
        input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
        now,
        dispatchId
      );
      const updated = requireTaskDispatch((id) => this.getTaskDispatch(id), dispatchId);
      if (this.shouldPublishTaskDispatchUpdate(input)) {
        this.notifyRealtime(updated.projectId, true);
      }
      return updated;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, dispatchId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  createTaskRun(input: CreateTaskRunInput): TaskRunRecord {
    try {
      requireProject(this.db, input.projectId);
      requireSprint(this.db, input.sprintId, input.projectId);
      requireTask(this.db, input.taskId, input.projectId, input.sprintId);
      if (input.sprintRunId) {
        requireSprintRunScoped((id) => this.getSprintRun(id), input.sprintRunId, input.projectId, input.sprintId);
      }
      if (input.dispatchId) {
        requireTaskDispatch((id) => this.getTaskDispatch(id), input.dispatchId);
      }
      if (input.connectionId) {
        requireConnection(this.db, input.connectionId);
      }

      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO task_runs (
          id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, connection_id, provider, mode,
          session_id, session_name, state, worker_branch, pr_url, started_at, finished_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.sprintId,
        input.taskId,
        input.sprintRunId ?? null,
        input.dispatchId ?? null,
        input.connectionId ?? null,
        input.provider ?? null,
        input.mode ?? null,
        input.sessionId ?? null,
        input.sessionName ?? null,
        input.state,
        input.workerBranch ?? null,
        input.prUrl ?? null,
        input.startedAt ?? null,
        input.finishedAt ?? null,
        input.durationMs ?? null
      );

      const created = requireTaskRun((id) => this.getTaskRun(id), id);
      if (created.taskId) this.taskWallTimeCache.delete(created.taskId);
      if (created.sprintRunId) this.sprintRunWallTimeCache.delete(created.sprintRunId);
      this.notifyRealtime(created.projectId, false);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId: input.projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  createProviderInvocationUsage(input: CreateProviderInvocationUsageInput): ProviderInvocationUsageRecord {
    try {
      requireProject(this.db, input.projectId);
      if (input.sprintId) {
        requireSprint(this.db, input.sprintId, input.projectId);
      }
      if (input.taskId) {
        requireTask(this.db, input.taskId, input.projectId, input.sprintId || undefined);
      }
      if (input.sprintRunId) {
        requireSprintRun((id) => this.getSprintRun(id), input.sprintRunId);
      }
      if (input.dispatchId) {
        requireTaskDispatch((id) => this.getTaskDispatch(id), input.dispatchId);
      }
      if (input.taskRunId) {
        requireTaskRun((id) => this.getTaskRun(id), input.taskRunId);
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO provider_invocations (
          id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, task_run_id, attention_item_id,
          session_id, provider, purpose, status, model, execution_mode, native_session_id, started_at, finished_at, duration_ms,
          prompt_chars, transcript_chars, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
          total_tokens, jules_tokens, usage_source, invocation_source, raw_usage_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.status || "running",
        input.model ?? null,
        input.executionMode ?? null,
        input.nativeSessionId ?? null,
        input.startedAt || now,
        null,
        null,
        input.promptChars ?? 0,
        0,
        0,
        0,
        0,
        0,
        0,
        input.julesTokens ?? 0,
        "unavailable",
        input.invocationSource ?? "internal",
        null,
        now,
        now,
      );

      const created = requireProviderInvocationUsage((id) => this.getProviderInvocationUsage(id), id);
      this.notifyRealtime(created.projectId, false);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId: input.projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  updateProviderInvocationUsage(invocationId: string, input: UpdateProviderInvocationUsageInput): ProviderInvocationUsageRecord {
    try {
      const current = requireProviderInvocationUsage((id) => this.getProviderInvocationUsage(id), invocationId);
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE provider_invocations
        SET status = ?, model = ?, execution_mode = ?, native_session_id = ?, finished_at = ?, duration_ms = ?, transcript_chars = ?,
          input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?, total_tokens = ?,
          jules_tokens = ?, usage_source = ?, invocation_source = ?, raw_usage_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.status || current.status,
        input.model === undefined ? current.model : input.model,
        input.executionMode === undefined ? current.executionMode : input.executionMode,
        input.nativeSessionId === undefined ? current.nativeSessionId : input.nativeSessionId,
        input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
        input.durationMs === undefined ? current.durationMs : input.durationMs,
        input.transcriptChars === undefined ? current.transcriptChars : input.transcriptChars,
        input.inputTokens === undefined ? current.inputTokens : input.inputTokens,
        input.cachedInputTokens === undefined ? current.cachedInputTokens : input.cachedInputTokens,
        input.outputTokens === undefined ? current.outputTokens : input.outputTokens,
        input.reasoningOutputTokens === undefined ? current.reasoningOutputTokens : input.reasoningOutputTokens,
        input.totalTokens === undefined ? current.totalTokens : input.totalTokens,
        input.julesTokens === undefined ? current.julesTokens : input.julesTokens,
        input.usageSource === undefined ? current.usageSource : input.usageSource,
        input.invocationSource === undefined ? current.invocationSource : input.invocationSource,
        input.rawUsageJson === undefined
          ? JSON.stringify(current.rawUsageJson)
          : (input.rawUsageJson === null ? null : JSON.stringify(input.rawUsageJson)),
        now,
        invocationId,
      );

      const updated = requireProviderInvocationUsage((id) => this.getProviderInvocationUsage(id), invocationId);
      this.notifyRealtime(updated.projectId, false);
      return updated;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, invocationId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  getTaskRun(taskRunId: string): TaskRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE id = ?
    `).get(taskRunId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getProviderInvocationUsage(invocationId: string): ProviderInvocationUsageRecord | null {
    return queryProviderInvocationUsage(this.db, invocationId);
  }

  getLatestProviderInvocationUsageBySession(
    sessionId: string,
    purpose?: ProviderInvocationUsageRecord["purpose"],
  ): ProviderInvocationUsageRecord | null {
    return queryLatestProviderInvocationUsageBySession(this.db, sessionId, purpose);
  }

  listRunningProviderInvocationUsages(providers?: string[]): ProviderInvocationUsageRecord[] {
    return queryRunningProviderInvocationUsages(this.db, providers);
  }

  listExecutionInvocationsByProviderInvocationId(providerInvocationId: string): ExecutionInvocationRecord[] {
    return queryExecutionInvocationsByProviderInvocationId(this.db, providerInvocationId);
  }

  getLatestTaskRunBySessionId(sessionId: string): TaskRunRecord | null {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return null;
    }
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE session_id = ?
      ORDER BY rowid DESC
      LIMIT 1
    `).get(normalizedSessionId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getTaskDispatch(dispatchId: string): TaskDispatchRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_dispatches
      WHERE id = ?
    `).get(dispatchId) as TaskDispatchRow | undefined;
    return row ? this.mapTaskDispatchRow(row) : null;
  }

  getTaskRunByDispatchId(dispatchId: string): TaskRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE dispatch_id = ?
      ORDER BY rowid DESC
      LIMIT 1
    `).get(dispatchId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getLatestTaskRun(taskId: string, sprintRunId?: string): TaskRunRecord | null {
    requireTask(this.db, taskId);
    const row = sprintRunId
      ? this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ?
        AND sprint_run_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId, sprintRunId) as TaskRunRow | undefined
      : this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId) as TaskRunRow | undefined;
    return row ? this.mapTaskRunRow(row) : null;
  }

  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {
    requireProject(this.db, projectId);
    return queryProjectExecutionSnapshot(this.db, this.storage, projectId, {
      getUsageTotalsByTaskIds: (pId, tIds) => this.getUsageTotalsByTaskIds(pId, tIds),
      getUsageTotalsBySprintRunIds: (pId, sIds) => this.getUsageTotalsBySprintRunIds(pId, sIds),
      getWallTimeTotalsByTaskIds: (pId, tIds, now) => this.getWallTimeTotalsByTaskIds(pId, tIds, now),
      getWallTimeTotalsBySprintRunIds: (pId, sIds, now) => this.getWallTimeTotalsBySprintRunIds(pId, sIds, now),
    });
  }

  getProjectStatsSnapshot(
    projectId: string,
    input: ProjectStatsQuery | ProjectStatsWindow = "7d",
  ): ProjectExecutionStatsSnapshot {
    const taskMetaCache = new Map<string, StatsEntityMetadata>();
    const sprintMetaCache = new Map<string, StatsEntityMetadata>();

    return queryProjectStatsSnapshot(this.db, projectId, input, {
      requireProject: (id) => requireProject(this.db, id),
      getWallTimeTotalsByTaskIdsForRange: (id, start, end, now) => this.getWallTimeTotalsByTaskIdsForRange(id, start, end, now),
      getWallTimeTotalsBySprintRunIdsForRange: (id, start, end, now) => this.getWallTimeTotalsBySprintRunIdsForRange(id, start, end, now),
      getTaskMetadata: (id, ids) => {
        const missing = ids.filter(i => !taskMetaCache.has(i));
        if (missing.length > 0) {
          const fresh = this.getTaskMetadata(id, missing);
          for (const [k, v] of fresh.entries()) taskMetaCache.set(k, v);
        }
        return new Map(ids.filter(i => taskMetaCache.has(i)).map(i => [i, taskMetaCache.get(i)!] as const));
      },
      getSprintMetadata: (id, ids) => {
        const missing = ids.filter(i => !sprintMetaCache.has(i));
        if (missing.length > 0) {
          const fresh = this.getSprintMetadata(id, missing);
          for (const [k, v] of fresh.entries()) sprintMetaCache.set(k, v);
        }
        return new Map(ids.filter(i => sprintMetaCache.has(i)).map(i => [i, sprintMetaCache.get(i)!] as const));
      },
      updateLastActivity: (map, key, date) => this.updateLastActivity(map, key, date),
    });
  }

  getOverviewTelemetrySnapshot(): OverviewTelemetrySnapshot {
    return new OverviewTelemetryQuery(this.db, this.storage).getOverviewTelemetrySnapshot();
  }

  countRunningTasksPerProvider(projectId: string): Map<ProviderId, number> {
    requireProject(this.db, projectId);
    const rows = this.db.prepare(`
      SELECT provider, COUNT(*) as count
      FROM task_runs
      WHERE project_id = ? AND state = 'RUNNING' AND provider IS NOT NULL
      GROUP BY provider
    `).all(projectId) as Array<{ provider: string; count: number | string }>;

    const map = new Map<ProviderId, number>();
    for (const row of rows) {
      if (row.provider) {
        map.set(row.provider as ProviderId, toNumber(row.count));
      }
    }
    return map;
  }

  updateTaskRunsBatch(runs: Array<{id: string} & UpdateTaskRunInput>): void {
    if (runs.length === 0) return;
    this.db.transaction(() => {
      for (const run of runs) {
        this.updateTaskRun(run.id, run);
      }
    });
  }

  updateTaskRun(taskRunId: string, input: UpdateTaskRunInput): TaskRunRecord {
    try {
      const current = requireTaskRun((id) => this.getTaskRun(id), taskRunId);
      this.db.prepare(`
        UPDATE task_runs
        SET connection_id = ?, provider = ?, mode = ?, session_id = ?, session_name = ?, state = ?, worker_branch = ?,
            pr_url = ?, started_at = ?, finished_at = ?, duration_ms = ?
        WHERE id = ?
      `).run(
        input.connectionId === undefined ? current.connectionId : input.connectionId,
        input.provider === undefined ? current.provider : input.provider,
        input.mode === undefined ? current.mode : input.mode,
        input.sessionId === undefined ? current.sessionId : input.sessionId,
        input.sessionName === undefined ? current.sessionName : input.sessionName,
        input.state === undefined ? current.state : input.state,
        input.workerBranch === undefined ? current.workerBranch : input.workerBranch,
        input.prUrl === undefined ? current.prUrl : input.prUrl,
        input.startedAt === undefined ? current.startedAt : input.startedAt,
        input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
        input.durationMs === undefined ? current.durationMs : input.durationMs,
        taskRunId
      );
      const updated = requireTaskRun((id) => this.getTaskRun(id), taskRunId);
      if (updated.taskId) this.taskWallTimeCache.delete(updated.taskId);
      if (updated.sprintRunId) this.sprintRunWallTimeCache.delete(updated.sprintRunId);
      this.notifyRealtime(updated.projectId, false);
      return updated;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, taskRunId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  listLatestTaskRuns(taskIds: string[], sprintRunId?: string): Map<string, TaskRunRecord> {
    const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
    if (uniqueTaskIds.length === 0) {
      return new Map();
    }

    const runClause = sprintRunId ? "AND sprint_run_id = ?" : "";
    const rows = this.storage.executeChunkedInQuery<TaskRunRow>({
      sqlPrefix: `SELECT tr.*
      FROM task_runs tr
      INNER JOIN (
        SELECT task_id, MAX(rowid) AS latest_rowid
        FROM task_runs
        WHERE task_id`,
      sqlSuffix: `${runClause}
        GROUP BY task_id
      ) latest ON latest.latest_rowid = tr.rowid
      ORDER BY tr.rowid DESC`,
      items: uniqueTaskIds,
      bindParamsAfter: sprintRunId ? [sprintRunId] : [],
    });

    const map = new Map<string, TaskRunRecord>();
    for (const row of rows) {
      if (!map.has(row.task_id)) {
        map.set(row.task_id, this.mapTaskRunRow(row));
      }
    }
    return map;
  }

  appendTaskRunEvent(
    taskRunId: string,
    eventType: string,
    originator: string,
    payload: Record<string, unknown>,
    options?: { createdAt?: string; sourceEventKey?: string | null },
  ): boolean {
    const taskRun = requireTaskRun((id) => this.getTaskRun(id), taskRunId);
    if (taskRun.taskId) this.taskWallTimeCache.delete(taskRun.taskId);
    if (taskRun.sprintRunId) this.sprintRunWallTimeCache.delete(taskRun.sprintRunId);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO task_run_events (id, task_run_id, event_type, originator, payload_json, source_event_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      taskRunId,
      eventType,
      originator,
      JSON.stringify(payload),
      options?.sourceEventKey ?? null,
      options?.createdAt || new Date().toISOString()
    );
    const inserted = Number((result as { changes?: number }).changes || 0) > 0;
    if (inserted) {
      this.notifyRealtime(taskRun.projectId, false);
    }
    return inserted;
  }

  appendSprintRunEvent(
    sprintRunId: string,
    eventType: string,
    originator: string,
    payload: Record<string, unknown>,
    options?: { createdAt?: string; sourceEventKey?: string | null },
  ): boolean {
    const sprintRun = requireSprintRun((id) => this.getSprintRun(id), sprintRunId);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO sprint_run_events (id, sprint_run_id, event_type, originator, payload_json, source_event_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      sprintRunId,
      eventType,
      originator,
      JSON.stringify(payload),
      options?.sourceEventKey ?? null,
      options?.createdAt || new Date().toISOString(),
    );
    const inserted = Number((result as { changes?: number }).changes || 0) > 0;
    if (inserted) {
      this.notifyRealtime(sprintRun.projectId, true);
    }
    return inserted;
  }

  listTaskRunEvents(taskRunId: string, limit: number = 50): TaskRunEventRecord[] {
    requireTaskRun((id) => this.getTaskRun(id), taskRunId);
    const rows = this.db.prepare(`
      SELECT *
      FROM task_run_events
      WHERE task_run_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(taskRunId, Math.max(1, limit)) as unknown as TaskRunEventRow[];
    return rows.map((row) => this.mapTaskRunEventRow(row));
  }

  listSprintRunEvents(sprintRunId: string, limit: number = 50): SprintRunEventRecord[] {
    requireSprintRun((id) => this.getSprintRun(id), sprintRunId);
    const rows = this.db.prepare(`
      SELECT *
      FROM sprint_run_events
      WHERE sprint_run_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(sprintRunId, Math.max(1, limit)) as unknown as SprintRunEventRow[];
    return rows.map((row) => this.mapSprintRunEventRow(row));
  }

  claimNextTaskDispatch(args: {
    projectId: string;
    executorType: TaskDispatchRecord["executorType"];
    connectionId?: string | null;
    sprintId?: string;
    sprintRunId?: string;
  }): TaskDispatchRecord | null {
    const nowIso = new Date().toISOString();
    const claimedId = claimNextTaskDispatchTransaction(this.db, {
      ...args,
      nowIso,
    });

    if (!claimedId) {
      return null;
    }

    const updated = requireTaskDispatch((id) => this.getTaskDispatch(id), claimedId);
    this.notifyRealtime(updated.projectId, true);
    return updated;
  }

  listWorkerProjectAffinity(connectionId: string): string[] {
    void connectionId;
    return [];
  }

  acquireLease(input: AcquireExecutionLeaseInput): ExecutionLeaseRecord {
    try {
      const existing = this.getLease(input.scopeType, input.scopeId);
      const now = new Date().toISOString();

      if (existing && existing.expiresAt > now && existing.leaseToken !== input.leaseToken) {
        throw new ConcurrencyConflictError(`Lease already held for ${input.scopeType}:${input.scopeId}`);
      }

      if (existing) {
        this.db.prepare(`
          UPDATE execution_leases
          SET owner_key = ?, lease_token = ?, acquired_at = ?, expires_at = ?, last_heartbeat_at = ?
          WHERE scope_type = ? AND scope_id = ?
        `).run(
          input.ownerKey,
          input.leaseToken,
          now,
          input.expiresAt,
          now,
          input.scopeType,
          input.scopeId
        );
        const updated = requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
        this.notifyRealtimeForLease(input.scopeType, input.scopeId);
        return updated;
      }

      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO execution_leases (id, scope_type, scope_id, owner_key, lease_token, acquired_at, expires_at, last_heartbeat_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.scopeType,
        input.scopeId,
        input.ownerKey,
        input.leaseToken,
        now,
        input.expiresAt,
        now
      );
      const created = requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
      this.notifyRealtimeForLease(input.scopeType, input.scopeId);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, scopeType: input.scopeType, scopeId: input.scopeId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  renewLease(input: RenewExecutionLeaseInput): ExecutionLeaseRecord {
    try {
      const current = requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
      if (current.leaseToken !== input.leaseToken) {
        throw new ConcurrencyConflictError(`Lease token mismatch for ${input.scopeType}:${input.scopeId}`);
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE execution_leases
        SET expires_at = ?, last_heartbeat_at = ?
        WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
      `).run(input.expiresAt, now, input.scopeType, input.scopeId, input.leaseToken);
      return requireLease((type, id) => this.getLease(type, id), input.scopeType, input.scopeId);
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, scopeType: input.scopeType, scopeId: input.scopeId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  releaseLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string, leaseToken?: string): void {
    try {
      const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
      this.leaseProjectCache.delete(`${scopeType}:${scopeId}`);

      if (leaseToken) {
        this.db.prepare(`
          DELETE FROM execution_leases
          WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
        `).run(scopeType, scopeId, leaseToken);
        if (projectId) {
          this.notifyRealtime(projectId, false);
        }
        return;
      }

      this.db.prepare(`
        DELETE FROM execution_leases
        WHERE scope_type = ? AND scope_id = ?
      `).run(scopeType, scopeId);
      if (projectId) {
        this.notifyRealtime(projectId, false);
      }
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, scopeType, scopeId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  releaseStaleSprintLease(projectId: string, sprintId: string): boolean {
    try {
      requireProject(this.db, projectId);
      requireSprint(this.db, sprintId, projectId);

      const lease = this.getLease("sprint", sprintId);
      if (!lease) {
        return false;
      }

      const activeRun = this.findActiveSprintRun(projectId, sprintId);
      if (activeRun) {
        if (activeRun.status === "running" || activeRun.status === "queued") {
          return false;
        }
        if (activeRun.status === "cancel_requested" && this.hasActiveTaskDispatches(activeRun.id)) {
          return false;
        }
      }

      this.releaseLease("sprint", sprintId, lease.leaseToken);
      return true;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId, sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  getLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId) as ExecutionLeaseRow | undefined;
    return row ? this.mapExecutionLeaseRow(row) : null;
  }

  listAllLeases(scopeType?: ExecutionLeaseRecord["scopeType"]): ExecutionLeaseRecord[] {
    const rows = scopeType
      ? this.db.prepare(`
        SELECT *
        FROM execution_leases
        WHERE scope_type = ?
      `).all(scopeType)
      : this.db.prepare(`
        SELECT *
        FROM execution_leases
      `).all();

    return (rows as unknown as ExecutionLeaseRow[]).map((row) => this.mapExecutionLeaseRow(row));
  }

  listExpiredLeases(scopeType?: ExecutionLeaseRecord["scopeType"], now = new Date()): ExecutionLeaseRecord[] {
    const nowIso = now.toISOString();
    const rows = scopeType
      ? this.db.prepare(`
        SELECT *
        FROM execution_leases
        WHERE scope_type = ?
          AND expires_at <= ?
        ORDER BY expires_at ASC
      `).all(scopeType, nowIso)
      : this.db.prepare(`
        SELECT *
        FROM execution_leases
        WHERE expires_at <= ?
        ORDER BY expires_at ASC
      `).all(nowIso);

    return (rows as unknown as ExecutionLeaseRow[]).map((row) => this.mapExecutionLeaseRow(row));
  }

  hasActiveTaskDispatches(sprintRunId: string): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM task_dispatches
      WHERE sprint_run_id = ?
        AND status IN ('queued', 'claimed', 'running', 'cancel_requested')
    `).get(sprintRunId) as { total: number | string } | undefined;
    return toNumber(row?.total || 0) > 0;
  }

  finalizeSprintRunCancellationIfIdle(sprintRunId: string): SprintRunRecord | null {
    const sprintRun = this.getSprintRun(sprintRunId);
    if (!sprintRun || sprintRun.status !== "cancel_requested" || this.hasActiveTaskDispatches(sprintRunId)) {
      return null;
    }

    const now = new Date().toISOString();
    const updated = this.updateSprintRun(sprintRunId, {
      status: "cancelled",
      finishedAt: now,
      lastHeartbeatAt: now,
    });
    this.appendSprintRunEvent(sprintRunId, "sprint_cancelled", "system", {
      reason: "cancel_request_completed",
    }, {
      sourceEventKey: `sprint-cancelled:${sprintRunId}:cancel-request-completed`,
    });
    this.releaseStaleSprintLease(updated.projectId, updated.sprintId);
    return updated;
  }


  private getUsageTotalsByTaskIds(projectId: string, taskIds: string[]): Map<string, ExecutionUsageTotals> {
    if (taskIds.length === 0) {
      return new Map();
    }
    const rows = this.storage.executeChunkedInQuery<any>({
      sqlPrefix: `
        SELECT
          task_id,
          COUNT(*) as invocationCount,
          SUM(COALESCE(duration_ms, 0)) as activeTimeMs,
          SUM(input_tokens) as inputTokens,
          SUM(cached_input_tokens) as cachedInputTokens,
          SUM(output_tokens) as outputTokens,
          SUM(reasoning_output_tokens) as reasoningOutputTokens,
          SUM(total_tokens) as totalTokens,
          SUM(CASE WHEN usage_source = 'reported' THEN 1 ELSE 0 END) as reportedInvocationCount,
          SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) as estimatedInvocationCount,
          SUM(CASE WHEN usage_source = 'unsupported' THEN 1 ELSE 0 END) as unsupportedInvocationCount,
          SUM(CASE WHEN usage_source NOT IN ('reported', 'estimated', 'unsupported') THEN 1 ELSE 0 END) as unavailableInvocationCount
        FROM provider_invocations
        WHERE project_id = ? AND task_id`,
      items: taskIds,
      bindParamsBefore: [projectId],
      sqlSuffix: "GROUP BY task_id"
    });

    const map = new Map<string, ExecutionUsageTotals>();
    for (const row of rows) {
      map.set(row.task_id, {
        invocationCount: toNumber(row.invocationCount),
        activeTimeMs: toNumber(row.activeTimeMs),
        wallTimeMs: 0,
        inputTokens: toNumber(row.inputTokens),
        cachedInputTokens: toNumber(row.cachedInputTokens),
        outputTokens: toNumber(row.outputTokens),
        reasoningOutputTokens: toNumber(row.reasoningOutputTokens),
        totalTokens: toNumber(row.totalTokens),
        reportedInvocationCount: toNumber(row.reportedInvocationCount),
        estimatedInvocationCount: toNumber(row.estimatedInvocationCount),
        unsupportedInvocationCount: toNumber(row.unsupportedInvocationCount),
        unavailableInvocationCount: toNumber(row.unavailableInvocationCount),
      });
    }
    return map;
  }

  private getUsageTotalsBySprintRunIds(projectId: string, sprintRunIds: string[]): Map<string, ExecutionUsageTotals> {
    if (sprintRunIds.length === 0) {
      return new Map();
    }
    const rows = this.storage.executeChunkedInQuery<any>({
      sqlPrefix: `
        SELECT
          sprint_run_id,
          COUNT(*) as invocationCount,
          SUM(COALESCE(duration_ms, 0)) as activeTimeMs,
          SUM(input_tokens) as inputTokens,
          SUM(cached_input_tokens) as cachedInputTokens,
          SUM(output_tokens) as outputTokens,
          SUM(reasoning_output_tokens) as reasoningOutputTokens,
          SUM(total_tokens) as totalTokens,
          SUM(CASE WHEN usage_source = 'reported' THEN 1 ELSE 0 END) as reportedInvocationCount,
          SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) as estimatedInvocationCount,
          SUM(CASE WHEN usage_source = 'unsupported' THEN 1 ELSE 0 END) as unsupportedInvocationCount,
          SUM(CASE WHEN usage_source NOT IN ('reported', 'estimated', 'unsupported') THEN 1 ELSE 0 END) as unavailableInvocationCount
        FROM provider_invocations
        WHERE project_id = ? AND sprint_run_id`,
      items: sprintRunIds,
      bindParamsBefore: [projectId],
      sqlSuffix: "GROUP BY sprint_run_id"
    });

    const map = new Map<string, ExecutionUsageTotals>();
    for (const row of rows) {
      map.set(row.sprint_run_id, {
        invocationCount: toNumber(row.invocationCount),
        activeTimeMs: toNumber(row.activeTimeMs),
        wallTimeMs: 0,
        inputTokens: toNumber(row.inputTokens),
        cachedInputTokens: toNumber(row.cachedInputTokens),
        outputTokens: toNumber(row.outputTokens),
        reasoningOutputTokens: toNumber(row.reasoningOutputTokens),
        totalTokens: toNumber(row.totalTokens),
        reportedInvocationCount: toNumber(row.reportedInvocationCount),
        estimatedInvocationCount: toNumber(row.estimatedInvocationCount),
        unsupportedInvocationCount: toNumber(row.unsupportedInvocationCount),
        unavailableInvocationCount: toNumber(row.unavailableInvocationCount),
      });
    }
    return map;
  }

  private getWallTimeTotalsByTaskIds(projectId: string, taskIds: string[], nowIso: string): Map<string, number> {
    if (taskIds.length === 0) return new Map();
    const result = new Map<string, number>();
    const missingTaskIds: string[] = [];
    const activeTaskIds: string[] = [];

    for (const taskId of taskIds) {
      if (this.taskWallTimeCache.has(taskId)) {
        const cache = this.taskWallTimeCache.get(taskId)!;
        result.set(taskId, cache.finishedMs);
        if (cache.hasActive) {
          activeTaskIds.push(taskId);
        }
      } else {
        missingTaskIds.push(taskId);
      }
    }

    if (missingTaskIds.length > 0) {
      const activeRows = this.storage.executeChunkedInQuery<{ task_id: string; c: number | string }>({
        sqlPrefix: `SELECT task_id, COUNT(*) as c FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND task_id`,
        sqlSuffix: "GROUP BY task_id",
        items: missingTaskIds,
      });
      const activeMap = new Set(activeRows.map(r => r.task_id));

      const finishedRows = this.storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT task_id, SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) AS total_duration_ms FROM task_runs WHERE task_id`,
        sqlSuffix: "GROUP BY task_id",
        items: missingTaskIds,
      });
      const finishedMap = new Map(finishedRows.map(r => [r.task_id, Math.max(0, Number(r.total_duration_ms) || 0)]));

      for (const taskId of missingTaskIds) {
        const finishedMs = finishedMap.get(taskId) || 0;
        const hasActive = activeMap.has(taskId);
        this.taskWallTimeCache.set(taskId, { finishedMs, hasActive });
        result.set(taskId, finishedMs);
        if (hasActive) {
          activeTaskIds.push(taskId);
        }
      }
    }

    if (activeTaskIds.length > 0) {
      const activeTimeRows = this.storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT task_id, SUM(CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)) AS total_duration_ms FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND task_id`,
        sqlSuffix: "GROUP BY task_id",
        items: activeTaskIds,
        bindParamsBefore: [nowIso]
      });
      for (const row of activeTimeRows) {
        result.set(row.task_id, (result.get(row.task_id) || 0) + Math.max(0, Number(row.total_duration_ms) || 0));
      }
    }

    return result;
  }

  private getWallTimeTotalsBySprintRunIds(projectId: string, sprintRunIds: string[], nowIso: string): Map<string, number> {
    if (sprintRunIds.length === 0) return new Map();
    const result = new Map<string, number>();
    const missingIds: string[] = [];
    const activeIds: string[] = [];

    for (const sprintRunId of sprintRunIds) {
      if (this.sprintRunWallTimeCache.has(sprintRunId)) {
        const cache = this.sprintRunWallTimeCache.get(sprintRunId)!;
        result.set(sprintRunId, cache.finishedMs);
        if (cache.hasActive) {
          activeIds.push(sprintRunId);
        }
      } else {
        missingIds.push(sprintRunId);
      }
    }

    if (missingIds.length > 0) {
      const activeRows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; c: number | string }>({
        sqlPrefix: `SELECT sprint_run_id, COUNT(*) as c FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND sprint_run_id`,
        sqlSuffix: "GROUP BY sprint_run_id",
        items: missingIds,
      });
      const activeMap = new Set(activeRows.map(r => r.sprint_run_id));

      const finishedRows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT sprint_run_id, SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) AS total_duration_ms FROM task_runs WHERE sprint_run_id`,
        sqlSuffix: "GROUP BY sprint_run_id",
        items: missingIds,
      });
      const finishedMap = new Map(finishedRows.map(r => [r.sprint_run_id, Math.max(0, Number(r.total_duration_ms) || 0)]));

      for (const sprintRunId of missingIds) {
        const finishedMs = finishedMap.get(sprintRunId) || 0;
        const hasActive = activeMap.has(sprintRunId);
        this.sprintRunWallTimeCache.set(sprintRunId, { finishedMs, hasActive });
        result.set(sprintRunId, finishedMs);
        if (hasActive) {
          activeIds.push(sprintRunId);
        }
      }
    }

    if (activeIds.length > 0) {
      const activeTimeRows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
        sqlPrefix: `SELECT sprint_run_id, SUM(CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)) AS total_duration_ms FROM task_runs WHERE finished_at IS NULL AND started_at IS NOT NULL AND sprint_run_id`,
        sqlSuffix: "GROUP BY sprint_run_id",
        items: activeIds,
        bindParamsBefore: [nowIso]
      });
      for (const row of activeTimeRows) {
        result.set(row.sprint_run_id, (result.get(row.sprint_run_id) || 0) + Math.max(0, Number(row.total_duration_ms) || 0));
      }
    }

    return result;
  }

  private getWallTimeTotalsByTaskIdsForRange(projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT
        task_id,
        SUM(
          CASE
            WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
            WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
            ELSE 0
          END
        ) AS total_duration_ms
      FROM task_runs
      WHERE project_id = ?
        AND task_id IS NOT NULL
        AND COALESCE(finished_at, started_at) >= ?
        AND COALESCE(finished_at, started_at) < ?
      GROUP BY task_id
    `).all(nowIso, projectId, rangeStartIso, rangeEndIso) as unknown as Array<{ task_id: string; total_duration_ms: number | string }>;

    return new Map(rows.map((row) => [row.task_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
  }

  private getWallTimeTotalsBySprintRunIdsForRange(projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT
        sprint_run_id,
        SUM(
          CASE
            WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
            WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
            ELSE 0
          END
        ) AS total_duration_ms
      FROM task_runs
      WHERE project_id = ?
        AND sprint_run_id IS NOT NULL
        AND COALESCE(finished_at, started_at) >= ?
        AND COALESCE(finished_at, started_at) < ?
      GROUP BY sprint_run_id
    `).all(nowIso, projectId, rangeStartIso, rangeEndIso) as unknown as Array<{ sprint_run_id: string; total_duration_ms: number | string }>;

    return new Map(rows.map((row) => [row.sprint_run_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
  }

  private getTaskMetadata(projectId: string, ids: string[]): Map<string, StatsEntityMetadata> {
    if (ids.length === 0) {
      return new Map();
    }
    const chunkMap = new Map<string, StatsEntityMetadata>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db.prepare(`
        SELECT t.id, t.task_key, t.title, t.status, s.name AS sprint_name
        FROM tasks t
        INNER JOIN sprints s ON s.id = t.sprint_id
        WHERE t.project_id = ? AND t.id IN (${placeholders})
      `).all(projectId, ...chunk) as unknown as Array<{ id: string; task_key: string; title: string; status: string; sprint_name: string }>;
      for (const row of rows) {
        chunkMap.set(row.id, {
          label: `${row.task_key} ${row.title}`.trim(),
          secondaryLabel: row.sprint_name,
          status: row.status,
          provider: null,
          purpose: null,
          lastActivityAt: null,
        });
      }
    }
    return chunkMap;
  }

  private getSprintMetadata(projectId: string, ids: string[]): Map<string, StatsEntityMetadata> {
    if (ids.length === 0) {
      return new Map();
    }
    const chunkMap = new Map<string, StatsEntityMetadata>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db.prepare(`
        SELECT s.id AS sprint_id, sr.id AS sprint_run_id, s.name, s.number, sr.status
        FROM sprints s
        LEFT JOIN sprint_runs sr ON sr.sprint_id = s.id
        WHERE s.project_id = ? AND (s.id IN (${placeholders}) OR sr.id IN (${placeholders}))
      `).all(projectId, ...chunk, ...chunk) as unknown as Array<{
        sprint_id: string;
        sprint_run_id: string | null;
        name: string;
        number: number | string | null;
        status: string | null;
      }>;

      for (const row of rows) {
        const summary = {
          label: row.number === null ? row.name : `Sprint ${toNumber(row.number)} · ${row.name}`,
          secondaryLabel: null,
          status: row.status,
          provider: null,
          purpose: null,
          lastActivityAt: null,
        } as const;
        chunkMap.set(row.sprint_id, summary);
        if (row.sprint_run_id) {
          chunkMap.set(row.sprint_run_id, summary);
        }
      }
    }
    return chunkMap;
  }


  private withLastActivityMetadata(
    metadata: Map<string, StatsEntityMetadata>,
    lastActivityMap: Map<string, string>,
  ): Map<string, StatsEntityMetadata> {
    const next = new Map(metadata);
    for (const [id, lastActivityAt] of lastActivityMap.entries()) {
      const current = next.get(id);
      if (current) {
        next.set(id, { ...current, lastActivityAt });
        continue;
      }
      next.set(id, {
        label: id,
        secondaryLabel: null,
        status: null,
        provider: null,
        purpose: null,
        lastActivityAt,
      });
    }
    return next;
  }

  private updateLastActivity(map: Map<string, string>, key: string | null | undefined, value: string | null | undefined): void {
    if (!key || !value) {
      return;
    }
    const current = map.get(key);
    if (!current || new Date(value).getTime() > new Date(current).getTime()) {
      map.set(key, value);
    }
  }










  private mapSprintRunRow(row: SprintRunRow): SprintRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      status: row.status as SprintRunRecord["status"],
      triggerType: row.trigger_type as SprintRunRecord["triggerType"],
      triggeredBy: row.triggered_by,
      executorMode: row.executor_mode as SprintRunRecord["executorMode"],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTaskDispatchRow(row: TaskDispatchRow): TaskDispatchRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      connectionId: row.connection_id,
      executorType: row.executor_type as TaskDispatchRecord["executorType"],
      status: row.status as TaskDispatchRecord["status"],
      priority: toNumber(row.priority),
      queuedAt: row.queued_at,
      claimedAt: row.claimed_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapExecutionLeaseRow(row: ExecutionLeaseRow): ExecutionLeaseRecord {
    return {
      id: row.id,
      scopeType: row.scope_type as ExecutionLeaseRecord["scopeType"],
      scopeId: row.scope_id,
      ownerKey: row.owner_key,
      leaseToken: row.lease_token,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
      lastHeartbeatAt: row.last_heartbeat_at,
    };
  }

  private mapTaskRunRow(row: TaskRunRow): TaskRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      connectionId: row.connection_id,
      provider: row.provider,
      mode: row.mode,
      sessionId: row.session_id,
      sessionName: row.session_name,
      state: row.state as TaskRunRecord["state"],
      workerBranch: row.worker_branch,
      prUrl: row.pr_url,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms === null ? null : toNumber(row.duration_ms),
    };
  }

  private mapTaskRunEventRow(row: TaskRunEventRow): TaskRunEventRecord {
    return {
      id: row.id,
      taskRunId: row.task_run_id,
      eventType: row.event_type,
      originator: row.originator,
      payload: parsePayloadJson(row.payload_json),
      sourceEventKey: row.source_event_key,
      createdAt: row.created_at,
    };
  }


  private mapSprintRunEventRow(row: SprintRunEventRow): SprintRunEventRecord {
    return {
      id: row.id,
      sprintRunId: row.sprint_run_id,
      eventType: row.event_type,
      originator: row.originator,
      payload: parsePayloadJson(row.payload_json),
      sourceEventKey: row.source_event_key,
      createdAt: row.created_at,
    };
  }



  private listActiveAttentionRowsForProject(projectId: string): ProjectAttentionSummaryRow[] {
    return this.db.prepare(`
      SELECT
        id,
        project_id,
        sprint_id,
        sprint_run_id,
        attention_type,
        severity,
        owner_type,
        status,
        title,
        summary_markdown,
        payload_json,
        updated_at
      FROM project_attention_items
      WHERE project_id = ?
        AND status IN ('open', 'claimed')
      ORDER BY updated_at DESC, opened_at DESC, id DESC
    `).all(projectId) as unknown as ProjectAttentionSummaryRow[];
  }

  private compareExecutionTaskDispatchSummaryRows(
    left: ExecutionTaskDispatchSummaryRow,
    right: ExecutionTaskDispatchSummaryRow,
  ): number {
    const leftRecency = left.last_heartbeat_at || left.started_at || left.claimed_at || left.queued_at;
    const rightRecency = right.last_heartbeat_at || right.started_at || right.claimed_at || right.queued_at;

    return this.executionTaskDispatchStatusRank(left.status) - this.executionTaskDispatchStatusRank(right.status)
      || toNumber(right.priority) - toNumber(left.priority)
      || rightRecency.localeCompare(leftRecency)
      || right.id.localeCompare(left.id);
  }

  private executionTaskDispatchStatusRank(status: string): number {
    switch (status) {
      case "running":
        return 0;
      case "cancel_requested":
        return 1;
      case "claimed":
        return 2;
      case "queued":
        return 3;
      case "blocked":
        return 4;
      case "failed":
        return 5;
      case "completed":
        return 6;
      default:
        return 7;
    }
  }

  private compareExecutionRuntimeEventSummaryRows(
    left: ExecutionRuntimeEventSummaryRow,
    right: ExecutionRuntimeEventSummaryRow,
  ): number {
    return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
  }

  private notifyRealtime(projectId: string, includeOverview: boolean): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId || !this.realtimeNotifier) {
      return;
    }

    const existing = this.pendingRealtimeProjectRefreshes.get(normalizedProjectId);
    this.pendingRealtimeProjectRefreshes.set(normalizedProjectId, {
      includeOverview: Boolean(existing?.includeOverview) || includeOverview,
    });

    if (this.realtimeProjectRefreshTimer) {
      return;
    }

    this.realtimeProjectRefreshTimer = setTimeout(() => {
      this.realtimeProjectRefreshTimer = null;
      this.flushPendingRealtimeProjectRefreshes();
    }, 0);
  }

  private flushPendingRealtimeProjectRefreshes(): void {
    if (!this.realtimeNotifier || this.pendingRealtimeProjectRefreshes.size === 0) {
      this.pendingRealtimeProjectRefreshes.clear();
      return;
    }

    const pendingEntries = [...this.pendingRealtimeProjectRefreshes.entries()];
    this.pendingRealtimeProjectRefreshes.clear();

    for (const [projectId, options] of pendingEntries) {
      this.realtimeNotifier.scheduleProjectExecutionRefresh(projectId, {
        includeOverview: options.includeOverview,
      });
    }
  }

  private shouldPublishSprintRunUpdate(input: UpdateSprintRunInput): boolean {
    return input.status !== undefined
      || input.executorMode !== undefined
      || input.startedAt !== undefined
      || input.finishedAt !== undefined;
  }

  private shouldPublishTaskDispatchUpdate(input: UpdateTaskDispatchInput): boolean {
    return input.connectionId !== undefined
      || input.status !== undefined
      || input.claimedAt !== undefined
      || input.startedAt !== undefined
      || input.finishedAt !== undefined
      || input.errorMessage !== undefined;
  }

  private notifyRealtimeForLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): void {
    const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
    if (projectId) {
      this.notifyRealtime(projectId, false);
    }
  }

  public resolveLeaseProjectId(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): string | null {
    const cacheKey = `${scopeType}:${scopeId}`;
    const cached = this.leaseProjectCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let projectId: string | null = null;

    if (scopeType === "sprint") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM sprints
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      projectId = row?.project_id || null;
    } else if (scopeType === "task_dispatch") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM task_dispatches
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      projectId = row?.project_id || null;
    }

    if (projectId !== null) {
      if (this.leaseProjectCache.size >= 1000) {
        this.leaseProjectCache.delete(this.leaseProjectCache.keys().next().value!);
      }
      this.leaseProjectCache.set(cacheKey, projectId);
    }

    return projectId;
  }
}
