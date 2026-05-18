import type {
  CreateSchedulerEntryInput,
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
import { buildSchedulerOccurrences, computeNextRunAfterOccurrence } from "../domain/scheduler/schedule-time.js";
import type { CreateDashboardConversationMessageInput } from "../contracts/connection-chat-types.js";

export interface SchedulerServiceDeps {
  schedulerRepository: SchedulerRepository;
  projectManagementRepository: ProjectManagementRepository;
  quicksprintService: QuicksprintService;
  chatThreadRuntimeService: ChatThreadRuntimeService;
  executionControlService: ExecutionControlService;
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
      this.inFlightEntryIds.add(entry.id);
      try {
        await this.executeEntry(entry);
        const occurrenceIso = entry.nextRunAt ?? entry.scheduledFor;
        const nextRunAt = computeNextRunAfterOccurrence(occurrenceIso, entry.recurrence, entry.runCount + 1);
        this.deps.schedulerRepository.markRunSucceeded(entry.id, occurrenceIso, nextRunAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger.error("Scheduled entry execution failed", {
          entryId: entry.id,
          projectId: entry.projectId,
          targetType: entry.targetType,
          error: message,
        });
        this.deps.schedulerRepository.markRunFailed(entry.id, message);
      } finally {
        this.inFlightEntryIds.delete(entry.id);
      }
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
}
