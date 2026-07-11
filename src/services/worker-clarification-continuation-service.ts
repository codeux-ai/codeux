import type { ProviderId } from "../contracts/app-types.js";
import type {
  WorkerClarificationContinuationRequest,
  WorkerClarificationReplyResult,
} from "../contracts/worker-clarification-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";
import type { TaskRerunService } from "./task-rerun-service.js";
import type { WorkerClarificationService } from "./worker-clarification-service.js";

const LOCAL_CONTINUATION_PROVIDERS = new Set<ProviderId>([
  "gemini",
  "codex",
  "claude-code",
  "qwen-code",
  "opencode",
  "antigravity",
  "mockup-cli",
]);

export type WorkerClarificationDeliveryMode = "jules_message" | "cli_workspace" | "recorded_answer";

export interface ContinueWorkerClarificationInput {
  projectId: string;
  clarificationId: string;
  answerMarkdown: string;
  repliedByAgentId: string;
}

export interface WorkerClarificationContinuationResult extends WorkerClarificationReplyResult {
  deliveryMode: WorkerClarificationDeliveryMode;
  alreadySettled: boolean;
}

export interface WorkerClarificationContinuationServiceDependencies {
  clarificationService: WorkerClarificationService;
  taskRerunService: TaskRerunService;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  sendJulesSessionMessage: (sessionId: string, answerMarkdown: string) => Promise<void>;
  isAuthorizedProjectManager: (projectId: string, agentId: string) => boolean;
  resolveProviderConfigId?: (projectId: string, taskAgentPresetId: string | null) => string | undefined;
  now?: () => string;
}

export class WorkerClarificationContinuationService {
  private readonly now: () => string;
  private readonly inFlightReplies = new Map<string, Promise<WorkerClarificationContinuationResult>>();

  constructor(private readonly deps: WorkerClarificationContinuationServiceDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  continueReply(input: ContinueWorkerClarificationInput): Promise<WorkerClarificationContinuationResult> {
    const key = `${input.projectId}:${input.clarificationId}`;
    const inFlight = this.inFlightReplies.get(key);
    if (inFlight) return inFlight;
    const operation = this.continueReplyOnce(input).finally(() => {
      if (this.inFlightReplies.get(key) === operation) this.inFlightReplies.delete(key);
    });
    this.inFlightReplies.set(key, operation);
    return operation;
  }

  private async continueReplyOnce(input: ContinueWorkerClarificationInput): Promise<WorkerClarificationContinuationResult> {
    const current = this.deps.clarificationService.get(input.projectId, input.clarificationId);
    if (!current) {
      throw new EntityNotFoundError(`Worker clarification not found: ${input.clarificationId}`);
    }
    if (!this.deps.isAuthorizedProjectManager(current.projectId, input.repliedByAgentId)) {
      throw new ValidationError(`Agent ${input.repliedByAgentId} is not authorized to reply for project ${current.projectId}.`);
    }

    const settled = this.deps.clarificationService.getSettledReplyResult(current.projectId, current.id);
    if (settled) {
      return {
        ...settled,
        deliveryMode: this.resolveDeliveryMode(settled.continuation),
        alreadySettled: true,
      };
    }
    if (current.status !== "pending") {
      throw new ValidationError(`Clarification ${current.id} is not pending.`);
    }

    const continuation = this.deps.clarificationService.prepareReply(current.projectId, current.id, {
      answerMarkdown: input.answerMarkdown,
      repliedByAgentId: input.repliedByAgentId,
    });
    const deliveryMode = await this.deliver(continuation);
    const reply = this.deps.clarificationService.completeReply(continuation);
    return { ...reply, deliveryMode, alreadySettled: false };
  }

  private async deliver(continuation: WorkerClarificationContinuationRequest): Promise<WorkerClarificationDeliveryMode> {
    if (!continuation.taskId) {
      return "recorded_answer";
    }
    if (!continuation.taskRunId) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no task-run session to continue.`);
    }
    const taskRun = this.deps.executionRepository.getTaskRun(continuation.taskRunId);
    if (!taskRun || taskRun.projectId !== continuation.projectId || taskRun.taskId !== continuation.taskId) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} task-run scope is no longer valid.`);
    }
    const sessionId = continuation.sessionId || taskRun.sessionId;
    if (!sessionId) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no provider session to continue.`);
    }

    if (taskRun.provider === "jules") {
      await this.deps.sendJulesSessionMessage(sessionId, continuation.answerMarkdown);
      this.markJulesContinuationRunning(continuation, taskRun.id);
      this.appendDeliveryEvent(continuation, "jules_message", taskRun.provider, sessionId);
      return "jules_message";
    }

    const provider = taskRun.provider as ProviderId | null;
    if (!provider || !LOCAL_CONTINUATION_PROVIDERS.has(provider)) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no supported provider session to continue.`);
    }
    const workspace = this.deps.executionRepository.getLatestTaskWorkspaceResumeTarget(
      continuation.taskId,
      continuation.sprintRunId ?? undefined,
    );
    const resumeWorkspaceSessionId = workspace?.sessionId || sessionId;
    const resumeWorkerBranch = workspace?.workerBranch || taskRun.workerBranch;
    if (!workspace || !resumeWorkspaceSessionId || !resumeWorkerBranch) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no preserved CLI workspace to continue.`);
    }
    if (workspace.provider && workspace.provider !== provider) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} preserved workspace provider does not match its task run.`);
    }

    const task = this.deps.projectManagementRepository.getTask(continuation.taskId);
    if (!task || task.projectId !== continuation.projectId) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} task scope is no longer valid.`);
    }
    const invocation = this.deps.executionRepository.getLatestProviderInvocationUsageBySession(
      resumeWorkspaceSessionId,
      "task_coding",
    );
    await this.deps.taskRerunService.continueTaskFromClarification(continuation.taskId, {
      answerMarkdown: continuation.answerMarkdown,
      provider,
      model: invocation?.model || task.model || undefined,
      providerConfigId: this.deps.resolveProviderConfigId?.(continuation.projectId, task.agentPresetId) ?? undefined,
      resumeWorkspaceSessionId,
      resumeWorkerBranch,
    });
    this.appendDeliveryEvent(continuation, "cli_workspace", provider, resumeWorkspaceSessionId);
    return "cli_workspace";
  }

  private markJulesContinuationRunning(
    continuation: WorkerClarificationContinuationRequest,
    taskRunId: string,
  ): void {
    const acceptedAt = this.now();
    this.deps.executionRepository.updateTaskRun(taskRunId, {
      state: "RUNNING",
      finishedAt: null,
      durationMs: null,
    });
    if (continuation.dispatchId) {
      this.deps.executionRepository.updateTaskDispatch(continuation.dispatchId, {
        status: "running",
        finishedAt: null,
        lastHeartbeatAt: acceptedAt,
        errorMessage: null,
      });
    }
    if (continuation.taskId) {
      this.deps.projectManagementRepository.updateTask(continuation.taskId, { status: "in_progress" });
    }
  }

  private appendDeliveryEvent(
    continuation: WorkerClarificationContinuationRequest,
    deliveryMode: Exclude<WorkerClarificationDeliveryMode, "recorded_answer">,
    provider: string,
    sessionId: string,
  ): void {
    if (!continuation.taskRunId) return;
    this.deps.executionRepository.appendTaskRunEvent(
      continuation.taskRunId,
      "worker_clarification_continued",
      continuation.repliedByAgentId,
      {
        clarificationId: continuation.clarificationId,
        projectId: continuation.projectId,
        sprintId: continuation.sprintId,
        taskId: continuation.taskId,
        sprintRunId: continuation.sprintRunId,
        dispatchId: continuation.dispatchId,
        taskRunId: continuation.taskRunId,
        sessionId,
        provider,
        deliveryMode,
      },
      { sourceEventKey: `worker-clarification:${continuation.clarificationId}:continued` },
    );
  }

  private resolveDeliveryMode(continuation: WorkerClarificationContinuationRequest): WorkerClarificationDeliveryMode {
    if (!continuation.taskId) return "recorded_answer";
    const taskRun = continuation.taskRunId
      ? this.deps.executionRepository.getTaskRun(continuation.taskRunId)
      : null;
    return taskRun?.provider === "jules" ? "jules_message" : "cli_workspace";
  }
}
