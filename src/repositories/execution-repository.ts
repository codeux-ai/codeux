import { randomUUID } from "crypto";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";

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
} from "../contracts/app-types.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import type { ProviderId } from "../contracts/app-types.js";

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

interface ProviderInvocationUsageRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  task_id: string | null;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  task_run_id: string | null;
  attention_item_id: string | null;
  session_id: string;
  provider: string;
  purpose: string;
  status: string;
  model: string | null;
  native_session_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | string | null;
  prompt_chars: number | string;
  transcript_chars: number | string;
  input_tokens: number | string;
  cached_input_tokens: number | string;
  output_tokens: number | string;
  reasoning_output_tokens: number | string;
  total_tokens: number | string;
  usage_source: string;
  raw_usage_json: string | null;
  created_at: string;
  updated_at: string;
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

interface ExecutionSprintRunSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  executor_mode: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

interface ExecutionTaskDispatchSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_run_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  task_id: string;
  task_key: string;
  task_title: string;
  status: string;
  executor_type: string;
  priority: number | string;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  task_run_id: string | null;
  task_run_state: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  queued_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

interface ExecutionRuntimeEventSummaryRow {
  id: string;
  scope_type: string;
  task_run_id: string | null;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  sprint_run_status: string | null;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  task_run_state: string | null;
  event_type: string;
  originator: string | null;
  source_event_key: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  created_at: string;
  payload_json: string | null;
}

interface OverviewTelemetryProjectSummaryRow {
  project_id: string;
  project_name: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  sprint_run_id: string;
  sprint_run_status: string;
  active_dispatch_count: number | string;
  running_dispatch_count: number | string;
  updated_at: string | null;
}

interface ProjectAttentionSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  sprint_run_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  title: string;
  summary_markdown: string;
  payload_json: string | null;
  updated_at: string;
}

interface NormalizedProjectStatsQuery {
  query: ProjectStatsQuery;
  range: ProjectExecutionStatsSnapshot["range"];
  bucketSizeMs: number;
}

interface StatsEntityMetadata {
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

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

function parsePayloadJson(value: string | null): Record<string, unknown> | null {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
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

function createEmptyUsageTotals(): ExecutionUsageTotals {
  return {
    invocationCount: 0,
    activeTimeMs: 0,
    wallTimeMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    reportedInvocationCount: 0,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
  };
}

function cloneUsageTotals(input?: ExecutionUsageTotals | null): ExecutionUsageTotals {
  return {
    ...createEmptyUsageTotals(),
    ...(input || {}),
  };
}

export class ExecutionRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    private readonly storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }


  createExecutionInvocation(input: CreateExecutionInvocationInput): ExecutionInvocationRecord {
    this.requireProject(input.projectId);
    if (input.sprintId) {
      this.requireSprint(input.sprintId, input.projectId);
    }
    if (input.taskId) {
      this.requireTask(input.taskId, input.projectId, input.sprintId || undefined);
    }
    if (input.sprintRunId) {
      this.requireSprintRun(input.sprintRunId);
    }
    if (input.dispatchId) {
      this.requireTaskDispatch(input.dispatchId);
    }
    if (input.taskRunId) {
      this.requireTaskRun(input.taskRunId);
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
      messageCount: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO execution_invocations (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, task_run_id, attention_item_id, provider_invocation_id,
        type, status, provider, model, system_prompt, started_at, finished_at, error_message, message_count, last_message_at,
        last_error_category, last_error_message, last_retry_after_iso,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        record.createdAt,
        record.updatedAt
    );

    this.realtimeNotifier?.scheduleProjectExecutionRefresh(record.projectId, { includeOverview: true });
    return record;
  }

  updateExecutionInvocation(id: string, input: UpdateExecutionInvocationInput): ExecutionInvocationRecord {
    const existing = this.getExecutionInvocation(id);
    if (!existing) {
      throw new Error(`Execution invocation not found: ${id}`);
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

      this.realtimeNotifier?.scheduleProjectExecutionRefresh(existing.projectId, { includeOverview: true });
    }

    return existing;
  }

  getExecutionInvocation(id: string): ExecutionInvocationRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM execution_invocations
      WHERE id = ?
    `).get(id) as any;

    if (!row) return null;
    return this.mapExecutionInvocationRow(row);
  }

  listExecutionInvocations(params: {
    projectId: string;
    sprintRunId?: string;
    taskRunId?: string;
    limit?: number;
    offset?: number;
  }): ExecutionInvocationRecord[] {
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

    const rows = this.db.prepare(sql).all(...values, limit, offset) as any[];
    return rows.map(this.mapExecutionInvocationRow);
  }

  listExecutionInvocationMessages(invocationId: string): ExecutionInvocationMessageRecord[] {
    const sql = `
      SELECT *
      FROM execution_invocation_messages
      WHERE invocation_id = ?
      ORDER BY created_at ASC
    `;
    const rows = this.db.prepare(sql).all(invocationId) as any[];
    return rows.map(this.mapExecutionInvocationMessageRow);
  }

  appendExecutionInvocationMessage(invocationId: string, input: AppendExecutionInvocationMessageInput): ExecutionInvocationMessageRecord {
    const invocation = this.getExecutionInvocation(invocationId);
    if (!invocation) {
      throw new Error(`Execution invocation not found: ${invocationId}`);
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

    this.realtimeNotifier?.scheduleProjectExecutionRefresh(invocation.projectId, { includeOverview: false });
    return record;
  }

  private mapExecutionInvocationRow(row: any): ExecutionInvocationRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      taskRunId: row.task_run_id,
      attentionItemId: row.attention_item_id,
      providerInvocationId: row.provider_invocation_id,
      type: row.type,
      status: row.status,
      provider: row.provider,
      model: row.model,
      systemPrompt: row.system_prompt,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
      lastErrorCategory: row.last_error_category,
      lastErrorMessage: row.last_error_message,
      lastRetryAfterIso: row.last_retry_after_iso,
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapExecutionInvocationMessageRow(row: any): ExecutionInvocationMessageRecord {
    return {
      id: row.id,
      invocationId: row.invocation_id,
      role: row.role,
      contentMarkdown: row.content_markdown,
      toolCallsJson: row.tool_calls_json ? JSON.parse(row.tool_calls_json) : null,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: row.created_at,
    };
  }

  createSprintRun(input: CreateSprintRunInput): SprintRunRecord {
    this.requireProject(input.projectId);
    this.requireSprint(input.sprintId, input.projectId);
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

    const created = this.requireSprintRun(id);
    this.notifyRealtime(created.projectId, true);
    return created;
  }

  listSprintRuns(projectId: string, sprintId?: string): SprintRunRecord[] {
    this.requireProject(projectId);
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
      this.requireProject(options.projectId);
      clauses.push("project_id = ?");
      values.push(options.projectId);
    }

    if (options?.sprintId) {
      if (options.projectId) {
        this.requireSprint(options.sprintId, options.projectId);
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
    this.requireProject(projectId);
    this.requireSprint(sprintId, projectId);
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
    const current = this.requireSprintRun(runId);
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
    const updated = this.requireSprintRun(runId);
    if (this.shouldPublishSprintRunUpdate(input)) {
      this.notifyRealtime(updated.projectId, true);
    }
    return updated;
  }

  createTaskDispatch(input: CreateTaskDispatchInput): TaskDispatchRecord {
    this.requireProject(input.projectId);
    this.requireSprint(input.sprintId, input.projectId);
    this.requireTask(input.taskId, input.projectId, input.sprintId);
    this.requireSprintRunScoped(input.sprintRunId, input.projectId, input.sprintId);
    if (input.connectionId) {
      this.requireConnection(input.connectionId);
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

    const created = this.requireTaskDispatch(id);
    this.notifyRealtime(created.projectId, true);
    return created;
  }

  listTaskDispatches(args: { projectId: string; sprintId?: string; sprintRunId?: string; taskId?: string }): TaskDispatchRecord[] {
    this.requireProject(args.projectId);
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
      this.requireProject(options.projectId);
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

  updateTaskDispatch(dispatchId: string, input: UpdateTaskDispatchInput): TaskDispatchRecord {
    const current = this.requireTaskDispatch(dispatchId);
    if (input.connectionId) {
      this.requireConnection(input.connectionId);
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
    const updated = this.requireTaskDispatch(dispatchId);
    if (this.shouldPublishTaskDispatchUpdate(input)) {
      this.notifyRealtime(updated.projectId, true);
    }
    return updated;
  }

  createTaskRun(input: CreateTaskRunInput): TaskRunRecord {
    this.requireProject(input.projectId);
    this.requireSprint(input.sprintId, input.projectId);
    this.requireTask(input.taskId, input.projectId, input.sprintId);
    if (input.sprintRunId) {
      this.requireSprintRunScoped(input.sprintRunId, input.projectId, input.sprintId);
    }
    if (input.dispatchId) {
      this.requireTaskDispatch(input.dispatchId);
    }
    if (input.connectionId) {
      this.requireConnection(input.connectionId);
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

    const created = this.requireTaskRun(id);
    this.notifyRealtime(created.projectId, false);
    return created;
  }

  createProviderInvocationUsage(input: CreateProviderInvocationUsageInput): ProviderInvocationUsageRecord {
    this.requireProject(input.projectId);
    if (input.sprintId) {
      this.requireSprint(input.sprintId, input.projectId);
    }
    if (input.taskId) {
      this.requireTask(input.taskId, input.projectId, input.sprintId || undefined);
    }
    if (input.sprintRunId) {
      this.requireSprintRun(input.sprintRunId);
    }
    if (input.dispatchId) {
      this.requireTaskDispatch(input.dispatchId);
    }
    if (input.taskRunId) {
      this.requireTaskRun(input.taskRunId);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO provider_invocations (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, task_run_id, attention_item_id,
        session_id, provider, purpose, status, model, native_session_id, started_at, finished_at, duration_ms,
        prompt_chars, transcript_chars, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
        total_tokens, usage_source, raw_usage_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      "unavailable",
      null,
      now,
      now,
    );

    const created = this.requireProviderInvocationUsage(id);
    this.notifyRealtime(created.projectId, false);
    return created;
  }

  updateProviderInvocationUsage(invocationId: string, input: UpdateProviderInvocationUsageInput): ProviderInvocationUsageRecord {
    const current = this.requireProviderInvocationUsage(invocationId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE provider_invocations
      SET status = ?, model = ?, native_session_id = ?, finished_at = ?, duration_ms = ?, transcript_chars = ?,
        input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?, total_tokens = ?,
        usage_source = ?, raw_usage_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status || current.status,
      input.model === undefined ? current.model : input.model,
      input.nativeSessionId === undefined ? current.nativeSessionId : input.nativeSessionId,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      input.durationMs === undefined ? current.durationMs : input.durationMs,
      input.transcriptChars === undefined ? current.transcriptChars : input.transcriptChars,
      input.inputTokens === undefined ? current.inputTokens : input.inputTokens,
      input.cachedInputTokens === undefined ? current.cachedInputTokens : input.cachedInputTokens,
      input.outputTokens === undefined ? current.outputTokens : input.outputTokens,
      input.reasoningOutputTokens === undefined ? current.reasoningOutputTokens : input.reasoningOutputTokens,
      input.totalTokens === undefined ? current.totalTokens : input.totalTokens,
      input.usageSource === undefined ? current.usageSource : input.usageSource,
      input.rawUsageJson === undefined
        ? JSON.stringify(current.rawUsageJson)
        : (input.rawUsageJson === null ? null : JSON.stringify(input.rawUsageJson)),
      now,
      invocationId,
    );

    const updated = this.requireProviderInvocationUsage(invocationId);
    this.notifyRealtime(updated.projectId, false);
    return updated;
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
    const row = this.db.prepare(`
      SELECT *
      FROM provider_invocations
      WHERE id = ?
    `).get(invocationId) as ProviderInvocationUsageRow | undefined;
    return row ? this.mapProviderInvocationUsageRow(row) : null;
  }

  getLatestProviderInvocationUsageBySession(
    sessionId: string,
    purpose?: ProviderInvocationUsageRecord["purpose"],
  ): ProviderInvocationUsageRecord | null {
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return null;
    }

    const row = purpose
      ? this.db.prepare(`
        SELECT *
        FROM provider_invocations
        WHERE session_id = ?
          AND purpose = ?
        ORDER BY started_at DESC, rowid DESC
        LIMIT 1
      `).get(trimmedSessionId, purpose) as ProviderInvocationUsageRow | undefined
      : this.db.prepare(`
        SELECT *
        FROM provider_invocations
        WHERE session_id = ?
        ORDER BY started_at DESC, rowid DESC
        LIMIT 1
      `).get(trimmedSessionId) as ProviderInvocationUsageRow | undefined;

    return row ? this.mapProviderInvocationUsageRow(row) : null;
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
    this.requireTask(taskId);
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
    this.requireProject(projectId);
    const projectRow = this.db.prepare(`
      SELECT id, name
      FROM projects
      WHERE id = ?
    `).get(projectId) as { id: string; name: string } | undefined;

    const sprintRuns = this.db.prepare(`
      SELECT
        sr.id,
        sr.project_id,
        sr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.status,
        sr.trigger_type,
        sr.triggered_by,
        sr.executor_mode,
        sr.started_at,
        sr.finished_at,
        sr.last_heartbeat_at,
        sr.created_at,
        el.owner_key AS active_lease_owner_key,
        el.expires_at AS active_lease_expires_at
      FROM sprint_runs sr
      INNER JOIN sprints s ON s.id = sr.sprint_id
      LEFT JOIN execution_leases el
        ON el.scope_type = 'sprint'
       AND el.scope_id = sr.sprint_id
      WHERE sr.project_id = ?
      ORDER BY
        CASE sr.status WHEN 'running' THEN 0 WHEN 'cancel_requested' THEN 1 WHEN 'queued' THEN 2 WHEN 'paused' THEN 3 WHEN 'failed' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
        COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC
      LIMIT 12
    `).all(projectId) as unknown as ExecutionSprintRunSummaryRow[];
    const expandedSprintRunIds = sprintRuns
      .filter((row) => ["running", "queued", "paused", "cancel_requested"].includes(row.status))
      .map((row) => row.id);
    if (expandedSprintRunIds.length === 0 && sprintRuns[0]?.id) {
      expandedSprintRunIds.push(sprintRuns[0].id);
    }

    const recentTaskDispatches = this.db.prepare(`
      SELECT
        td.id,
        td.project_id,
        td.sprint_id,
        td.sprint_run_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        td.task_id,
        t.task_key,
        t.title AS task_title,
        td.status,
        td.executor_type,
        td.priority,
        td.connection_id,
        c.display_name AS connection_display_name,
        c.role AS connection_role,
        td.queued_at,
        td.claimed_at,
        td.started_at,
        td.finished_at,
        td.last_heartbeat_at,
        td.error_message,
        el.owner_key AS active_lease_owner_key,
        el.expires_at AS active_lease_expires_at
      FROM task_dispatches td
      INNER JOIN sprints s ON s.id = td.sprint_id
      INNER JOIN tasks t ON t.id = td.task_id
      LEFT JOIN mcp_connections c ON c.id = td.connection_id
      LEFT JOIN execution_leases el
        ON el.scope_type = 'task_dispatch'
       AND el.scope_id = td.id
      WHERE td.project_id = ?
      ORDER BY
        CASE td.status WHEN 'running' THEN 0 WHEN 'cancel_requested' THEN 1 WHEN 'claimed' THEN 2 WHEN 'queued' THEN 3 WHEN 'blocked' THEN 4 WHEN 'failed' THEN 5 WHEN 'completed' THEN 6 ELSE 7 END,
        td.priority DESC,
        COALESCE(td.last_heartbeat_at, td.started_at, td.claimed_at, td.queued_at) DESC
      LIMIT 24
    `).all(projectId) as unknown as ExecutionTaskDispatchSummaryRow[];

    const expandedSprintTaskDispatches = expandedSprintRunIds.length > 0
      ? this.storage.executeChunkedInQuery<ExecutionTaskDispatchSummaryRow>({
        sqlPrefix: `
        SELECT
          td.id,
          td.project_id,
          td.sprint_id,
          td.sprint_run_id,
          s.name AS sprint_name,
          s.number AS sprint_number,
          td.task_id,
          t.task_key,
          t.title AS task_title,
          td.status,
          td.executor_type,
          td.priority,
          td.connection_id,
          c.display_name AS connection_display_name,
          c.role AS connection_role,
          td.queued_at,
          td.claimed_at,
          td.started_at,
          td.finished_at,
          td.last_heartbeat_at,
          td.error_message,
          el.owner_key AS active_lease_owner_key,
          el.expires_at AS active_lease_expires_at
        FROM task_dispatches td
        INNER JOIN sprints s ON s.id = td.sprint_id
        INNER JOIN tasks t ON t.id = td.task_id
        LEFT JOIN mcp_connections c ON c.id = td.connection_id
        LEFT JOIN execution_leases el
          ON el.scope_type = 'task_dispatch'
         AND el.scope_id = td.id
        WHERE td.project_id = ?
          AND td.sprint_run_id`,
        sqlSuffix: "",
        items: expandedSprintRunIds,
        bindParamsBefore: [projectId],
      })
      : [];

    const taskDispatchById = new Map<string, ExecutionTaskDispatchSummaryRow>();
    for (const row of [...expandedSprintTaskDispatches, ...recentTaskDispatches]) {
      taskDispatchById.set(row.id, row);
    }
    const taskDispatches = [...taskDispatchById.values()].sort((left, right) => this.compareExecutionTaskDispatchSummaryRows(left, right));

    const dispatchIds = taskDispatches.map((row) => row.id);
    const taskRunByDispatchId = new Map<string, { id: string; state: string; provider: string | null; session_id: string | null; session_name: string | null; worker_branch: string | null; pr_url: string | null; }>();

    if (dispatchIds.length > 0) {
      const taskRunRows = this.storage.executeChunkedInQuery<{ dispatch_id: string; id: string; state: string; provider: string | null; session_id: string | null; session_name: string | null; worker_branch: string | null; pr_url: string | null; }>({
        sqlPrefix: `SELECT tr.dispatch_id, tr.id, tr.state, tr.provider, tr.session_id, tr.session_name, tr.worker_branch, tr.pr_url
        FROM task_runs tr
        INNER JOIN (
          SELECT dispatch_id, MAX(rowid) AS latest_rowid
          FROM task_runs
          WHERE dispatch_id`,
        sqlSuffix: `GROUP BY dispatch_id
        ) latest ON latest.latest_rowid = tr.rowid`,
        items: dispatchIds,
      });

      for (const run of taskRunRows) {
        taskRunByDispatchId.set(run.dispatch_id, run);
      }
    }

    for (const td of taskDispatches) {
      const taskRun = taskRunByDispatchId.get(td.id);
      td.task_run_id = taskRun?.id || null;
      td.task_run_state = taskRun?.state || null;
      td.provider = taskRun?.provider || null;
      td.session_id = taskRun?.session_id || null;
      td.session_name = taskRun?.session_name || null;
      td.worker_branch = taskRun?.worker_branch || null;
      td.pr_url = taskRun?.pr_url || null;
    }

    const recentEvents = this.db.prepare(`
      SELECT *
      FROM (
        SELECT
          tre.id,
          'task_run' AS scope_type,
          tre.task_run_id,
          tr.sprint_run_id,
          tr.dispatch_id,
          tr.project_id,
          tr.sprint_id,
          s.name AS sprint_name,
          s.number AS sprint_number,
          sr.status AS sprint_run_status,
          tr.task_id,
          t.task_key,
          t.title AS task_title,
          tr.state AS task_run_state,
          tre.event_type,
          tre.originator,
          tre.source_event_key,
          tr.provider,
          tr.session_id,
          tr.session_name,
          tr.worker_branch,
          tr.pr_url,
          tr.connection_id,
          c.display_name AS connection_display_name,
          c.role AS connection_role,
          tre.created_at,
          tre.payload_json
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        INNER JOIN sprints s ON s.id = tr.sprint_id
        INNER JOIN tasks t ON t.id = tr.task_id
        LEFT JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
        LEFT JOIN mcp_connections c ON c.id = tr.connection_id
        WHERE tr.project_id = ?

        UNION ALL

        SELECT
          sre.id,
          'sprint_run' AS scope_type,
          NULL AS task_run_id,
          sre.sprint_run_id,
          NULL AS dispatch_id,
          sr.project_id,
          sr.sprint_id,
          s.name AS sprint_name,
          s.number AS sprint_number,
          sr.status AS sprint_run_status,
          NULL AS task_id,
          NULL AS task_key,
          NULL AS task_title,
          NULL AS task_run_state,
          sre.event_type,
          sre.originator,
          sre.source_event_key,
          NULL AS provider,
          NULL AS session_id,
          NULL AS session_name,
          NULL AS worker_branch,
          NULL AS pr_url,
          NULL AS connection_id,
          NULL AS connection_display_name,
          NULL AS connection_role,
          sre.created_at,
          sre.payload_json
        FROM sprint_run_events sre
        INNER JOIN sprint_runs sr ON sr.id = sre.sprint_run_id
        INNER JOIN sprints s ON s.id = sr.sprint_id
        WHERE sr.project_id = ?
      )
      ORDER BY created_at DESC, id DESC
      LIMIT 240
    `).all(projectId, projectId) as unknown as ExecutionRuntimeEventSummaryRow[];

    const expandedSprintTaskEvents = expandedSprintRunIds.length > 0
      ? this.storage.executeChunkedInQuery<ExecutionRuntimeEventSummaryRow>({
        sqlPrefix: `
        SELECT
          tre.id,
          'task_run' AS scope_type,
          tre.task_run_id,
          tr.sprint_run_id,
          tr.dispatch_id,
          tr.project_id,
          tr.sprint_id,
          s.name AS sprint_name,
          s.number AS sprint_number,
          sr.status AS sprint_run_status,
          tr.task_id,
          t.task_key,
          t.title AS task_title,
          tr.state AS task_run_state,
          tre.event_type,
          tre.originator,
          tre.source_event_key,
          tr.provider,
          tr.session_id,
          tr.session_name,
          tr.worker_branch,
          tr.pr_url,
          tr.connection_id,
          c.display_name AS connection_display_name,
          c.role AS connection_role,
          tre.created_at,
          tre.payload_json
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        INNER JOIN sprints s ON s.id = tr.sprint_id
        INNER JOIN tasks t ON t.id = tr.task_id
        LEFT JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
        LEFT JOIN mcp_connections c ON c.id = tr.connection_id
        WHERE tr.project_id = ?
          AND tr.sprint_run_id`,
        sqlSuffix: `
        ORDER BY tre.created_at DESC, tre.id DESC`,
        items: expandedSprintRunIds,
        bindParamsBefore: [projectId],
      })
      : [];

    const recentEventById = new Map<string, ExecutionRuntimeEventSummaryRow>();
    for (const row of [...expandedSprintTaskEvents, ...recentEvents]) {
      recentEventById.set(row.id, row);
    }
    const runtimeEvents = [...recentEventById.values()].sort((left, right) => this.compareExecutionRuntimeEventSummaryRows(left, right));

    const activeAttentionItems = this.listActiveAttentionRowsForProject(projectId);
    const humanInterventionBySprintRunId = this.buildHumanInterventionSummaryBySprintRun(
      sprintRuns,
      activeAttentionItems,
      runtimeEvents,
    );
    const usageBySprintRunId = this.getUsageTotalsBySprintRunIds(projectId, sprintRuns.map((row) => row.id));
    const nowIso = new Date().toISOString();
    const usageByTaskId = this.getUsageTotalsByTaskIds(projectId, taskDispatches.map((row) => row.task_id));
    const wallTimeBySprintRunId = this.getWallTimeTotalsBySprintRunIds(sprintRuns.map((row) => row.id), nowIso);
    const wallTimeByTaskId = this.getWallTimeTotalsByTaskIds(taskDispatches.map((row) => row.task_id), nowIso);

    return {
      projectId: projectRow?.id || null,
      projectName: projectRow?.name || null,
      sprintRuns: sprintRuns.map((row) => this.mapExecutionSprintRunSummaryRow(
        row,
        humanInterventionBySprintRunId.get(row.id) || null,
        this.withWallTime(usageBySprintRunId.get(row.id), wallTimeBySprintRunId.get(row.id) || 0),
      )),
      taskDispatches: taskDispatches.map((row) => this.mapExecutionTaskDispatchSummaryRow(
        row,
        this.withWallTime(usageByTaskId.get(row.task_id), wallTimeByTaskId.get(row.task_id) || 0),
      )),
      connections: [],
      primaryAssignedWorker: null,
      overflowAssignedWorkers: [],
      attentionItems: [],
      recentEvents: runtimeEvents.map((row) => this.mapExecutionRuntimeEventSummaryRow(row)),
      updatedAt: new Date().toISOString(),
    };
  }

  getProjectStatsSnapshot(
    projectId: string,
    input: ProjectStatsQuery | ProjectStatsWindow = "7d",
  ): ProjectExecutionStatsSnapshot {
    this.requireProject(projectId);
    const projectRow = this.db.prepare(`
      SELECT id, name
      FROM projects
      WHERE id = ?
    `).get(projectId) as { id: string; name: string } | undefined;
    const now = new Date();
    const normalized = this.normalizeProjectStatsQuery(projectId, input, now);
    const rangeStartIso = normalized.range.from;
    const rangeEndIso = normalized.range.to;
    const invocations = this.db.prepare(`
      SELECT *
      FROM provider_invocations
      WHERE project_id = ?
        AND started_at >= ?
        AND started_at < ?
      ORDER BY started_at ASC, id ASC
    `).all(projectId, rangeStartIso, rangeEndIso) as unknown as ProviderInvocationUsageRow[];
    const mappedInvocations = invocations.map((row) => this.mapProviderInvocationUsageRow(row));
    const nowIso = now.toISOString();
    const wallTimeByTaskId = this.getWallTimeTotalsByTaskIdsForRange(projectId, rangeStartIso, rangeEndIso, nowIso);
    const wallTimeBySprintRunId = this.getWallTimeTotalsBySprintRunIdsForRange(projectId, rangeStartIso, rangeEndIso, nowIso);
    const buckets = this.createUsageBuckets(normalized.range, normalized.bucketSizeMs);
    const taskMeta = this.getTaskMetadata(projectId);
    const sprintMeta = this.getSprintMetadata(projectId);
    const usage = createEmptyUsageTotals();
    const taskUsage = new Map<string, ExecutionUsageTotals>();
    const sprintUsage = new Map<string, ExecutionUsageTotals>();
    const providerUsage = new Map<string, ExecutionUsageTotals>();
    const purposeUsage = new Map<string, ExecutionUsageTotals>();
    const tokenSourceCounts = new Map<string, number>();
    const taskLastActivity = new Map<string, string>();
    const sprintLastActivity = new Map<string, string>();
    const providerLastActivity = new Map<string, string>();
    const purposeLastActivity = new Map<string, string>();

    for (const invocation of mappedInvocations) {
      this.mergeUsageTotals(usage, invocation);
      this.mergeUsageMap(taskUsage, invocation.taskId, invocation);
      this.mergeUsageMap(sprintUsage, invocation.sprintRunId || invocation.sprintId, invocation);
      this.mergeUsageMap(providerUsage, invocation.provider, invocation);
      this.mergeUsageMap(purposeUsage, invocation.purpose, invocation);
      const activityAt = invocation.finishedAt || invocation.startedAt;
      this.updateLastActivity(taskLastActivity, invocation.taskId, activityAt);
      this.updateLastActivity(sprintLastActivity, invocation.sprintRunId || invocation.sprintId, activityAt);
      this.updateLastActivity(providerLastActivity, invocation.provider, activityAt);
      this.updateLastActivity(purposeLastActivity, invocation.purpose, activityAt);
      tokenSourceCounts.set(invocation.usageSource, (tokenSourceCounts.get(invocation.usageSource) || 0) + 1);
      const bucketIndex = Math.floor((new Date(invocation.startedAt).getTime() - buckets[0].bucketStartMs) / normalized.bucketSizeMs);
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
        this.mergeUsageTotals(buckets[bucketIndex]!.usage, invocation);
      }
    }

    for (const [taskId, wallTime] of wallTimeByTaskId) {
      const total = taskUsage.get(taskId) || createEmptyUsageTotals();
      total.wallTimeMs = wallTime;
      taskUsage.set(taskId, total);
    }
    for (const [sprintKey, wallTime] of wallTimeBySprintRunId) {
      const total = sprintUsage.get(sprintKey) || createEmptyUsageTotals();
      total.wallTimeMs = wallTime;
      sprintUsage.set(sprintKey, total);
    }
    usage.wallTimeMs = Array.from(wallTimeByTaskId.values()).reduce((sum, value) => sum + value, 0);

    const activeSprintRow = this.db.prepare(`
      SELECT sr.sprint_id, s.name AS sprint_name, s.number AS sprint_number
      FROM sprint_runs sr
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.project_id = ?
        AND sr.status IN ('queued', 'running', 'paused', 'cancel_requested')
      ORDER BY COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC
      LIMIT 1
    `).get(projectId) as { sprint_id: string; sprint_name: string; sprint_number: number | string | null } | undefined;

    const chartSeries: ProjectExecutionStatsChartSeries[] = [
      { id: "core_total_tokens", label: "Total Tokens", grouping: "totals", defaultEnabled: true, data: buckets.map((b) => b.usage.totalTokens) },
      { id: "core_active_time", label: "Active Time (ms)", grouping: "totals", defaultEnabled: false, data: buckets.map((b) => b.usage.activeTimeMs) },
      { id: "core_invocations", label: "Invocations", grouping: "totals", defaultEnabled: false, data: buckets.map((b) => b.usage.invocationCount) },
      { id: "core_input_tokens", label: "Input Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.inputTokens) },
      { id: "core_cached_tokens", label: "Cached Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.cachedInputTokens) },
      { id: "core_output_tokens", label: "Output Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.outputTokens) },
      { id: "core_reasoning_tokens", label: "Reasoning Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.reasoningOutputTokens) },
      { id: "reliability_reported", label: "Reported Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.reportedInvocationCount) },
      { id: "reliability_estimated", label: "Estimated Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.estimatedInvocationCount) },
      { id: "reliability_unsupported", label: "Unsupported Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.unsupportedInvocationCount) },
      { id: "reliability_unavailable", label: "Unavailable Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.unavailableInvocationCount) },
      ...Array.from(providerUsage.keys()).map((providerId) => ({
        id: `provider_${providerId}`, label: `${providerId} Tokens`, grouping: "providers", defaultEnabled: false, data: buckets.map(() => 0)
      })),
      ...Array.from(purposeUsage.keys()).map((purposeId) => ({
        id: `purpose_time_${purposeId}`, label: `${purposeId.replace(/_/g, " ")} Time`, grouping: "purposes_time", defaultEnabled: false, data: buckets.map(() => 0)
      })),
      ...Array.from(purposeUsage.keys()).map((purposeId) => ({
        id: `purpose_invocations_${purposeId}`, label: `${purposeId.replace(/_/g, " ")} Invocations`, grouping: "purposes_invocations", defaultEnabled: false, data: buckets.map(() => 0)
      }))
    ];

    const firstBucketStartMs = buckets.length > 0 ? new Date(buckets[0].bucketStart).getTime() : 0;
    if (buckets.length > 0) {
      const chartSeriesMap = new Map<string, ProjectExecutionStatsChartSeries>(
        chartSeries.map(s => [s.id, s])
      );
      for (const invocation of mappedInvocations) {
        const bucketIndex = Math.floor((new Date(invocation.startedAt).getTime() - firstBucketStartMs) / normalized.bucketSizeMs);
        if (bucketIndex >= 0 && bucketIndex < buckets.length) {
            const providerSeries = chartSeriesMap.get(`provider_${invocation.provider}`);
            if (providerSeries) providerSeries.data[bucketIndex] += invocation.totalTokens;

            const purposeTimeSeries = chartSeriesMap.get(`purpose_time_${invocation.purpose}`);
            if (purposeTimeSeries) purposeTimeSeries.data[bucketIndex] += invocation.durationMs || 0;

            const purposeInvocationsSeries = chartSeriesMap.get(`purpose_invocations_${invocation.purpose}`);
            if (purposeInvocationsSeries) purposeInvocationsSeries.data[bucketIndex] += 1;
        }
      }
    }

    return {
      projectId,
      projectName: projectRow?.name || "Unknown Project",
      window: normalized.query.window,
      query: normalized.query,
      range: normalized.range,
      generatedAt: new Date().toISOString(),
      usage,
      activeSprint: activeSprintRow ? {
        sprintId: activeSprintRow.sprint_id,
        sprintName: activeSprintRow.sprint_name,
        sprintNumber: activeSprintRow.sprint_number === null ? null : toNumber(activeSprintRow.sprint_number),
      } : null,
      buckets: buckets.map((bucket) => ({
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        label: bucket.label,
        usage: bucket.usage,
      })),
      sprints: this.toStatsEntitySummaries({
        entries: sprintUsage,
        metadata: this.withLastActivityMetadata(sprintMeta, sprintLastActivity),
        kind: "sprint",
      }),
      tasks: this.toStatsEntitySummaries({
        entries: taskUsage,
        metadata: this.withLastActivityMetadata(taskMeta, taskLastActivity),
        kind: "task",
      }),
      providers: this.toStatsEntitySummaries({
        entries: providerUsage,
        metadata: this.withLastActivityMetadata(new Map<string, StatsEntityMetadata>(), providerLastActivity),
        kind: "provider",
      }),
      purposes: this.toStatsEntitySummaries({
        entries: purposeUsage,
        metadata: this.withLastActivityMetadata(new Map<string, StatsEntityMetadata>(), purposeLastActivity),
        kind: "purpose",
      }),
      tokenSources: Array.from(tokenSourceCounts.entries())
        .map(([source, count]) => ({ source: source as ProjectExecutionStatsSnapshot["tokenSources"][number]["source"], count }))
        .sort((left, right) => right.count - left.count),
      chartSeries,
    };
  }

  getOverviewTelemetrySnapshot(): OverviewTelemetrySnapshot {
    const activeProjects = this.db.prepare(`
      SELECT
        sr.project_id,
        p.name AS project_name,
        sr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.id AS sprint_run_id,
        sr.status AS sprint_run_status,
        0 AS active_dispatch_count,
        0 AS running_dispatch_count,
        COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.started_at, sr.created_at) AS updated_at
      FROM sprint_runs sr
      INNER JOIN projects p ON p.id = sr.project_id
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.status IN ('running', 'queued')
      ORDER BY updated_at DESC, p.name ASC, s.name ASC
      LIMIT 24
    `).all() as unknown as OverviewTelemetryProjectSummaryRow[];

    const pausedProjects = this.db.prepare(`
      SELECT
        sr.project_id,
        p.name AS project_name,
        sr.sprint_id,
        s.name AS sprint_name,
        s.number AS sprint_number,
        sr.id AS sprint_run_id,
        sr.status AS sprint_run_status,
        0 AS active_dispatch_count,
        0 AS running_dispatch_count,
        COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.started_at, sr.created_at) AS updated_at
      FROM sprint_runs sr
      INNER JOIN projects p ON p.id = sr.project_id
      INNER JOIN sprints s ON s.id = sr.sprint_id
      WHERE sr.status = 'paused'
      ORDER BY updated_at DESC, p.name ASC, s.name ASC
      LIMIT 24
    `).all() as unknown as OverviewTelemetryProjectSummaryRow[];

    const telemetrySprintRunIds = Array.from(new Set([
      ...activeProjects.map((row) => row.sprint_run_id),
      ...pausedProjects.map((row) => row.sprint_run_id),
    ]));

    if (telemetrySprintRunIds.length > 0) {
      const counts = this.storage.executeChunkedInQuery<{ sprint_run_id: string; active_count: number | string; running_count: number | string; }>({
        sqlPrefix: `SELECT sprint_run_id,
          SUM(CASE WHEN status IN ('queued', 'claimed', 'running', 'cancel_requested', 'blocked') THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status IN ('claimed', 'running') THEN 1 ELSE 0 END) AS running_count
        FROM task_dispatches
        WHERE sprint_run_id`,
        sqlSuffix: `GROUP BY sprint_run_id`,
        items: telemetrySprintRunIds,
      });
      const countsBySprintRunId = new Map<string, { active: number; running: number }>();
      for (const row of counts) {
        countsBySprintRunId.set(row.sprint_run_id, {
          active: toNumber(row.active_count),
          running: toNumber(row.running_count),
        });
      }
      for (const row of activeProjects) {
        const counts = countsBySprintRunId.get(row.sprint_run_id);
        row.active_dispatch_count = counts?.active || 0;
        row.running_dispatch_count = counts?.running || 0;
      }
      for (const row of pausedProjects) {
        const counts = countsBySprintRunId.get(row.sprint_run_id);
        row.active_dispatch_count = counts?.active || 0;
        row.running_dispatch_count = counts?.running || 0;
      }
    }
    const activeAttentionItems = this.listActiveAttentionRowsForSprintRuns(telemetrySprintRunIds);

    const placeholders = Array(telemetrySprintRunIds.length).fill("?").join(", ");
    const recentEvents = telemetrySprintRunIds.length === 0
      ? []
      : this.db.prepare(`
        SELECT *
        FROM (
          SELECT
            tre.id,
            'task_run' AS scope_type,
            tre.task_run_id,
            tr.sprint_run_id,
            tr.dispatch_id,
            tr.project_id,
            tr.sprint_id,
            s.name AS sprint_name,
            s.number AS sprint_number,
            sr.status AS sprint_run_status,
            tr.task_id,
            t.task_key,
            t.title AS task_title,
            tr.state AS task_run_state,
            tre.event_type,
            tre.originator,
            tre.source_event_key,
            tr.provider,
            tr.session_id,
            tr.session_name,
            tr.worker_branch,
            tr.pr_url,
            tr.connection_id,
            c.display_name AS connection_display_name,
            c.role AS connection_role,
            tre.created_at,
            tre.payload_json
          FROM task_run_events tre
          INNER JOIN task_runs tr ON tr.id = tre.task_run_id
          INNER JOIN sprint_runs sr ON sr.id = tr.sprint_run_id
          INNER JOIN sprints s ON s.id = tr.sprint_id
          INNER JOIN tasks t ON t.id = tr.task_id
          LEFT JOIN mcp_connections c ON c.id = tr.connection_id
          WHERE tr.sprint_run_id IN (${placeholders})

          UNION ALL

          SELECT
            sre.id,
            'sprint_run' AS scope_type,
            NULL AS task_run_id,
            sre.sprint_run_id,
            NULL AS dispatch_id,
            sr.project_id,
            sr.sprint_id,
            s.name AS sprint_name,
            s.number AS sprint_number,
            sr.status AS sprint_run_status,
            NULL AS task_id,
            NULL AS task_key,
            NULL AS task_title,
            NULL AS task_run_state,
            sre.event_type,
            sre.originator,
            sre.source_event_key,
            NULL AS provider,
            NULL AS session_id,
            NULL AS session_name,
            NULL AS worker_branch,
            NULL AS pr_url,
            NULL AS connection_id,
            NULL AS connection_display_name,
            NULL AS connection_role,
            sre.created_at,
            sre.payload_json
          FROM sprint_run_events sre
          INNER JOIN sprint_runs sr ON sr.id = sre.sprint_run_id
          INNER JOIN sprints s ON s.id = sr.sprint_id
          WHERE sre.sprint_run_id IN (${placeholders})
        )
        ORDER BY created_at DESC, id DESC
        LIMIT 80
      `).all(...telemetrySprintRunIds, ...telemetrySprintRunIds) as unknown as ExecutionRuntimeEventSummaryRow[];

    const eventAwareHumanInterventionBySprintRunId = this.buildHumanInterventionSummaryBySprintRun(
      [...activeProjects, ...pausedProjects].map((row) => ({
        id: row.sprint_run_id,
        sprint_id: row.sprint_id,
        status: row.sprint_run_status,
      })),
      activeAttentionItems,
      recentEvents,
    );

    return {
      activeProjects: activeProjects.map((row) => this.mapOverviewTelemetryProjectSummaryRow(
        row,
        eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
      )),
      attentionProjects: pausedProjects
        .filter((row) => Boolean(eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id)))
        .map((row) => this.mapOverviewTelemetryProjectSummaryRow(
          row,
          eventAwareHumanInterventionBySprintRunId.get(row.sprint_run_id) || null,
        )),
      recentEvents: recentEvents.map((row) => this.mapExecutionRuntimeEventSummaryRow(row)),
      updatedAt: new Date().toISOString(),
    };
  }

  countRunningTasksPerProvider(projectId: string): Map<ProviderId, number> {
    this.requireProject(projectId);
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

  updateTaskRun(taskRunId: string, input: UpdateTaskRunInput): TaskRunRecord {
    const current = this.requireTaskRun(taskRunId);
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
    const updated = this.requireTaskRun(taskRunId);
    this.notifyRealtime(updated.projectId, false);
    return updated;
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
    const taskRun = this.requireTaskRun(taskRunId);
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
    const sprintRun = this.requireSprintRun(sprintRunId);
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
    this.requireTaskRun(taskRunId);
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
    this.requireSprintRun(sprintRunId);
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
    const queue = this.listTaskDispatches({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId,
    }).filter((dispatch) => dispatch.executorType === args.executorType && dispatch.status === "queued");

    const next = queue[0];
    if (!next) {
      return null;
    }

    const now = new Date().toISOString();
    return this.updateTaskDispatch(next.id, {
      connectionId: args.connectionId ?? null,
      status: "claimed",
      claimedAt: now,
      lastHeartbeatAt: now,
    });
  }

  listWorkerProjectAffinity(connectionId: string): string[] {
    const rows = this.db.prepare(`
      SELECT
        project_id,
        SUM(CASE WHEN status IN ('claimed', 'running', 'cancel_requested') THEN 1 ELSE 0 END) AS active_count,
        MAX(COALESCE(last_heartbeat_at, started_at, claimed_at, queued_at, created_at)) AS last_seen_at
      FROM task_dispatches
      WHERE connection_id = ?
        AND executor_type = 'mcp_worker'
      GROUP BY project_id
      ORDER BY active_count DESC, last_seen_at DESC, project_id ASC
    `).all(connectionId) as unknown as WorkerProjectAffinityRow[];

    return rows
      .map((row) => String(row.project_id || "").trim())
      .filter(Boolean);
  }

  acquireLease(input: AcquireExecutionLeaseInput): ExecutionLeaseRecord {
    const existing = this.getLease(input.scopeType, input.scopeId);
    const now = new Date().toISOString();

    if (existing && existing.expiresAt > now && existing.leaseToken !== input.leaseToken) {
      throw new Error(`Lease already held for ${input.scopeType}:${input.scopeId}`);
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
      const updated = this.requireLease(input.scopeType, input.scopeId);
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
    const created = this.requireLease(input.scopeType, input.scopeId);
    this.notifyRealtimeForLease(input.scopeType, input.scopeId);
    return created;
  }

  renewLease(input: RenewExecutionLeaseInput): ExecutionLeaseRecord {
    const current = this.requireLease(input.scopeType, input.scopeId);
    if (current.leaseToken !== input.leaseToken) {
      throw new Error(`Lease token mismatch for ${input.scopeType}:${input.scopeId}`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE execution_leases
      SET expires_at = ?, last_heartbeat_at = ?
      WHERE scope_type = ? AND scope_id = ? AND lease_token = ?
    `).run(input.expiresAt, now, input.scopeType, input.scopeId, input.leaseToken);
    return this.requireLease(input.scopeType, input.scopeId);
  }

  releaseLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string, leaseToken?: string): void {
    const projectId = this.resolveLeaseProjectId(scopeType, scopeId);
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
  }

  releaseStaleSprintLease(projectId: string, sprintId: string): boolean {
    this.requireProject(projectId);
    this.requireSprint(sprintId, projectId);

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
  }

  getLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM execution_leases
      WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId) as ExecutionLeaseRow | undefined;
    return row ? this.mapExecutionLeaseRow(row) : null;
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

  private requireSprintRun(runId: string): SprintRunRecord {
    const run = this.getSprintRun(runId);
    if (!run) {
      throw new Error(`Sprint run not found: ${runId}`);
    }
    return run;
  }

  private withWallTime(usage: ExecutionUsageTotals | undefined, wallTimeMs: number): ExecutionUsageTotals {
    const next = cloneUsageTotals(usage);
    next.wallTimeMs = wallTimeMs;
    return next;
  }

  private mergeUsageMap(
    map: Map<string, ExecutionUsageTotals>,
    key: string | null | undefined,
    invocation: ProviderInvocationUsageRecord,
  ): void {
    if (!key) {
      return;
    }
    const existing = map.get(key) || createEmptyUsageTotals();
    this.mergeUsageTotals(existing, invocation);
    map.set(key, existing);
  }

  private mergeUsageTotals(target: ExecutionUsageTotals, invocation: ProviderInvocationUsageRecord): void {
    target.invocationCount += 1;
    target.activeTimeMs += invocation.durationMs || 0;
    target.inputTokens += invocation.inputTokens;
    target.cachedInputTokens += invocation.cachedInputTokens;
    target.outputTokens += invocation.outputTokens;
    target.reasoningOutputTokens += invocation.reasoningOutputTokens;
    target.totalTokens += invocation.totalTokens;
    switch (invocation.usageSource) {
      case "reported":
        target.reportedInvocationCount += 1;
        break;
      case "estimated":
        target.estimatedInvocationCount += 1;
        break;
      case "unsupported":
        target.unsupportedInvocationCount += 1;
        break;
      default:
        target.unavailableInvocationCount += 1;
        break;
    }
  }

  private getUsageTotalsByTaskIds(projectId: string, taskIds: string[]): Map<string, ExecutionUsageTotals> {
    if (taskIds.length === 0) {
      return new Map();
    }
    const rows = this.storage.executeChunkedInQuery<ProviderInvocationUsageRow>({
      sqlPrefix: "SELECT * FROM provider_invocations WHERE project_id = ? AND task_id",
      items: taskIds,
      bindParamsBefore: [projectId],
    });
    return this.groupUsageBy(rows.map((row) => this.mapProviderInvocationUsageRow(row)), (row) => row.taskId);
  }

  private getUsageTotalsBySprintRunIds(projectId: string, sprintRunIds: string[]): Map<string, ExecutionUsageTotals> {
    if (sprintRunIds.length === 0) {
      return new Map();
    }
    const rows = this.storage.executeChunkedInQuery<ProviderInvocationUsageRow>({
      sqlPrefix: "SELECT * FROM provider_invocations WHERE project_id = ? AND sprint_run_id",
      items: sprintRunIds,
      bindParamsBefore: [projectId],
    });
    return this.groupUsageBy(rows.map((row) => this.mapProviderInvocationUsageRow(row)), (row) => row.sprintRunId);
  }

  private groupUsageBy(
    rows: ProviderInvocationUsageRecord[],
    keySelector: (row: ProviderInvocationUsageRecord) => string | null,
  ): Map<string, ExecutionUsageTotals> {
    const map = new Map<string, ExecutionUsageTotals>();
    for (const row of rows) {
      const key = keySelector(row);
      if (!key) {
        continue;
      }
      const current = map.get(key) || createEmptyUsageTotals();
      this.mergeUsageTotals(current, row);
      map.set(key, current);
    }
    return map;
  }

  private getWallTimeTotalsByTaskIds(taskIds: string[], nowIso: string): Map<string, number> {
    if (taskIds.length === 0) {
      return new Map();
    }
    const rows = this.storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
      sqlPrefix: `
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
      WHERE task_id`,
      sqlSuffix: "GROUP BY task_id",
      items: taskIds,
      bindParamsBefore: [nowIso],
    });
    return new Map(rows.map((row) => [row.task_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
  }

  private getWallTimeTotalsBySprintRunIds(sprintRunIds: string[], nowIso: string): Map<string, number> {
    if (sprintRunIds.length === 0) {
      return new Map();
    }
    const rows = this.storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
      sqlPrefix: `
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
      WHERE sprint_run_id`,
      sqlSuffix: "GROUP BY sprint_run_id",
      items: sprintRunIds,
      bindParamsBefore: [nowIso],
    });
    return new Map(rows.map((row) => [row.sprint_run_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
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

  private getTaskMetadata(projectId: string): Map<string, StatsEntityMetadata> {
    const rows = this.db.prepare(`
      SELECT t.id, t.task_key, t.title, t.status, s.name AS sprint_name
      FROM tasks t
      INNER JOIN sprints s ON s.id = t.sprint_id
      WHERE t.project_id = ?
    `).all(projectId) as unknown as Array<{ id: string; task_key: string; title: string; status: string; sprint_name: string }>;
    return new Map(rows.map((row) => [row.id, {
      label: `${row.task_key} ${row.title}`.trim(),
      secondaryLabel: row.sprint_name,
      status: row.status,
      provider: null,
      purpose: null,
      lastActivityAt: null,
    }] as const));
  }

  private getSprintMetadata(projectId: string): Map<string, StatsEntityMetadata> {
    const rows = this.db.prepare(`
      SELECT s.id AS sprint_id, sr.id AS sprint_run_id, s.name, s.number, sr.status
      FROM sprints s
      LEFT JOIN sprint_runs sr ON sr.sprint_id = s.id
      WHERE s.project_id = ?
    `).all(projectId) as unknown as Array<{
      sprint_id: string;
      sprint_run_id: string | null;
      name: string;
      number: number | string | null;
      status: string | null;
    }>;

    const map = new Map<string, StatsEntityMetadata>();

    for (const row of rows) {
      const summary = {
        label: row.number === null ? row.name : `Sprint ${toNumber(row.number)} · ${row.name}`,
        secondaryLabel: null,
        status: row.status,
        provider: null,
        purpose: null,
        lastActivityAt: null,
      } as const;
      map.set(row.sprint_id, summary);
      if (row.sprint_run_id) {
        map.set(row.sprint_run_id, summary);
      }
    }

    return map;
  }

  private createUsageBuckets(
    range: ProjectExecutionStatsSnapshot["range"],
    bucketSizeMs: number,
  ): Array<ExecutionUsageBucketSummary & { bucketStartMs: number }> {
    const buckets: Array<ExecutionUsageBucketSummary & { bucketStartMs: number }> = [];
    const startMs = new Date(range.from).getTime();
    for (let index = 0; index < range.bucketCount; index += 1) {
      const bucketStartMs = startMs + index * bucketSizeMs;
      const bucketEndMs = bucketStartMs + bucketSizeMs;
      const bucketStart = new Date(bucketStartMs);
      const label = this.formatBucketLabel(bucketStart, range.resolution);
      buckets.push({
        bucketStart: bucketStart.toISOString(),
        bucketEnd: new Date(bucketEndMs).toISOString(),
        bucketStartMs,
        label,
        usage: createEmptyUsageTotals(),
      });
    }
    return buckets;
  }

  private toStatsEntitySummaries(args: {
    entries: Map<string, ExecutionUsageTotals>;
    metadata: Map<string, StatsEntityMetadata>;
    kind: "task" | "sprint" | "provider" | "purpose";
  }): ExecutionStatsEntitySummary[] {
    const summaries = Array.from(args.entries.entries()).map(([id, usage]) => {
      const meta = args.metadata.get(id);
      const label = meta?.label
        || (args.kind === "provider"
          ? id
          : args.kind === "purpose"
            ? id.replace(/_/g, " ")
            : id);
      return {
        id,
        label,
        secondaryLabel: meta?.secondaryLabel || null,
        status: meta?.status || null,
        purpose: (meta?.purpose || (args.kind === "purpose" ? id : null)) as ExecutionStatsEntitySummary["purpose"],
        provider: (meta?.provider || (args.kind === "provider" ? id : null)) as ExecutionStatsEntitySummary["provider"],
        usage,
        lastActivityAt: meta?.lastActivityAt || null,
      };
    });
    return summaries.sort((left, right) => (
      right.usage.totalTokens - left.usage.totalTokens
      || right.usage.activeTimeMs - left.usage.activeTimeMs
      || left.label.localeCompare(right.label)
    ));
  }

  private normalizeProjectStatsQuery(
    projectId: string,
    input: ProjectStatsQuery | ProjectStatsWindow,
    now: Date,
  ): NormalizedProjectStatsQuery {
    const query = typeof input === "string"
      ? { window: input }
      : {
        window: input.window,
        from: input.from ?? undefined,
        to: input.to ?? undefined,
      };

    if (query.window === "custom") {
      const fromDate = this.parseStatsDateInput(query.from, "start");
      const toDate = this.parseStatsDateInput(query.to, "end");
      if (!fromDate || !toDate) {
        throw new Error("Custom stats windows require valid from and to values.");
      }
      if (fromDate.getTime() > toDate.getTime()) {
        throw new Error("Custom stats window start must be earlier than end.");
      }
      return this.buildStatsRangeFromBounds(query, fromDate, toDate);
    }

    if (query.window === "24h") {
      const alignedEnd = new Date(now);
      alignedEnd.setMinutes(0, 0, 0);
      const bucketSizeMs = 60 * 60 * 1000;
      const bucketCount = 24;
      const start = new Date(alignedEnd.getTime() - (bucketCount - 1) * bucketSizeMs);
      return this.buildStatsRange({
        query,
        window: "24h",
        from: start,
        bucketSizeMs,
        bucketCount,
        resolution: "hour",
        label: "Last 24 hours",
        resolutionLabel: "Hourly telemetry buckets",
      });
    }

    if (query.window === "7d" || query.window === "30d") {
      const alignedEnd = this.startOfUtcDay(now);
      const bucketSizeMs = 24 * 60 * 60 * 1000;
      const bucketCount = query.window === "7d" ? 7 : 30;
      const start = new Date(alignedEnd.getTime() - (bucketCount - 1) * bucketSizeMs);
      return this.buildStatsRange({
        query,
        window: query.window,
        from: start,
        bucketSizeMs,
        bucketCount,
        resolution: "day",
        label: query.window === "7d" ? "Last 7 days" : "Last 30 days",
        resolutionLabel: "Daily telemetry buckets",
      });
    }

    const firstInvocationRow = this.db.prepare(`
      SELECT MIN(started_at) AS first_started_at
      FROM provider_invocations
      WHERE project_id = ?
    `).get(projectId) as { first_started_at: string | null } | undefined;
    const firstInvocation = this.parseStatsDateInput(firstInvocationRow?.first_started_at || undefined, "start") || now;
    const allTimeStart = this.startOfUtcDay(firstInvocation);
    const allTimeEnd = this.startOfUtcDay(now);
    return this.buildStatsRangeFromBounds(query, allTimeStart, new Date(allTimeEnd.getTime() + (24 * 60 * 60 * 1000) - 1));
  }

  private buildStatsRangeFromBounds(
    query: ProjectStatsQuery,
    fromDate: Date,
    toDate: Date,
  ): NormalizedProjectStatsQuery {
    const spanMs = Math.max(1, toDate.getTime() - fromDate.getTime());
    const spanHours = Math.ceil(spanMs / (60 * 60 * 1000));
    const spanDays = Math.ceil(spanMs / (24 * 60 * 60 * 1000));

    if (spanHours <= 48) {
      const bucketSizeMs = 60 * 60 * 1000;
      const start = this.startOfHour(fromDate);
      const end = this.startOfHour(new Date(toDate.getTime() + bucketSizeMs));
      const bucketCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketSizeMs));
      return this.buildStatsRange({
        query,
        window: query.window,
        from: start,
        bucketSizeMs,
        bucketCount,
        resolution: "hour",
        label: query.window === "custom" ? "Custom range" : "All time",
        resolutionLabel: "Hourly telemetry buckets",
      });
    }

    if (spanDays <= 90) {
      const bucketSizeMs = 24 * 60 * 60 * 1000;
      const start = this.startOfUtcDay(fromDate);
      const end = this.startOfUtcDay(new Date(toDate.getTime() + bucketSizeMs));
      const bucketCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketSizeMs));
      return this.buildStatsRange({
        query,
        window: query.window,
        from: start,
        bucketSizeMs,
        bucketCount,
        resolution: "day",
        label: query.window === "custom" ? "Custom range" : "All time",
        resolutionLabel: "Daily telemetry buckets",
      });
    }

    const bucketSizeMs = 7 * 24 * 60 * 60 * 1000;
    const start = this.startOfUtcWeek(fromDate);
    const end = this.startOfUtcWeek(new Date(toDate.getTime() + (24 * 60 * 60 * 1000)));
    const bucketCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketSizeMs));
    return this.buildStatsRange({
      query,
      window: query.window,
      from: start,
      bucketSizeMs,
      bucketCount,
      resolution: "week",
      label: query.window === "custom" ? "Custom range" : "All time",
      resolutionLabel: "Weekly telemetry buckets",
    });
  }

  private buildStatsRange(input: {
    query: ProjectStatsQuery;
    window: ProjectStatsWindow;
    from: Date;
    bucketSizeMs: number;
    bucketCount: number;
    resolution: ProjectStatsResolution;
    label: string;
    resolutionLabel: string;
  }): NormalizedProjectStatsQuery {
    const rangeStart = new Date(input.from);
    const rangeEnd = new Date(rangeStart.getTime() + input.bucketSizeMs * input.bucketCount);
    return {
      query: {
        window: input.query.window,
        from: input.query.from ?? undefined,
        to: input.query.to ?? undefined,
      },
      range: {
        window: input.window,
        label: input.label,
        resolution: input.resolution,
        resolutionLabel: input.resolutionLabel,
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
        bucketCount: input.bucketCount,
        isCustom: input.query.window === "custom",
      },
      bucketSizeMs: input.bucketSizeMs,
    };
  }

  private parseStatsDateInput(value: string | undefined, edge: "start" | "end"): Date | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private startOfUtcDay(date: Date): Date {
    const next = new Date(date);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }

  private startOfHour(date: Date): Date {
    const next = new Date(date);
    next.setMinutes(0, 0, 0);
    return next;
  }

  private startOfUtcWeek(date: Date): Date {
    const next = this.startOfUtcDay(date);
    const day = next.getUTCDay();
    const offset = day === 0 ? 6 : day - 1;
    next.setUTCDate(next.getUTCDate() - offset);
    return next;
  }

  private formatBucketLabel(date: Date, resolution: ProjectStatsResolution): string {
    if (resolution === "hour") {
      return date.toISOString().slice(11, 16);
    }
    if (resolution === "week") {
      return `W${this.getIsoWeekNumber(date)}`;
    }
    return date.toISOString().slice(5, 10);
  }

  private getIsoWeekNumber(date: Date): number {
    const utcDate = this.startOfUtcDay(date);
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - (utcDate.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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

  private requireTaskDispatch(dispatchId: string): TaskDispatchRecord {
    const dispatch = this.getTaskDispatch(dispatchId);
    if (!dispatch) {
      throw new Error(`Task dispatch not found: ${dispatchId}`);
    }
    return dispatch;
  }

  private requireTaskRun(taskRunId: string): TaskRunRecord {
    const taskRun = this.getTaskRun(taskRunId);
    if (!taskRun) {
      throw new Error(`Task run not found: ${taskRunId}`);
    }
    return taskRun;
  }

  private requireProviderInvocationUsage(invocationId: string): ProviderInvocationUsageRecord {
    const invocation = this.getProviderInvocationUsage(invocationId);
    if (!invocation) {
      throw new Error(`Provider invocation not found: ${invocationId}`);
    }
    return invocation;
  }

  private requireLease(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): ExecutionLeaseRecord {
    const lease = this.getLease(scopeType, scopeId);
    if (!lease) {
      throw new Error(`Execution lease not found: ${scopeType}:${scopeId}`);
    }
    return lease;
  }

  private requireProject(projectId: string): void {
    const row = this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }

  private requireSprint(sprintId: string, projectId?: string): void {
    const row = this.db.prepare(`
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

  private requireTask(taskId: string, projectId?: string, sprintId?: string): void {
    const row = this.db.prepare(`
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

  private requireSprintRunScoped(runId: string, projectId: string, sprintId: string): void {
    const run = this.requireSprintRun(runId);
    if (run.projectId !== projectId || run.sprintId !== sprintId) {
      throw new Error(`Sprint run ${runId} does not belong to ${projectId}/${sprintId}`);
    }
  }

  private requireConnection(connectionId: string): void {
    const row = this.db.prepare(`SELECT id FROM mcp_connections WHERE id = ?`).get(connectionId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`Connection not found: ${connectionId}`);
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

  private mapProviderInvocationUsageRow(row: ProviderInvocationUsageRow): ProviderInvocationUsageRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      taskRunId: row.task_run_id,
      attentionItemId: row.attention_item_id,
      sessionId: row.session_id,
      provider: row.provider,
      purpose: row.purpose as ProviderInvocationUsageRecord["purpose"],
      status: row.status as ProviderInvocationUsageRecord["status"],
      model: row.model,
      nativeSessionId: row.native_session_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms === null ? null : toNumber(row.duration_ms),
      promptChars: toNumber(row.prompt_chars),
      transcriptChars: toNumber(row.transcript_chars),
      inputTokens: toNumber(row.input_tokens),
      cachedInputTokens: toNumber(row.cached_input_tokens),
      outputTokens: toNumber(row.output_tokens),
      reasoningOutputTokens: toNumber(row.reasoning_output_tokens),
      totalTokens: toNumber(row.input_tokens) + toNumber(row.output_tokens),
      usageSource: row.usage_source as ProviderInvocationUsageRecord["usageSource"],
      rawUsageJson: parsePayloadJson(row.raw_usage_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

  private mapExecutionSprintRunSummaryRow(
    row: ExecutionSprintRunSummaryRow,
    humanIntervention: ExecutionHumanInterventionSummary | null,
    usage: ExecutionUsageTotals,
  ): ExecutionSprintRunSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      status: row.status,
      triggerType: row.trigger_type,
      triggeredBy: row.triggered_by,
      executorMode: row.executor_mode,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      activeLeaseOwnerKey: row.active_lease_owner_key,
      activeLeaseExpiresAt: row.active_lease_expires_at,
      humanIntervention,
      usage,
    };
  }

  private mapExecutionTaskDispatchSummaryRow(row: ExecutionTaskDispatchSummaryRow, usage: ExecutionUsageTotals): ExecutionTaskDispatchSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintRunId: row.sprint_run_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      status: row.status,
      executorType: row.executor_type,
      priority: toNumber(row.priority),
      connectionId: row.connection_id,
      connectionDisplayName: row.connection_display_name,
      connectionRole: row.connection_role,
      taskRunId: row.task_run_id,
      taskRunState: row.task_run_state,
      provider: row.provider,
      sessionId: row.session_id,
      sessionName: row.session_name,
      workerBranch: row.worker_branch,
      prUrl: row.pr_url,
      queuedAt: row.queued_at,
      claimedAt: row.claimed_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      errorMessage: row.error_message,
      activeLeaseOwnerKey: row.active_lease_owner_key,
      activeLeaseExpiresAt: row.active_lease_expires_at,
      usage,
    };
  }

  private mapExecutionRuntimeEventSummaryRow(row: ExecutionRuntimeEventSummaryRow): ExecutionRuntimeEventSummary {
    return {
      id: row.id,
      scopeType: row.scope_type === "sprint_run" ? "sprint_run" : "task_run",
      taskRunId: row.task_run_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      sprintRunStatus: row.sprint_run_status,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      taskRunState: row.task_run_state,
      eventType: row.event_type,
      originator: row.originator,
      sourceEventKey: row.source_event_key,
      provider: row.provider,
      sessionId: row.session_id,
      sessionName: row.session_name,
      workerBranch: row.worker_branch,
      prUrl: row.pr_url,
      connectionId: row.connection_id,
      connectionDisplayName: row.connection_display_name,
      connectionRole: row.connection_role,
      createdAt: row.created_at,
      payload: parsePayloadJson(row.payload_json),
    };
  }

  private mapOverviewTelemetryProjectSummaryRow(
    row: OverviewTelemetryProjectSummaryRow,
    humanIntervention: ExecutionHumanInterventionSummary | null,
  ): OverviewTelemetryProjectSummary {
    return {
      projectId: row.project_id,
      projectName: row.project_name,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
      sprintRunId: row.sprint_run_id,
      sprintRunStatus: row.sprint_run_status,
      activeDispatchCount: toNumber(row.active_dispatch_count),
      runningDispatchCount: toNumber(row.running_dispatch_count),
      updatedAt: row.updated_at,
      humanIntervention,
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

  private listActiveAttentionRowsForSprintRuns(sprintRunIds: string[]): ProjectAttentionSummaryRow[] {
    if (sprintRunIds.length === 0) {
      return [];
    }

    return this.storage.executeChunkedInQuery<ProjectAttentionSummaryRow>({
      sqlPrefix: `SELECT
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
      WHERE sprint_run_id`,
      sqlSuffix: "AND status IN ('open', 'claimed') ORDER BY updated_at DESC, opened_at DESC, id DESC",
      items: sprintRunIds,
    });
  }

  private buildHumanInterventionSummaryBySprintRun(
    sprintRuns: Array<{ id: string; sprint_id: string; status: string }>,
    attentionRows: ProjectAttentionSummaryRow[],
    recentEvents: ExecutionRuntimeEventSummaryRow[],
  ): Map<string, ExecutionHumanInterventionSummary> {
    const bySprintRunId = new Map<string, ExecutionHumanInterventionSummary>();
    const attentionBySprintRunId = new Map<string, ProjectAttentionSummaryRow[]>();
    const eventsBySprintRunId = new Map<string, ExecutionRuntimeEventSummaryRow[]>();

    for (const row of attentionRows) {
      const sprintRunId = asNonEmptyString(row.sprint_run_id);
      if (!sprintRunId || !this.isOperatorInterventionAttentionRow(row)) {
        continue;
      }
      const existing = attentionBySprintRunId.get(sprintRunId) || [];
      existing.push(row);
      attentionBySprintRunId.set(sprintRunId, existing);
    }

    for (const event of recentEvents) {
      const sprintRunId = asNonEmptyString(event.sprint_run_id);
      if (!sprintRunId) {
        continue;
      }
      const existing = eventsBySprintRunId.get(sprintRunId) || [];
      existing.push(event);
      eventsBySprintRunId.set(sprintRunId, existing);
    }

    for (const sprintRun of sprintRuns) {
      const attentionSummary = this.buildHumanInterventionSummaryFromAttentionRows(
        attentionBySprintRunId.get(sprintRun.id) || [],
      );
      if (attentionSummary) {
        bySprintRunId.set(sprintRun.id, attentionSummary);
        continue;
      }
      const eventSummary = this.buildHumanInterventionSummaryFromEvents(
        sprintRun.status,
        eventsBySprintRunId.get(sprintRun.id) || [],
      );
      if (eventSummary) {
        bySprintRunId.set(sprintRun.id, eventSummary);
      }
    }

    return bySprintRunId;
  }

  private buildHumanInterventionSummaryFromAttentionRows(
    attentionRows: ProjectAttentionSummaryRow[],
  ): ExecutionHumanInterventionSummary | null {
    const bestRow = [...attentionRows].sort((left, right) => this.compareAttentionPriority(left, right))[0];
    if (!bestRow) {
      return null;
    }

    const payload = parsePayloadJson(bestRow.payload_json);
    const title = bestRow.title.trim() || "Human intervention required";
    const reason = stripMarkdown(bestRow.summary_markdown || title) || title;

    switch (bestRow.attention_type) {
      case "merge_required": {
        const featureBranch = asNonEmptyString(payload?.featureBranch);
        const workerBranch = asNonEmptyString(payload?.workerBranch);
        const prUrl = asNonEmptyString(payload?.prUrl);
        const taskKey = asNonEmptyString(payload?.taskKey);
        const instructions = prUrl
          ? `Review and merge the completed task PR (${prUrl})${featureBranch ? ` into ${featureBranch}` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`
          : `Merge${taskKey ? ` ${taskKey}` : " the completed task"}${workerBranch ? ` from ${workerBranch}` : ""}${featureBranch ? ` into ${featureBranch}` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`;
        return this.createHumanInterventionSummary(bestRow, title, reason, instructions);
      }
      case "merge_conflict": {
        const featureBranch = asNonEmptyString(payload?.featureBranch);
        const workerBranch = asNonEmptyString(payload?.workerBranch);
        const prUrl = asNonEmptyString(payload?.prUrl);
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          prUrl
            ? `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the PR is clean. (${prUrl})`
            : `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the branches merge cleanly.`,
        );
      }
      case "action_required": {
        const interventionOwner = String(payload?.interventionOwner || "").toUpperCase();
        const sessionState = asNonEmptyString(payload?.sessionState);
        const provider = asNonEmptyString(payload?.provider);
        const instructions = interventionOwner === "HUMAN" || bestRow.owner_type === "human"
          ? `Open the blocked task${provider ? ` in ${provider}` : ""}${sessionState ? ` (${sessionState})` : ""}, provide the requested input or approval, then resume the sprint.`
          : `Review the blocked task${provider ? ` in ${provider}` : ""}${sessionState ? ` (${sessionState})` : ""}, resolve the action-required state, then resume the sprint if worker automation does not clear it.`;
        return this.createHumanInterventionSummary(bestRow, title, reason, instructions);
      }
      case "manual_attention":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Open the Live view, inspect the attention queue and blocked tasks, resolve the blocker, then resume the sprint.",
        );
      case "dashboard_reply_required":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Open the project conversation thread, send the requested dashboard reply, then resolve the attention item and resume the sprint.",
        );
      case "human_escalation_required":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Open the project handoff thread, perform the requested manual action, then resolve the attention item and resume the sprint.",
        );
      case "worker_dispatch_blocked":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Review the blocked worker dispatch in Live view, address the worker error, then retry or resume the sprint.",
        );
      case "worker_lease_expired":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Check the assigned worker connection, restart or reassign it if needed, then retry or resume the sprint.",
        );
      case "dispatch_cancel_stalled":
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Review the stalled cancellation in Live view and force cancel or clean up the run before restarting the sprint.",
        );
      default:
        return this.createHumanInterventionSummary(
          bestRow,
          title,
          reason,
          "Review the active attention item in Live view, resolve the blocker, then resume the sprint.",
        );
    }
  }

  private buildHumanInterventionSummaryFromEvents(
    sprintRunStatus: string,
    recentEvents: ExecutionRuntimeEventSummaryRow[],
  ): ExecutionHumanInterventionSummary | null {
    if (recentEvents.length === 0) {
      return null;
    }

    const latestRelevantEvent = recentEvents.find((event) => (
      event.event_type === "branch_preflight_blocked"
      || event.event_type === "planning_preflight_blocked"
      || event.event_type === "sprint_merge_required"
      || event.event_type === "sprint_no_more_actions"
      || event.event_type === "sprint_paused"
    ));
    if (!latestRelevantEvent) {
      return null;
    }

    const payload = parsePayloadJson(latestRelevantEvent.payload_json);

    switch (latestRelevantEvent.event_type) {
      case "branch_preflight_blocked": {
        const featureBranch = asNonEmptyString(payload?.featureBranch) || "the sprint feature branch";
        return {
          title: "Branch preparation blocked",
          reason: `Sprint OS could not prepare ${featureBranch} automatically.`,
          instructions: "Check git authentication, remote push permissions, and local branch state, then resume the sprint.",
          attentionType: null,
          severity: "high",
          ownerType: "human",
        };
      }
      case "planning_preflight_blocked": {
        const planningTarget = asNonEmptyString(payload?.planningTarget) || "this sprint";
        return {
          title: "Sprint planning required",
          reason: `${planningTarget} must be planned into executable tasks before orchestration can continue.`,
          instructions: "Use Plan Sprint on the Sprints page, review the generated tasks, then start the sprint again.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      }
      case "sprint_merge_required": {
        const awaitingMergeCount = Number(payload?.awaitingMergeCount || 0);
        return {
          title: "Manual merge required",
          reason: `Sprint execution paused because ${awaitingMergeCount || "one or more"} completed task${awaitingMergeCount === 1 ? "" : "s"} still need manual merge work.`,
          instructions: "Merge the completed task branches or PRs into the sprint branch, then resume the sprint. You can enable feature PR automerge later to reduce manual merges.",
          attentionType: null,
          severity: "high",
          ownerType: "human",
        };
      }
      case "sprint_no_more_actions":
      case "sprint_paused":
        if (sprintRunStatus !== "paused") {
          return null;
        }
        return {
          title: "Manual attention required",
          reason: "Sprint execution paused because no further automatic action was available.",
          instructions: "Open the Live view, inspect the blocked tasks and attention queue, resolve the blocker, then resume the sprint.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      default:
        return null;
    }
  }

  private isOperatorInterventionAttentionRow(row: ProjectAttentionSummaryRow): boolean {
    if (row.status !== "open" && row.status !== "claimed") {
      return false;
    }

    if (
      row.attention_type === "merge_required"
      || row.attention_type === "manual_attention"
      || row.attention_type === "dashboard_reply_required"
      || row.attention_type === "human_escalation_required"
      || row.attention_type === "worker_dispatch_blocked"
      || row.attention_type === "worker_lease_expired"
      || row.attention_type === "dispatch_cancel_stalled"
    ) {
      return true;
    }

    if (row.attention_type === "merge_conflict") {
      return row.owner_type !== "worker";
    }

    if (row.attention_type !== "action_required") {
      return row.owner_type !== "worker";
    }

    const payload = parsePayloadJson(row.payload_json);
    return row.owner_type === "human" || String(payload?.interventionOwner || "").toUpperCase() === "HUMAN";
  }

  private compareAttentionPriority(left: ProjectAttentionSummaryRow, right: ProjectAttentionSummaryRow): number {
    const attentionPriority = (value: string): number => {
      switch (value) {
        case "human_escalation_required":
          return 0;
        case "dashboard_reply_required":
          return 1;
        case "merge_conflict":
          return 2;
        case "merge_required":
          return 3;
        case "action_required":
          return 4;
        case "manual_attention":
          return 5;
        case "worker_dispatch_blocked":
          return 6;
        case "worker_lease_expired":
          return 7;
        case "dispatch_cancel_stalled":
          return 8;
        default:
          return 9;
      }
    };
    const severityPriority = (value: string): number => {
      switch (value) {
        case "critical":
          return 0;
        case "high":
          return 1;
        case "medium":
          return 2;
        default:
          return 3;
      }
    };

    return attentionPriority(left.attention_type) - attentionPriority(right.attention_type)
      || severityPriority(left.severity) - severityPriority(right.severity)
      || right.updated_at.localeCompare(left.updated_at)
      || left.id.localeCompare(right.id);
  }

  private createHumanInterventionSummary(
    row: ProjectAttentionSummaryRow,
    title: string,
    reason: string,
    instructions: string,
  ): ExecutionHumanInterventionSummary {
    return {
      title,
      reason,
      instructions,
      attentionType: row.attention_type,
      severity: row.severity,
      ownerType: row.owner_type,
    };
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
    this.realtimeNotifier?.scheduleProjectExecutionRefresh(projectId, { includeOverview });
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

  private resolveLeaseProjectId(scopeType: ExecutionLeaseRecord["scopeType"], scopeId: string): string | null {
    if (scopeType === "sprint") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM sprints
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      return row?.project_id || null;
    }

    if (scopeType === "task_dispatch") {
      const row = this.db.prepare(`
        SELECT project_id
        FROM task_dispatches
        WHERE id = ?
      `).get(scopeId) as { project_id: string } | undefined;
      return row?.project_id || null;
    }

    return null;
  }
}
