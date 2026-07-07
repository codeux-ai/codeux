import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, toNumber, ValidationError } from "./repository-utils.js";
import type {
  CreateSchedulerEntryInput,
  ScheduleAgentSchedulerMetadata,
  ScheduleAgentWakeupTarget,
  ScheduleAnchor,
  ScheduleChatTarget,
  ScheduleMemoryRemediationTarget,
  ScheduleNodeFlowTarget,
  ScheduleQuicksprintTarget,
  ScheduleRecurrenceRule,
  SchedulerEntryRecord,
  ScheduleSprintTarget,
  ScheduleStatus,
  ScheduleTaskTarget,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
} from "../contracts/scheduler-types.js";
import type { ProviderId } from "../contracts/app-types.js";
import { computeFirstOccurrenceAtOrAfter, normalizeRecurrenceRule } from "../domain/scheduler/schedule-time.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";

const SCHEDULER_TASK_PROVIDER_IDS = new Set<ProviderId>([
  "jules",
  "gemini",
  "codex",
  "claude-code",
  "qwen-code",
  "opencode",
  "antigravity",
  "mockup-cli",
]);

interface SchedulerEntryRow {
  id: string;
  project_id: string;
  title: string;
  target_type: ScheduleTargetType;
  status: ScheduleStatus;
  scheduled_for: string;
  timezone: string;
  recurrence_json: string;
  target_json: string;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number | string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface PersistedTargetPayload {
  // Anchors live in target_json so existing scheduler_entries rows keep hydrating
  // without a destructive schema migration.
  scheduleAnchor?: ScheduleAnchor;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  chatTarget?: ScheduleChatTarget;
  agentWakeupTarget?: ScheduleAgentWakeupTarget;
  taskTarget?: ScheduleTaskTarget;
  memoryRemediationTarget?: ScheduleMemoryRemediationTarget;
  nodeFlowTarget?: ScheduleNodeFlowTarget;
}

export class SchedulerRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }

  listEntries(projectId: string): SchedulerEntryRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT *
      FROM scheduler_entries
      WHERE project_id = ?
      ORDER BY scheduled_for ASC, created_at ASC
    `).all(projectId) as unknown as SchedulerEntryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listDueEntries(nowIso: string): SchedulerEntryRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM scheduler_entries
      WHERE status = 'scheduled'
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC, created_at ASC
      LIMIT 25
    `).all(nowIso) as unknown as SchedulerEntryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listScheduledAnchoredEntries(limit = 25): SchedulerEntryRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM scheduler_entries
      WHERE status = 'scheduled'
        AND target_json LIKE '%"scheduleAnchor"%'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(Math.max(1, Math.floor(limit))) as unknown as SchedulerEntryRow[];
    return rows.map((row) => this.mapRow(row)).filter((entry) => Boolean(entry.scheduleAnchor));
  }

  getEntry(entryId: string): SchedulerEntryRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM scheduler_entries
      WHERE id = ?
    `).get(entryId) as SchedulerEntryRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  createEntry(projectId: string, input: CreateSchedulerEntryInput): SchedulerEntryRecord {
    this.requireProject(projectId);
    const id = randomUUID();
    const now = new Date().toISOString();
    const scheduleAnchor = this.normalizeScheduleAnchor(input.scheduleAnchor);
    const scheduledFor = input.scheduledFor
      ? this.normalizeDate(input.scheduledFor, "scheduledFor")
      : this.defaultScheduledFor(scheduleAnchor);
    const recurrence = normalizeRecurrenceRule(input.recurrence);
    this.validateAnchorRecurrence(scheduleAnchor, recurrence);
    const targetPayload = this.normalizeTargetPayload(input.targetType, input);
    if (scheduleAnchor) {
      targetPayload.scheduleAnchor = scheduleAnchor;
    }
    const title = this.normalizeTitle(input.title, input.targetType, targetPayload);
    const status: ScheduleStatus = "scheduled";

    this.db.prepare(`
      INSERT INTO scheduler_entries (
        id, project_id, title, target_type, status, scheduled_for, timezone, recurrence_json,
        target_json, next_run_at, last_run_at, run_count, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      title,
      input.targetType,
      status,
      scheduledFor,
      input.timezone?.trim() || "UTC",
      JSON.stringify(recurrence),
      JSON.stringify(targetPayload),
      scheduleAnchor ? null : scheduledFor,
      null,
      0,
      null,
      now,
      now,
    );

    const created = this.requireEntry(id);
    this.publishProjectStructureRefresh(projectId);
    return created;
  }

  updateEntry(entryId: string, input: UpdateSchedulerEntryInput): SchedulerEntryRecord {
    const current = this.requireEntry(entryId);
    const nextTargetType = input.targetType ?? current.targetType;
    const isTargetTypeChanged = input.targetType !== undefined && input.targetType !== current.targetType;
    const nextScheduleAnchor = input.scheduleAnchor === undefined
      ? current.scheduleAnchor
      : this.normalizeScheduleAnchor(input.scheduleAnchor);
    const nextTargetPayload = this.normalizeTargetPayload(nextTargetType, {
      targetType: nextTargetType,
      sprintTarget: isTargetTypeChanged ? input.sprintTarget : (input.sprintTarget ?? current.sprintTarget),
      quicksprintTarget: isTargetTypeChanged ? input.quicksprintTarget : (input.quicksprintTarget ?? current.quicksprintTarget),
      chatTarget: isTargetTypeChanged ? input.chatTarget : (input.chatTarget ?? current.chatTarget),
      agentWakeupTarget: isTargetTypeChanged ? input.agentWakeupTarget : (input.agentWakeupTarget ?? current.agentWakeupTarget),
      taskTarget: isTargetTypeChanged ? input.taskTarget : (input.taskTarget ?? current.taskTarget),
      memoryRemediationTarget: isTargetTypeChanged ? input.memoryRemediationTarget : (input.memoryRemediationTarget ?? current.memoryRemediationTarget),
      nodeFlowTarget: isTargetTypeChanged ? input.nodeFlowTarget : (input.nodeFlowTarget ?? current.nodeFlowTarget),
      scheduledFor: input.scheduledFor ?? current.scheduledFor,
    });
    if (nextScheduleAnchor) {
      nextTargetPayload.scheduleAnchor = nextScheduleAnchor;
    }
    const nextScheduledFor = input.scheduledFor
      ? this.normalizeDate(input.scheduledFor, "scheduledFor")
      : current.scheduledFor;
    const nextRecurrence = input.recurrence
      ? normalizeRecurrenceRule({ ...current.recurrence, ...input.recurrence })
      : current.recurrence;
    this.validateAnchorRecurrence(nextScheduleAnchor, nextRecurrence);
    const nextStatus = input.status ?? current.status;
    const now = new Date().toISOString();

    let nextRunAt = current.nextRunAt;
    if (nextStatus === "scheduled") {
      const isResuming = input.status === "scheduled" && current.status !== "scheduled";
      const isExplicitScheduleChange = input.scheduledFor !== undefined || input.recurrence !== undefined || input.scheduleAnchor !== undefined;

      if (nextScheduleAnchor) {
        nextRunAt = null;
      } else if (isResuming) {
        nextRunAt = computeFirstOccurrenceAtOrAfter(nextScheduledFor, nextRecurrence, now);
      } else if (isExplicitScheduleChange) {
        nextRunAt = nextScheduledFor;
      }
    }

    this.db.prepare(`
      UPDATE scheduler_entries
      SET title = ?, status = ?, scheduled_for = ?, timezone = ?, recurrence_json = ?,
          target_json = ?, next_run_at = ?, updated_at = ?, last_error = ?, target_type = ?
      WHERE id = ?
    `).run(
      input.title?.trim() || current.title,
      nextStatus,
      nextScheduledFor,
      input.timezone?.trim() || current.timezone,
      JSON.stringify(nextRecurrence),
      JSON.stringify(nextTargetPayload),
      nextRunAt,
      now,
      nextStatus === "scheduled" ? null : current.lastError,
      nextTargetType,
      entryId,
    );

    const updated = this.requireEntry(entryId);
    this.publishProjectStructureRefresh(current.projectId);
    return updated;
  }

  deleteEntry(entryId: string): void {
    const current = this.requireEntry(entryId);
    this.db.prepare(`DELETE FROM scheduler_entries WHERE id = ?`).run(entryId);
    this.publishProjectStructureRefresh(current.projectId);
  }

  markRunSucceeded(entryId: string, occurrenceIso: string, nextRunAt: string | null): SchedulerEntryRecord {
    const current = this.requireEntry(entryId);
    const now = new Date().toISOString();
    const nextStatus: ScheduleStatus = nextRunAt ? "scheduled" : "completed";
    this.db.prepare(`
      UPDATE scheduler_entries
      SET status = ?, next_run_at = ?, last_run_at = ?, run_count = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(nextStatus, nextRunAt, occurrenceIso, current.runCount + 1, now, entryId);
    const updated = this.requireEntry(entryId);
    this.publishProjectStructureRefresh(updated.projectId);
    return updated;
  }

  markRunFailed(entryId: string, error: string): SchedulerEntryRecord {
    const current = this.requireEntry(entryId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE scheduler_entries
      SET status = 'failed', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(error, now, entryId);
    const updated = this.requireEntry(entryId);
    this.publishProjectStructureRefresh(current.projectId);
    return updated;
  }

  private requireProject(projectId: string): void {
    requireRecord(this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId), "Project", projectId);
  }

  private requireEntry(entryId: string): SchedulerEntryRecord {
    const entry = this.getEntry(entryId);
    if (!entry) {
      throw new EntityNotFoundError(`Scheduler entry not found: ${entryId}`);
    }
    return entry;
  }

  private normalizeTargetPayload(targetType: ScheduleTargetType, input: (CreateSchedulerEntryInput | UpdateSchedulerEntryInput) & { targetType: ScheduleTargetType }): PersistedTargetPayload {
    if (targetType === "sprint") {
      const sprintId = input.sprintTarget?.sprintId?.trim();
      if (!sprintId) {
        throw new ValidationError("sprintTarget.sprintId is required.");
      }
      return { sprintTarget: { sprintId } };
    }

    if (targetType === "quicksprint") {
      const templateId = input.quicksprintTarget?.templateId?.trim();
      if (!templateId) {
        throw new ValidationError("quicksprintTarget.templateId is required.");
      }
      return {
        quicksprintTarget: {
          templateId,
          taskCount: Math.max(1, Math.floor(Number(input.quicksprintTarget?.taskCount ?? 5)) || 5),
          ...(input.quicksprintTarget?.noTaskLimit === true ? { noTaskLimit: true } : {}),
          submitMode: input.quicksprintTarget?.submitMode ?? "plan_and_start",
          additionalPrompt: input.quicksprintTarget?.additionalPrompt?.trim() || undefined,
          agentPresetId: input.quicksprintTarget?.agentPresetId?.trim() || undefined,
          planningOverrides: input.quicksprintTarget?.planningOverrides,
        },
      };
    }

    if (targetType === "memory_remediation") {
      return {
        memoryRemediationTarget: {
          mode: input.memoryRemediationTarget?.mode === "ai" ? "ai" : "deterministic",
          source: input.memoryRemediationTarget?.source === "memory_settings" ? "memory_settings" : "scheduler",
        },
      };
    }

    if (targetType === "node_flow") {
      const flowId = input.nodeFlowTarget?.flowId?.trim();
      if (!flowId) {
        throw new ValidationError("nodeFlowTarget.flowId is required.");
      }
      const target: ScheduleNodeFlowTarget = { flowId };
      const normalizedInput = this.normalizeJsonObject(input.nodeFlowTarget?.input, "nodeFlowTarget.input");
      if (normalizedInput) {
        target.input = normalizedInput;
      }
      const flowVersion = this.normalizeOptionalPositiveInteger(input.nodeFlowTarget?.flowVersion, "nodeFlowTarget.flowVersion");
      if (flowVersion !== undefined) {
        target.flowVersion = flowVersion;
      }
      return { nodeFlowTarget: target };
    }

    if (targetType === "agent_wakeup") {
      const bodyMarkdown = input.agentWakeupTarget?.bodyMarkdown?.trim();
      if (!bodyMarkdown) {
        throw new ValidationError("agentWakeupTarget.bodyMarkdown is required.");
      }
      return {
        agentWakeupTarget: {
          bodyMarkdown,
          threadId: input.agentWakeupTarget?.threadId?.trim() || null,
          title: input.agentWakeupTarget?.title?.trim() || "Scheduled agent wakeup",
          connectionId: input.agentWakeupTarget?.connectionId?.trim() || null,
          ...this.normalizeAgentSchedulerMetadata(input.agentWakeupTarget),
        },
      };
    }

    if (targetType === "task") {
      const taskId = input.taskTarget?.taskId?.trim();
      if (!taskId) {
        throw new ValidationError("taskTarget.taskId is required.");
      }
      return {
        taskTarget: {
          taskId,
          ...this.normalizeTaskProvider(input.taskTarget?.provider),
          ...this.normalizeAgentSchedulerMetadata(input.taskTarget),
        },
      };
    }

    const bodyMarkdown = input.chatTarget?.bodyMarkdown?.trim();
    if (!bodyMarkdown) {
      throw new ValidationError("chatTarget.bodyMarkdown is required.");
    }
    return {
      chatTarget: {
        bodyMarkdown,
        threadId: input.chatTarget?.threadId?.trim() || null,
        title: input.chatTarget?.title?.trim() || "Scheduled message",
        connectionId: input.chatTarget?.connectionId?.trim() || null,
      },
    };
  }

  private normalizeTitle(title: string | undefined, targetType: ScheduleTargetType, target: PersistedTargetPayload): string {
    const explicitTitle = title?.trim();
    if (explicitTitle) {
      return explicitTitle;
    }
    if (targetType === "sprint") {
      return "Scheduled sprint";
    }
    if (targetType === "quicksprint") {
      return "Scheduled quicksprint";
    }
    if (targetType === "memory_remediation") {
      return "Scheduled memory remediation";
    }
    if (targetType === "agent_wakeup") {
      return target.agentWakeupTarget?.title || "Scheduled agent wakeup";
    }
    if (targetType === "task") {
      return "Scheduled task rerun";
    }
    if (targetType === "node_flow") {
      return "Scheduled node flow";
    }
    return target.chatTarget?.title || "Scheduled chat message";
  }

  private normalizeAgentSchedulerMetadata(
    value: Partial<ScheduleAgentSchedulerMetadata> | undefined,
  ): ScheduleAgentSchedulerMetadata {
    return {
      origin: "agent_scheduler",
      source: "agent_scheduler",
      createdByAgentId: value?.createdByAgentId?.trim() || undefined,
    };
  }

  private normalizeTaskProvider(provider: ProviderId | undefined): Pick<ScheduleTaskTarget, "provider"> {
    if (!provider) {
      return {};
    }
    if (!SCHEDULER_TASK_PROVIDER_IDS.has(provider)) {
      throw new ValidationError("taskTarget.provider must be a supported provider.");
    }
    return { provider };
  }

  private normalizeJsonObject(value: unknown, fieldName: string): ScheduleNodeFlowTarget["input"] | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || !this.isJsonValue(value)) {
      throw new ValidationError(`${fieldName} must be a JSON object.`);
    }
    return value as ScheduleNodeFlowTarget["input"];
  }

  private normalizeOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const parsed = typeof value === "string" && value.trim()
      ? Number(value.trim())
      : Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new ValidationError(`${fieldName} must be a positive integer.`);
    }
    return Math.floor(parsed);
  }

  private isJsonValue(value: unknown): boolean {
    if (value === null) {
      return true;
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return true;
    }
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
      return value.every((entry) => this.isJsonValue(entry));
    }
    return typeof value === "object"
      && Object.values(value as Record<string, unknown>).every((entry) => this.isJsonValue(entry));
  }

  private normalizeDate(value: string, fieldName: string): string {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new ValidationError(`${fieldName} must be a valid ISO date.`);
    }
    return parsed.toISOString();
  }

  private defaultScheduledFor(scheduleAnchor: ScheduleAnchor | undefined): string {
    if (scheduleAnchor) {
      return new Date().toISOString();
    }
    throw new ValidationError("scheduledFor is required for absolute scheduler entries.");
  }

  private normalizeScheduleAnchor(value: ScheduleAnchor | null | undefined): ScheduleAnchor | undefined {
    if (!value) {
      return undefined;
    }
    if (value.mode !== "after_sprint_end") {
      throw new ValidationError("scheduleAnchor.mode must be after_sprint_end.");
    }
    const sourceSprintId = value.sourceSprintId?.trim();
    if (!sourceSprintId) {
      throw new ValidationError("scheduleAnchor.sourceSprintId is required.");
    }
    const rawOffset = value.offsetMinutes ?? 0;
    const offsetMinutes = Number(rawOffset);
    if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0) {
      throw new ValidationError("scheduleAnchor.offsetMinutes must be a non-negative number.");
    }
    return {
      mode: "after_sprint_end",
      sourceSprintId,
      offsetMinutes: Math.floor(offsetMinutes),
    };
  }

  private validateAnchorRecurrence(scheduleAnchor: ScheduleAnchor | undefined, recurrence: ScheduleRecurrenceRule): void {
    if (scheduleAnchor && recurrence.frequency !== "none") {
      throw new ValidationError("after_sprint_end scheduler anchors do not support recurrence.");
    }
  }

  private mapRow(row: SchedulerEntryRow): SchedulerEntryRecord {
    const recurrence = this.parseRecurrence(row.recurrence_json);
    const target = this.parseTarget(row.target_json);
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      targetType: row.target_type,
      status: row.status,
      scheduledFor: row.scheduled_for,
      scheduleAnchor: target.scheduleAnchor,
      timezone: row.timezone,
      recurrence,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      runCount: toNumber(row.run_count),
      lastError: row.last_error,
      sprintTarget: target.sprintTarget,
      quicksprintTarget: target.quicksprintTarget,
      chatTarget: target.chatTarget,
      agentWakeupTarget: target.agentWakeupTarget,
      taskTarget: target.taskTarget,
      memoryRemediationTarget: target.memoryRemediationTarget,
      nodeFlowTarget: target.nodeFlowTarget,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private parseRecurrence(value: string): ScheduleRecurrenceRule {
    try {
      return normalizeRecurrenceRule(JSON.parse(value) as Partial<ScheduleRecurrenceRule>);
    } catch {
      return normalizeRecurrenceRule();
    }
  }

  private parseTarget(value: string): PersistedTargetPayload {
    try {
      const parsed = JSON.parse(value) as PersistedTargetPayload;
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      const scheduleAnchor = this.normalizeParsedScheduleAnchor(parsed.scheduleAnchor);
      return {
        ...parsed,
        scheduleAnchor,
      };
    } catch {
      return {};
    }
  }

  private normalizeParsedScheduleAnchor(value: unknown): ScheduleAnchor | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const candidate = value as Partial<ScheduleAnchor>;
    try {
      return this.normalizeScheduleAnchor(candidate as ScheduleAnchor);
    } catch {
      return undefined;
    }
  }

  private publishProjectStructureRefresh(projectId: string): void {
    this.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: false });
  }
}
