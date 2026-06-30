import type {
  CreateSchedulerEntryInput,
  MemoryRemediationScheduleResponse,
  MemoryRemediationScheduleSettings,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  UpdateSchedulerEntryInput,
} from "../contracts/scheduler-types.js";
import type { Logger } from "../shared/logging/logger.js";
import { SchedulerRepository } from "../repositories/scheduler-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { QuicksprintService } from "./quicksprint-service.js";
import type { ChatThreadRuntimeService } from "./chat-thread-runtime-service.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { MemoryRemediationService } from "./memory-remediation-service.js";
import { buildSchedulerOccurrences, computeNextRunAfterOccurrence } from "../domain/scheduler/schedule-time.js";
import type { CreateDashboardConversationMessageInput } from "../contracts/connection-chat-types.js";

export interface SchedulerServiceDeps {
  schedulerRepository: SchedulerRepository;
  projectManagementRepository: ProjectManagementRepository;
  quicksprintService: QuicksprintService;
  chatThreadRuntimeService: ChatThreadRuntimeService;
  executionControlService: ExecutionControlService;
  memoryRemediationService?: MemoryRemediationService;
  logger: Logger;
  tickIntervalMs?: number;
}

export class SchedulerService {
  private readonly inFlightEntryIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickIntervalMs: number;

  constructor(private readonly deps: SchedulerServiceDeps) {
    this.tickIntervalMs = deps.tickIntervalMs ?? 30_000;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.runDueEntries();
    this.timer = setInterval(() => {
      void this.runDueEntries();
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  listProjectSchedule(projectId: string, fromIso: string, toIso: string): SchedulerCollectionResponse {
    const entries = this.deps.schedulerRepository.listEntries(projectId);
    return {
      entries,
      occurrences: buildSchedulerOccurrences(entries, fromIso, toIso),
      from: new Date(fromIso).toISOString(),
      to: new Date(toIso).toISOString(),
    };
  }

  createEntry(projectId: string, input: CreateSchedulerEntryInput): SchedulerEntryRecord {
    this.validateInputTarget(projectId, input);
    return this.deps.schedulerRepository.createEntry(projectId, input);
  }

  getMemoryRemediationSchedule(projectId: string): MemoryRemediationScheduleResponse {
    const entry = this.findSettingsManagedMemoryRemediationEntry(projectId);
    return {
      entry,
      cadence: entry ? cadenceFromEntry(entry) : "off",
      mode: entry?.memoryRemediationTarget?.mode ?? "deterministic",
    };
  }

  setMemoryRemediationSchedule(
    projectId: string,
    input: MemoryRemediationScheduleSettings,
  ): MemoryRemediationScheduleResponse {
    const existing = this.findSettingsManagedMemoryRemediationEntry(projectId);
    const mode = input.mode === "ai" ? "ai" : "deterministic";

    if (input.cadence === "off") {
      const entry = existing && existing.status === "scheduled"
        ? this.deps.schedulerRepository.updateEntry(existing.id, { status: "paused" })
        : existing;
      return { entry, cadence: "off", mode: entry?.memoryRemediationTarget?.mode ?? mode };
    }

    const recurrence = {
      frequency: input.cadence,
      interval: 1,
      endMode: "never",
    } as const;
    const scheduledFor = normalizeScheduleStart(input.scheduledFor);
    const payload: CreateSchedulerEntryInput = {
      title: "Long-term memory remediation",
      targetType: "memory_remediation",
      scheduledFor,
      timezone: input.timezone?.trim() || "UTC",
      recurrence,
      memoryRemediationTarget: {
        mode,
        source: "memory_settings",
      },
    };

    const entry = existing
      ? this.deps.schedulerRepository.updateEntry(existing.id, {
        title: payload.title,
        status: "scheduled",
        targetType: payload.targetType,
        scheduledFor: payload.scheduledFor,
        timezone: payload.timezone,
        recurrence: payload.recurrence,
        memoryRemediationTarget: payload.memoryRemediationTarget,
      })
      : this.deps.schedulerRepository.createEntry(projectId, payload);

    return { entry, cadence: input.cadence, mode };
  }

  updateEntry(entryId: string, input: UpdateSchedulerEntryInput): SchedulerEntryRecord {
    const current = this.deps.schedulerRepository.getEntry(entryId);
    if (!current) {
      return this.deps.schedulerRepository.updateEntry(entryId, input);
    }
    this.validateInputTarget(current.projectId, {
      targetType: current.targetType,
      scheduledFor: input.scheduledFor ?? current.scheduledFor,
      sprintTarget: input.sprintTarget ?? current.sprintTarget,
      quicksprintTarget: input.quicksprintTarget ?? current.quicksprintTarget,
      chatTarget: input.chatTarget ?? current.chatTarget,
      memoryRemediationTarget: input.memoryRemediationTarget ?? current.memoryRemediationTarget,
    });
    return this.deps.schedulerRepository.updateEntry(entryId, input);
  }

  deleteEntry(entryId: string): void {
    this.deps.schedulerRepository.deleteEntry(entryId);
  }

  async runDueEntries(now = new Date()): Promise<void> {
    const dueEntries = this.deps.schedulerRepository.listDueEntries(now.toISOString());
    for (const entry of dueEntries) {
      if (this.inFlightEntryIds.has(entry.id)) {
        continue;
      }

      // Re-verify that the entry is still scheduled and due before proceeding.
      // This prevents running entries that were paused or modified during the current tick.
      const freshEntry = this.deps.schedulerRepository.getEntry(entry.id);
      if (!freshEntry || freshEntry.status !== "scheduled" || !freshEntry.nextRunAt || new Date(freshEntry.nextRunAt).getTime() > now.getTime()) {
        continue;
      }

      this.inFlightEntryIds.add(entry.id);
      
      const occurrenceIso = entry.nextRunAt ?? entry.scheduledFor;
      const nextRunAt = computeNextRunAfterOccurrence(occurrenceIso, entry.recurrence, entry.runCount + 1);
      
      // Immediately mark as succeeded to prevent double firing if app restarts during execution
      this.deps.schedulerRepository.markRunSucceeded(entry.id, occurrenceIso, nextRunAt);

      this.executeEntry(entry).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger.error("Scheduled entry execution failed", {
          entryId: entry.id,
          projectId: entry.projectId,
          targetType: entry.targetType,
          error: message,
        });
        this.deps.schedulerRepository.markRunFailed(entry.id, message);
      }).finally(() => {
        this.inFlightEntryIds.delete(entry.id);
      });
    }
  }

  private async executeEntry(entry: SchedulerEntryRecord): Promise<void> {
    if (entry.targetType === "sprint") {
      const sprintId = entry.sprintTarget?.sprintId;
      if (!sprintId) {
        throw new Error("Scheduled sprint target is missing.");
      }
      await this.deps.executionControlService.orchestrateSprint(entry.projectId, sprintId);
      return;
    }

    if (entry.targetType === "quicksprint") {
      const target = entry.quicksprintTarget;
      if (!target) {
        throw new Error("Scheduled quicksprint target is missing.");
      }
      await this.deps.quicksprintService.executeQuicksprint(entry.projectId, target);
      return;
    }

    if (entry.targetType === "memory_remediation") {
      if (!this.deps.memoryRemediationService) {
        throw new Error("Memory remediation service is not enabled.");
      }
      const project = this.deps.projectManagementRepository.getProject(entry.projectId);
      if (!project) {
        throw new Error("Scheduled memory remediation project is missing.");
      }
      await this.deps.memoryRemediationService.remediateLongTermMemories({
        projectId: entry.projectId,
        repoPath: project.baseDir,
        mode: entry.memoryRemediationTarget?.mode ?? "deterministic",
      });
      return;
    }

    const target = entry.chatTarget;
    if (!target) {
      throw new Error("Scheduled chat target is missing.");
    }
    const input: CreateDashboardConversationMessageInput = {
      threadId: target.threadId || undefined,
      title: target.title || entry.title,
      connectionId: target.connectionId || undefined,
      bodyMarkdown: target.bodyMarkdown,
      metadata: {
        source: "scheduler",
        schedulerEntryId: entry.id,
        scheduledFor: entry.nextRunAt ?? entry.scheduledFor,
      },
    };
    await this.deps.chatThreadRuntimeService.postMessage(entry.projectId, input);
  }

  private validateInputTarget(projectId: string, input: CreateSchedulerEntryInput): void {
    if (input.targetType !== "sprint") {
      return;
    }
    const sprintId = input.sprintTarget?.sprintId;
    if (!sprintId) {
      return;
    }
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error("Only sprints in the selected project can be scheduled.");
    }
    if (sprint.status === "completed") {
      throw new Error("Completed sprints cannot be scheduled.");
    }
  }

  private findSettingsManagedMemoryRemediationEntry(projectId: string): SchedulerEntryRecord | null {
    const entries = this.deps.schedulerRepository.listEntries(projectId);
    return entries.find((entry) => (
      entry.targetType === "memory_remediation"
      && entry.memoryRemediationTarget?.source === "memory_settings"
      && entry.status !== "cancelled"
    )) ?? null;
  }
}

function normalizeScheduleStart(value?: string): string {
  if (value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const next = new Date();
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

function cadenceFromEntry(entry: SchedulerEntryRecord): MemoryRemediationScheduleResponse["cadence"] {
  if (entry.status !== "scheduled") {
    return "off";
  }
  if (entry.recurrence.frequency === "weekly") {
    return "weekly";
  }
  if (entry.recurrence.frequency === "daily") {
    return "daily";
  }
  return "off";
}
