import type {
  CreateSchedulerEntryInput,
  MemoryRemediationScheduleResponse,
  MemoryRemediationScheduleSettings,
  ScheduleAnchor,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  UpdateSchedulerEntryInput,
} from "../contracts/scheduler-types.js";
import type { Logger } from "../shared/logging/logger.js";
import { SchedulerRepository } from "../repositories/scheduler-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SprintRunRecord, TaskDispatchRecord, TaskRunRecord } from "../contracts/execution-types.js";
import type { QuicksprintService } from "./quicksprint-service.js";
import type { ChatThreadRuntimeService } from "./chat-thread-runtime-service.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { MemoryRemediationService } from "./memory-remediation-service.js";
import type { TaskRerunService } from "./task-rerun-service.js";
import type { NodeFlowRuntimeService } from "./node-flow-runtime-service.js";
import type { NodeFlowRepository } from "../repositories/node-flow-repository.js";
import type { NodeFlowRunSummaryResponse } from "../contracts/node-flow-types.js";
import { buildSchedulerOccurrences, computeNextRunAfterOccurrence } from "../domain/scheduler/schedule-time.js";
import type { ConversationMessageMetadata, CreateDashboardConversationMessageInput } from "../contracts/connection-chat-types.js";

export interface SchedulerServiceDeps {
  schedulerRepository: SchedulerRepository;
  projectManagementRepository: ProjectManagementRepository;
  executionRepository?: {
    listSprintRuns(projectId: string, sprintId?: string): SprintRunRecord[];
    getLatestTaskRun?(taskId: string): TaskRunRecord | null;
    listTaskDispatches?(args: { projectId: string; sprintId?: string; sprintRunId?: string; taskId?: string }): TaskDispatchRecord[];
  };
  quicksprintService: QuicksprintService;
  chatThreadRuntimeService: ChatThreadRuntimeService;
  executionControlService: ExecutionControlService;
  taskRerunService?: TaskRerunService;
  memoryRemediationService?: MemoryRemediationService;
  nodeFlowRuntimeService?: NodeFlowRuntimeService;
  nodeFlowRepository?: Pick<NodeFlowRepository, "getFlow">;
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
    void this.runDueEntries().catch((error) => {
      this.deps.logger.error("Scheduler run-due tick failed", { error });
    });
    this.timer = setInterval(() => {
      void this.runDueEntries().catch((error) => {
        this.deps.logger.error("Scheduler run-due tick failed", { error });
      });
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
      occurrences: buildSchedulerOccurrences(
        entries,
        fromIso,
        toIso,
        new Date().toISOString(),
        (entry) => this.resolveAnchorOccurrenceStart(entry),
      ),
      from: new Date(fromIso).toISOString(),
      to: new Date(toIso).toISOString(),
    };
  }

  createEntry(projectId: string, input: CreateSchedulerEntryInput): SchedulerEntryRecord {
    this.validateInputTarget(projectId, input);
    this.validateScheduleAnchor(projectId, input);
    return this.deps.schedulerRepository.createEntry(projectId, input);
  }

  getEntry(entryId: string): SchedulerEntryRecord | null {
    return this.deps.schedulerRepository.getEntry(entryId);
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
      targetType: input.targetType ?? current.targetType,
      scheduledFor: input.scheduledFor ?? current.scheduledFor,
      scheduleAnchor: input.scheduleAnchor === undefined ? current.scheduleAnchor : input.scheduleAnchor,
      sprintTarget: input.sprintTarget ?? current.sprintTarget,
      quicksprintTarget: input.quicksprintTarget ?? current.quicksprintTarget,
      chatTarget: input.chatTarget ?? current.chatTarget,
      agentWakeupTarget: input.agentWakeupTarget ?? current.agentWakeupTarget,
      taskTarget: input.taskTarget ?? current.taskTarget,
      memoryRemediationTarget: input.memoryRemediationTarget ?? current.memoryRemediationTarget,
      nodeFlowTarget: input.nodeFlowTarget ?? current.nodeFlowTarget,
    });
    this.validateScheduleAnchor(current.projectId, {
      targetType: input.targetType ?? current.targetType,
      scheduledFor: input.scheduledFor ?? current.scheduledFor,
      scheduleAnchor: input.scheduleAnchor === undefined ? current.scheduleAnchor : input.scheduleAnchor,
      sprintTarget: input.sprintTarget ?? current.sprintTarget,
      quicksprintTarget: input.quicksprintTarget ?? current.quicksprintTarget,
      chatTarget: input.chatTarget ?? current.chatTarget,
      agentWakeupTarget: input.agentWakeupTarget ?? current.agentWakeupTarget,
      taskTarget: input.taskTarget ?? current.taskTarget,
      memoryRemediationTarget: input.memoryRemediationTarget ?? current.memoryRemediationTarget,
      nodeFlowTarget: input.nodeFlowTarget ?? current.nodeFlowTarget,
      recurrence: input.recurrence ? { ...current.recurrence, ...input.recurrence } : current.recurrence,
    });
    return this.deps.schedulerRepository.updateEntry(entryId, input);
  }

  deleteEntry(entryId: string): void {
    this.deps.schedulerRepository.deleteEntry(entryId);
  }

  async runDueEntries(now = new Date()): Promise<void> {
    const dueEntries = [
      ...this.deps.schedulerRepository.listDueEntries(now.toISOString()),
      ...this.listDueAnchoredEntries(now),
    ];
    for (const entry of dueEntries) {
      if (this.inFlightEntryIds.has(entry.id)) {
        continue;
      }

      // Re-verify that the entry is still scheduled and due before proceeding.
      // This prevents running entries that were paused or modified during the current tick.
      const freshEntry = this.deps.schedulerRepository.getEntry(entry.id);
      const occurrenceIso = this.resolveDueOccurrence(freshEntry, now);
      if (!freshEntry || freshEntry.status !== "scheduled" || !occurrenceIso) {
        continue;
      }

      this.inFlightEntryIds.add(entry.id);
      
      const nextRunAt = freshEntry.scheduleAnchor
        ? null
        : computeNextRunAfterOccurrence(occurrenceIso, freshEntry.recurrence, freshEntry.runCount + 1);

      if (freshEntry.targetType === "node_flow") {
        const claimedEntry = this.claimDueOccurrence(freshEntry, occurrenceIso, nextRunAt);
        if (!claimedEntry) {
          this.inFlightEntryIds.delete(entry.id);
          continue;
        }

        this.executeNodeFlowEntry(claimedEntry, occurrenceIso).then((result) => {
          if (result.run.status === "succeeded") {
            this.deps.schedulerRepository.markRunSucceeded(claimedEntry.id, occurrenceIso, nextRunAt);
            return;
          }
          this.deps.schedulerRepository.markRunFailed(
            claimedEntry.id,
            result.run.errorMessage ?? `Node flow run ${result.run.status}.`,
            occurrenceIso,
          );
        }).catch((error) => {
          this.handleExecutionFailure(claimedEntry, error);
        }).finally(() => {
          this.inFlightEntryIds.delete(entry.id);
        });
        continue;
      }

      // Existing scheduler targets are advanced before dispatch so an app restart does not double-fire them.
      this.deps.schedulerRepository.markRunSucceeded(freshEntry.id, occurrenceIso, nextRunAt);

      this.executeEntry(freshEntry, occurrenceIso).catch((error) => {
        this.handleExecutionFailure(freshEntry, error);
      }).finally(() => {
        this.inFlightEntryIds.delete(entry.id);
      });
    }
  }

  private handleExecutionFailure(entry: SchedulerEntryRecord, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.logger.error("Scheduled entry execution failed", {
      entryId: entry.id,
      projectId: entry.projectId,
      targetType: entry.targetType,
      error: message,
    });
    this.deps.schedulerRepository.markRunFailed(entry.id, message);
  }

  private claimDueOccurrence(
    entry: SchedulerEntryRecord,
    occurrenceIso: string,
    nextRunAt: string | null,
  ): SchedulerEntryRecord | null {
    const claimDueOccurrence = this.deps.schedulerRepository.claimDueOccurrence;
    if (typeof claimDueOccurrence !== "function") {
      return entry;
    }
    return claimDueOccurrence.call(this.deps.schedulerRepository, entry.id, occurrenceIso, nextRunAt);
  }

  private async executeEntry(entry: SchedulerEntryRecord, occurrenceIso: string): Promise<void> {
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

    if (entry.targetType === "task") {
      const target = entry.taskTarget;
      if (!target) {
        throw new Error("Scheduled task target is missing.");
      }
      if (!this.deps.taskRerunService) {
        throw new Error("Task rerun service is not enabled.");
      }
      await this.deps.taskRerunService.rerunTask(
        target.taskId,
        target.provider ? { provider: target.provider } : undefined,
      );
      return;
    }

    if (entry.targetType === "node_flow") {
      await this.executeNodeFlowEntry(entry, occurrenceIso);
      return;
    }

    if (entry.targetType === "agent_wakeup") {
      const target = entry.agentWakeupTarget;
      if (!target) {
        throw new Error("Scheduled agent wakeup target is missing.");
      }
      const metadata: ConversationMessageMetadata = {
        source: "agent_scheduler",
        origin: "agent_scheduler",
        schedulerEntryId: entry.id,
        scheduledFor: entry.nextRunAt ?? entry.scheduledFor,
      };
      if (target.createdByAgentId) {
        metadata.createdByAgentId = target.createdByAgentId;
      }
      const input: CreateDashboardConversationMessageInput = {
        threadId: target.threadId || undefined,
        title: target.title || entry.title,
        connectionId: target.connectionId || undefined,
        bodyMarkdown: target.bodyMarkdown,
        metadata,
      };
      await this.deps.chatThreadRuntimeService.postMessage(entry.projectId, input);
      return;
    }

    if (entry.targetType === "chat") {
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
      return;
    }

    const exhaustive: never = entry.targetType;
    throw new Error(`Unsupported scheduler target type: ${exhaustive}`);
  }

  private async executeNodeFlowEntry(entry: SchedulerEntryRecord, occurrenceIso: string): Promise<NodeFlowRunSummaryResponse> {
    if (entry.targetType !== "node_flow") {
      throw new Error(`Unsupported node flow scheduler target type: ${entry.targetType}`);
    }
    const target = entry.nodeFlowTarget;
    if (!target) {
      throw new Error("Scheduled node flow target is missing.");
    }
    if (!this.deps.nodeFlowRuntimeService) {
      throw new Error("Node flow runtime service is not enabled.");
    }
    this.validateNodeFlowTargetOwnership(entry.projectId, target.flowId);
    return await this.deps.nodeFlowRuntimeService.runFlow(
      entry.projectId,
      target.flowId,
      target.input ?? {},
      {
        triggerType: "scheduler",
        triggerPayload: {
          schedulerEntryId: entry.id,
          scheduledFor: occurrenceIso,
          targetType: entry.targetType,
          ...(target.flowVersion !== undefined ? { flowVersion: target.flowVersion } : {}),
        },
      },
    );
  }

  private validateInputTarget(projectId: string, input: CreateSchedulerEntryInput | UpdateSchedulerEntryInput): void {
    if (input.targetType === "agent_wakeup") {
      const bodyMarkdown = input.agentWakeupTarget?.bodyMarkdown?.trim();
      if (!bodyMarkdown) {
        throw new Error("agentWakeupTarget.bodyMarkdown is required.");
      }
      return;
    }

    if (input.targetType === "task") {
      const taskId = input.taskTarget?.taskId?.trim();
      if (!taskId) {
        throw new Error("taskTarget.taskId is required.");
      }
      const task = this.deps.projectManagementRepository.getTask(taskId);
      if (!task || task.projectId !== projectId) {
        throw new Error("Only tasks in the selected project can be scheduled.");
      }
      return;
    }

    if (input.targetType === "node_flow") {
      const flowId = input.nodeFlowTarget?.flowId?.trim();
      if (!flowId) {
        throw new Error("nodeFlowTarget.flowId is required.");
      }
      this.validateNodeFlowTargetOwnership(projectId, flowId);
      return;
    }

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

  private validateNodeFlowTargetOwnership(projectId: string, flowId: string): void {
    if (!this.deps.nodeFlowRepository) {
      throw new Error("Node flow repository is not enabled.");
    }
    const flow = this.deps.nodeFlowRepository.getFlow(flowId);
    if (!flow || flow.projectId !== projectId) {
      throw new Error("Only node flows in the selected project can be scheduled.");
    }
  }

  private validateScheduleAnchor(projectId: string, input: CreateSchedulerEntryInput | UpdateSchedulerEntryInput): void {
    const anchor = input.scheduleAnchor ?? undefined;
    if (!anchor) {
      return;
    }
    if (anchor.mode !== "after_sprint_end" && anchor.mode !== "after_task_end") {
      throw new Error("scheduleAnchor.mode must be after_sprint_end or after_task_end.");
    }
    const offsetMinutes = Number(anchor.offsetMinutes ?? 0);
    if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0) {
      throw new Error("scheduleAnchor.offsetMinutes must be a non-negative number.");
    }
    if (anchor.mode === "after_task_end") {
      const sourceTaskId = anchor.sourceTaskId?.trim();
      if (!sourceTaskId) {
        throw new Error("scheduleAnchor.sourceTaskId is required.");
      }
      const sourceTask = this.deps.projectManagementRepository.getTask(sourceTaskId);
      if (!sourceTask || sourceTask.projectId !== projectId) {
        throw new Error("Schedule anchors must reference a task in the selected project.");
      }
    } else {
      const sourceSprintId = anchor.sourceSprintId?.trim();
      if (!sourceSprintId) {
        throw new Error("scheduleAnchor.sourceSprintId is required.");
      }
      const sourceSprint = this.deps.projectManagementRepository.getSprint(sourceSprintId);
      if (!sourceSprint || sourceSprint.projectId !== projectId) {
        throw new Error("Schedule anchors must reference a sprint in the selected project.");
      }
      if (input.targetType === "sprint" && input.sprintTarget?.sprintId === sourceSprintId) {
        throw new Error("A scheduled sprint cannot be anchored to its own completion.");
      }
    }
    if (input.recurrence && input.recurrence.frequency && input.recurrence.frequency !== "none") {
      throw new Error("Scheduler anchors do not support recurrence.");
    }
  }

  private listDueAnchoredEntries(now: Date): SchedulerEntryRecord[] {
    const listAnchored = this.deps.schedulerRepository.listScheduledAnchoredEntries;
    if (typeof listAnchored !== "function") {
      return [];
    }
    return listAnchored.call(this.deps.schedulerRepository, 25)
      .filter((entry) => Boolean(this.resolveDueOccurrence(entry, now)));
  }

  private resolveDueOccurrence(entry: SchedulerEntryRecord | null, now: Date): string | null {
    if (!entry || entry.status !== "scheduled") {
      return null;
    }
    if (!entry.scheduleAnchor) {
      if (!entry.nextRunAt) {
        return null;
      }
      return new Date(entry.nextRunAt).getTime() <= now.getTime() ? entry.nextRunAt : null;
    }
    const anchorTime = this.resolveAnchorCompletionTime(entry.projectId, entry.scheduleAnchor);
    if (!anchorTime) {
      return null;
    }
    const dueAt = new Date(anchorTime.getTime() + ((entry.scheduleAnchor.offsetMinutes ?? 0) * 60_000));
    const dueIso = dueAt.toISOString();
    if (entry.lastRunAt === dueIso) {
      return null;
    }
    return dueAt.getTime() <= now.getTime() ? dueIso : null;
  }

  private resolveAnchorOccurrenceStart(entry: SchedulerEntryRecord): string | null {
    if (!entry.scheduleAnchor) {
      return entry.scheduledFor;
    }
    const anchorTime = this.resolveAnchorCompletionTime(entry.projectId, entry.scheduleAnchor);
    if (!anchorTime) {
      return null;
    }
    return new Date(anchorTime.getTime() + ((entry.scheduleAnchor.offsetMinutes ?? 0) * 60_000)).toISOString();
  }

  private resolveAnchorCompletionTime(projectId: string, anchor: ScheduleAnchor): Date | null {
    if (anchor.mode === "after_task_end") {
      return this.resolveAnchorTaskEndTime(projectId, anchor.sourceTaskId);
    }
    return this.resolveAnchorSprintEndTime(projectId, anchor);
  }

  private resolveAnchorSprintEndTime(projectId: string, anchor: ScheduleAnchor): Date | null {
    if (anchor.mode !== "after_sprint_end") {
      return null;
    }
    const sprint = this.deps.projectManagementRepository.getSprint(anchor.sourceSprintId);
    if (!sprint || sprint.projectId !== projectId || !isSuccessfulSprintStatus(sprint.status)) {
      return null;
    }

    const latestRunFinishedAt = this.deps.executionRepository
      ? latestSuccessfulRunFinishedAt(this.deps.executionRepository.listSprintRuns(projectId, anchor.sourceSprintId))
      : null;
    if (latestRunFinishedAt) {
      return latestRunFinishedAt;
    }

    if (!sprint.endDate) {
      return null;
    }
    const parsed = new Date(sprint.endDate);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private resolveAnchorTaskEndTime(projectId: string, taskId: string): Date | null {
    const task = this.deps.projectManagementRepository.getTask(taskId);
    if (!task || task.projectId !== projectId || !isTerminalProjectTaskStatus(task.status)) {
      return null;
    }

    const latestRunFinishedAt = this.latestTerminalTaskRunFinishedAt(taskId);
    if (latestRunFinishedAt) {
      return latestRunFinishedAt;
    }

    const latestDispatchFinishedAt = this.latestTerminalTaskDispatchFinishedAt(projectId, taskId);
    if (latestDispatchFinishedAt) {
      return latestDispatchFinishedAt;
    }

    const parsed = new Date(task.updatedAt);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private latestTerminalTaskRunFinishedAt(taskId: string): Date | null {
    const run = this.deps.executionRepository?.getLatestTaskRun?.(taskId) ?? null;
    if (!run || !isTerminalTaskRunState(run.state) || !run.finishedAt) {
      return null;
    }
    const parsed = new Date(run.finishedAt);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private latestTerminalTaskDispatchFinishedAt(projectId: string, taskId: string): Date | null {
    const dispatches = this.deps.executionRepository?.listTaskDispatches?.({ projectId, taskId }) ?? [];
    let latest: Date | null = null;
    for (const dispatch of dispatches) {
      if (!isTerminalTaskDispatchStatus(dispatch.status) || !dispatch.finishedAt) {
        continue;
      }
      const finishedAt = new Date(dispatch.finishedAt);
      if (!Number.isFinite(finishedAt.getTime())) {
        continue;
      }
      if (!latest || finishedAt.getTime() > latest.getTime()) {
        latest = finishedAt;
      }
    }
    return latest;
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

function isSuccessfulSprintStatus(status: string): boolean {
  return status === "completed";
}

function isTerminalProjectTaskStatus(status: string): boolean {
  return status === "completed" || status === "QA_REVIEW_FAILED";
}

function latestSuccessfulRunFinishedAt(runs: SprintRunRecord[]): Date | null {
  let latest: Date | null = null;
  for (const run of runs) {
    if (!isSuccessfulSprintStatus(run.status) || !run.finishedAt) {
      continue;
    }
    const finishedAt = new Date(run.finishedAt);
    if (!Number.isFinite(finishedAt.getTime())) {
      continue;
    }
    if (!latest || finishedAt.getTime() > latest.getTime()) {
      latest = finishedAt;
    }
  }
  return latest;
}

function isTerminalTaskRunState(state: TaskRunRecord["state"]): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "BLOCKED" || state === "QUOTA";
}

function isTerminalTaskDispatchStatus(status: TaskDispatchRecord["status"]): boolean {
  return status === "completed"
    || status === "failed"
    || status === "cancelled"
    || status === "blocked"
    || status === "quota";
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
