import type { Subtask, SubtaskStatus } from "../contracts/app-types.js";
import type { TaskRecord } from "../contracts/project-management-types.js";
import type { WorkerClarificationRecord } from "../contracts/worker-clarification-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectAttentionRepository } from "../repositories/project-attention-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import type { GuardrailService } from "./guardrail-service.js";
import {
  canAutomaticallyContinueClarificationSprint,
  type WorkerClarificationContinuationService,
} from "./worker-clarification-continuation-service.js";
import type { WorkerClarificationService } from "./worker-clarification-service.js";
import type { WorkerInboxReplyService } from "./worker-inbox-reply-service.js";

const SOURCE_TURN_POLL_MS = 500;
const SOURCE_TURN_WAIT_MS = 15 * 60 * 1_000;

export interface WorkerClarificationCoordinatorDependencies {
  clarificationService: WorkerClarificationService;
  continuationService: WorkerClarificationContinuationService;
  workerInboxReplyService: WorkerInboxReplyService;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  projectAttentionRepository: ProjectAttentionRepository;
  guardrailService: GuardrailService;
  logger?: Logger;
  now?: () => string;
}

function toSubtaskStatus(status: TaskRecord["status"]): SubtaskStatus {
  switch (status) {
    case "in_progress":
      return "RUNNING";
    case "coding_completed":
      return "CODING_COMPLETED";
    case "completed":
      return "COMPLETED";
    case "QA_REVIEW_FAILED":
      return "QA_REVIEW_FAILED";
    default:
      return "PENDING";
  }
}

function toSubtask(task: TaskRecord): Subtask {
  return {
    record_id: task.id,
    project_id: task.projectId,
    sprint_id: task.sprintId,
    id: task.taskKey,
    title: task.title,
    prompt: task.promptMarkdown,
    depends_on: task.dependsOnTaskIds,
    status: toSubtaskStatus(task.status),
    model: task.model ?? undefined,
    agentPresetId: task.agentPresetId,
    is_independent: task.isIndependent,
    is_merged: task.isMerged,
  };
}

/**
 * Turns a durable coding-agent question into a guarded project-manager answer,
 * then resumes the preserved provider conversation. The clarification attention
 * item remains open until delivery is accepted; every failure therefore has a
 * visible human fallback.
 */
export class WorkerClarificationCoordinatorService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly now: () => string;
  private unsubscribeCreated: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly deps: WorkerClarificationCoordinatorDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  start(): void {
    if (this.unsubscribeCreated) return;
    this.stopped = false;
    this.unsubscribeCreated = this.deps.clarificationService.onCreated((clarification) => {
      this.schedule(clarification);
    });
    queueMicrotask(() => this.recoverPending());
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribeCreated?.();
    this.unsubscribeCreated = null;
  }

  schedule(clarification: WorkerClarificationRecord): void {
    const automationStatus = this.deps.projectAttentionRepository
      .getAttentionItem(clarification.id)?.payload?.automationStatus;
    if (
      this.stopped
      || clarification.status !== "pending"
      || automationStatus === "human_required"
      || this.inFlight.has(clarification.id)
    ) {
      return;
    }
    const operation = this.coordinate(clarification)
      .catch((error) => this.escalate(clarification, error))
      .finally(() => {
        if (this.inFlight.get(clarification.id) === operation) {
          this.inFlight.delete(clarification.id);
        }
      });
    this.inFlight.set(clarification.id, operation);
  }

  private recoverPending(): void {
    if (this.stopped) return;
    try {
      for (const project of this.deps.projectManagementRepository.listProjects().projects) {
        for (const clarification of this.deps.clarificationService.list(project.id, {
          statuses: ["pending"],
          limit: 200,
        })) {
          this.schedule(clarification);
        }
      }
    } catch (error) {
      this.deps.logger?.error("Failed to recover pending worker clarifications", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async coordinate(initial: WorkerClarificationRecord): Promise<void> {
    const readiness = await this.waitForSourceTurn(initial);
    if (this.stopped) return;
    const clarification = this.deps.clarificationService.get(initial.projectId, initial.id);
    if (!clarification || clarification.status !== "pending") return;

    if (readiness === "completed") {
      this.deps.clarificationService.resolve(clarification.projectId, clarification.id, {
        status: "cancelled",
        resolvedByAgentId: "clarification-coordinator",
        reason: "source_task_completed_before_clarification_delivery",
      });
      return;
    }
    if (readiness === "running") {
      throw new Error("The coding turn did not stop after requesting clarification.");
    }
    if (!clarification.taskId || !clarification.sprintId) {
      throw new Error("The clarification is not linked to a task and sprint.");
    }

    const task = this.deps.projectManagementRepository.getTask(clarification.taskId);
    const sprint = this.deps.projectManagementRepository.getSprint(clarification.sprintId);
    if (!task || task.projectId !== clarification.projectId || !sprint) {
      throw new Error("The clarification task or sprint no longer exists.");
    }
    if (!clarification.sprintRunId) {
      throw new Error("The clarification has no sprint run to continue.");
    }
    const sprintRun = this.deps.executionRepository.getSprintRun(clarification.sprintRunId);
    if (
      !sprintRun
      || sprintRun.projectId !== clarification.projectId
      || sprintRun.sprintId !== clarification.sprintId
    ) {
      throw new Error("The clarification sprint run no longer exists or is outside its project scope.");
    }
    if (!canAutomaticallyContinueClarificationSprint(sprintRun.status)) {
      throw new Error(
        `Automatic clarification is suspended while sprint run ${sprintRun.id} is ${sprintRun.status}.`,
      );
    }

    const sourceKey = `worker-clarification:${clarification.id}:project-manager`;
    const attention = this.deps.projectAttentionRepository.getAttentionItem(clarification.id);
    const alreadyRecorded = attention?.payload?.automationGuardrailSourceKey === sourceKey;
    if (!alreadyRecorded) {
      const evaluation = this.deps.guardrailService.evaluate(
        { projectId: clarification.projectId, sprintId: clarification.sprintId },
        clarification.taskId,
        "clarification_reply",
      );
      if (!evaluation.allowed) {
        this.deps.projectAttentionRepository.patchAttentionItemPayload(clarification.id, {
          automationStatus: "human_required",
          automationFailureReason: evaluation.reason ?? "Clarification reply guardrail reached.",
          automationFailedAt: this.now(),
          guardrailAction: evaluation.action,
        });
        this.appendEvent(clarification, "worker_clarification_human_required", {
          reason: evaluation.reason ?? null,
          guardrailAction: evaluation.action,
        });
        return;
      }
      this.deps.guardrailService.recordOnce(
        { projectId: clarification.projectId, sprintId: clarification.sprintId },
        clarification.taskId,
        "clarification_reply",
        sourceKey,
        "Automatic project-manager clarification reply",
      );
    }

    const codingEvaluation = this.deps.guardrailService.evaluate(
      { projectId: clarification.projectId, sprintId: clarification.sprintId },
      clarification.taskId,
      "task_coding",
    );
    if (!codingEvaluation.allowed && codingEvaluation.action !== "WARN_ONLY") {
      const reason = codingEvaluation.reason
        ?? `Coding continuation guardrail reached (${codingEvaluation.count}/${codingEvaluation.cap}).`;
      this.deps.projectAttentionRepository.patchAttentionItemPayload(clarification.id, {
        automationStatus: "human_required",
        automationFailureReason: reason,
        automationFailedAt: this.now(),
        guardrailAction: codingEvaluation.action,
        codingGuardrailAttempts: codingEvaluation.count,
        codingGuardrailCap: codingEvaluation.cap,
      });
      this.appendEvent(clarification, "worker_clarification_human_required", {
        reason,
        guardrailAction: codingEvaluation.action,
        guardrailPurpose: "task_coding",
      });
      return;
    }

    this.deps.projectAttentionRepository.patchAttentionItemPayload(clarification.id, {
      automationStatus: "generating_reply",
      automationStartedAt: this.now(),
      automationGuardrailSourceKey: sourceKey,
      automationFailureReason: null,
    });

    const taskRecords = this.deps.projectManagementRepository.listTasks(
      clarification.projectId,
      clarification.sprintId,
    );
    const reply = await this.deps.workerInboxReplyService.generateWorkerClarificationReply({
      projectId: clarification.projectId,
      sprintGoal: sprint.goal,
      subtasks: taskRecords.map(toSubtask),
      task: toSubtask(task),
      clarification,
    });
    if (this.stopped) return;

    this.deps.projectAttentionRepository.patchAttentionItemPayload(clarification.id, {
      automationStatus: "delivering_reply",
      managerExecutionInvocationId: reply.executionInvocationId,
      managerAgentPresetId: reply.agentPresetId,
      replyGeneratedAt: this.now(),
    });

    await this.deps.continuationService.continueReply({
      projectId: clarification.projectId,
      clarificationId: clarification.id,
      answerMarkdown: reply.answerMarkdown,
      repliedByAgentId: reply.agentPresetId,
    });

    this.deps.projectAttentionRepository.patchAttentionItemPayload(clarification.id, {
      automationStatus: "continued",
      continuationAcceptedAt: this.now(),
    });
  }

  private async waitForSourceTurn(
    clarification: WorkerClarificationRecord,
  ): Promise<"ready" | "completed" | "running"> {
    if (!clarification.taskRunId) return "ready";
    const deadline = Date.now() + SOURCE_TURN_WAIT_MS;
    while (!this.stopped && Date.now() < deadline) {
      const current = this.deps.executionRepository.getTaskRun(clarification.taskRunId);
      if (!current) return "ready";
      if (current.state === "COMPLETED") return "completed";
      if (current.state !== "RUNNING" && current.state !== "PENDING") return "ready";
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SOURCE_TURN_POLL_MS);
        timer.unref?.();
      });
    }
    return "running";
  }

  private escalate(clarification: WorkerClarificationRecord, error: unknown): void {
    const current = this.deps.clarificationService.get(clarification.projectId, clarification.id);
    if (!current || current.status !== "pending") return;
    const message = error instanceof Error ? error.message : String(error);
    this.deps.projectAttentionRepository.patchAttentionItemPayload(clarification.id, {
      automationStatus: "human_required",
      automationFailureReason: message,
      automationFailedAt: this.now(),
    });
    this.appendEvent(clarification, "worker_clarification_human_required", {
      reason: message,
    });
    this.deps.logger?.error("Automatic worker clarification handling failed", {
      clarificationId: clarification.id,
      projectId: clarification.projectId,
      taskId: clarification.taskId,
      error: message,
    });
  }

  private appendEvent(
    clarification: WorkerClarificationRecord,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    if (!clarification.taskRunId) return;
    this.deps.executionRepository.appendTaskRunEvent(
      clarification.taskRunId,
      eventType,
      "clarification-coordinator",
      {
        clarificationId: clarification.id,
        attentionItemId: clarification.id,
        ...payload,
      },
      { sourceEventKey: `worker-clarification:${clarification.id}:${eventType}` },
    );
  }
}
