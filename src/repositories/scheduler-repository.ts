import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, toNumber, ValidationError } from "./repository-utils.js";
import type {
  CreateSchedulerEntryInput,
  ScheduleChatTarget,
  ScheduleGoalSprintTarget,
  ScheduleQuicksprintTarget,
  ScheduleRecurrenceRule,
  SchedulerEntryRecord,
  ScheduleSprintTarget,
  ScheduleStatus,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
} from "../contracts/scheduler-types.js";
import { computeFirstOccurrenceAtOrAfter, normalizeRecurrenceRule } from "../domain/scheduler/schedule-time.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";

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
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  goalSprintTarget?: ScheduleGoalSprintTarget;
  chatTarget?: ScheduleChatTarget;
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
    const scheduledFor = this.normalizeDate(input.scheduledFor, "scheduledFor");
    const recurrence = normalizeRecurrenceRule(input.recurrence);
    const targetPayload = this.normalizeTargetPayload(input.targetType, input);
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
      scheduledFor,
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
    const nextTargetPayload = this.normalizeTargetPayload(nextTargetType, {
      targetType: nextTargetType,
      sprintTarget: isTargetTypeChanged ? input.sprintTarget : (input.sprintTarget ?? current.sprintTarget),
      quicksprintTarget: isTargetTypeChanged ? input.quicksprintTarget : (input.quicksprintTarget ?? current.quicksprintTarget),
      chatTarget: isTargetTypeChanged ? input.chatTarget : (input.chatTarget ?? current.chatTarget),
      scheduledFor: input.scheduledFor ?? current.scheduledFor,
    });
    const nextScheduledFor = input.scheduledFor
      ? this.normalizeDate(input.scheduledFor, "scheduledFor")
      : current.scheduledFor;
    const nextRecurrence = input.recurrence
      ? normalizeRecurrenceRule({ ...current.recurrence, ...input.recurrence })
      : current.recurrence;
    const nextStatus = input.status ?? current.status;
    const now = new Date().toISOString();

    let nextRunAt = current.nextRunAt;
    if (nextStatus === "scheduled") {
      const isResuming = input.status === "scheduled" && current.status !== "scheduled";
      const isExplicitScheduleChange = input.scheduledFor !== undefined || input.recurrence !== undefined;

      if (isResuming) {
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

  private normalizeTargetPayload(targetType: ScheduleTargetType, input: CreateSchedulerEntryInput | UpdateSchedulerEntryInput & { targetType: ScheduleTargetType }): PersistedTargetPayload {
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
          submitMode: input.quicksprintTarget?.submitMode ?? "plan_and_start",
          additionalPrompt: input.quicksprintTarget?.additionalPrompt?.trim() || undefined,
          agentPresetId: input.quicksprintTarget?.agentPresetId?.trim() || undefined,
          planningOverrides: input.quicksprintTarget?.planningOverrides,
        },
      };
    }

    if (targetType === "goal_sprint") {
      const goalIds = Array.from(new Set((input.goalSprintTarget?.goalIds || []).map((id) => id.trim()).filter(Boolean)));
      if (goalIds.length === 0) {
        throw new ValidationError("goalSprintTarget.goalIds is required.");
      }
      const minSprints = Math.max(1, Math.floor(Number(input.goalSprintTarget?.minSprints ?? 1)) || 1);
      const maxSprints = Math.max(minSprints, Math.floor(Number(input.goalSprintTarget?.maxSprints ?? Math.max(2, minSprints))) || minSprints);
      const minTasks = Math.max(1, Math.floor(Number(input.goalSprintTarget?.minTasks ?? goalIds.length)) || 1);
      const maxTasks = Math.max(minTasks, Math.floor(Number(input.goalSprintTarget?.maxTasks ?? Math.max(minTasks, maxSprints * 6))) || minTasks);
      return {
        goalSprintTarget: {
          goalIds,
          minTasks,
          maxTasks,
          minSprints,
          maxSprints,
          submitMode: input.goalSprintTarget?.submitMode ?? "plan_and_start",
          autoTriggerNext: input.goalSprintTarget?.autoTriggerNext ?? true,
          planningOverrides: input.goalSprintTarget?.planningOverrides,
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
    if (targetType === "goal_sprint") {
      return "Scheduled goal sprint";
    }
    return target.chatTarget?.title || "Scheduled chat message";
  }

  private normalizeDate(value: string, fieldName: string): string {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new ValidationError(`${fieldName} must be a valid ISO date.`);
    }
    return parsed.toISOString();
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
      timezone: row.timezone,
      recurrence,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      runCount: toNumber(row.run_count),
      lastError: row.last_error,
      sprintTarget: target.sprintTarget,
      quicksprintTarget: target.quicksprintTarget,
      goalSprintTarget: target.goalSprintTarget,
      chatTarget: target.chatTarget,
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
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private publishProjectStructureRefresh(projectId: string): void {
    this.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: false });
  }
}
