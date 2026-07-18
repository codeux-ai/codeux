import type { ProviderId } from "../contracts/app-types.js";
import type { SprintRunStatus } from "../contracts/execution-types.js";
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

const CLARIFICATION_CONTINUATION_SPRINT_STATUSES = new Set<SprintRunStatus>(["queued", "running"]);

export const canAutomaticallyContinueClarificationSprint = (status: SprintRunStatus): boolean =>
  CLARIFICATION_CONTINUATION_SPRINT_STATUSES.has(status);

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
    const sprintRunId = continuation.sprintRunId || taskRun.sprintRunId;
    if (!sprintRunId) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no sprint run to continue.`);
    }
    const sprintRun = this.deps.executionRepository.getSprintRun(sprintRunId);
    if (
      !sprintRun
      || sprintRun.projectId !== continuation.projectId
      || sprintRun.sprintId !== continuation.sprintId
      || taskRun.sprintRunId !== sprintRun.id
    ) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} sprint-run scope is no longer valid.`);
    }
    if (!canAutomaticallyContinueClarificationSprint(sprintRun.status)) {
      throw new ValidationError(
        `Clarification ${continuation.clarificationId} cannot continue while sprint run ${sprintRun.id} is ${sprintRun.status}.`,
      );
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
    const resumeWorkspaceSessionId = workspace?.sessionId;
    const resumeWorkerBranch = workspace?.workerBranch;
    if (!workspace || !resumeWorkspaceSessionId || !resumeWorkerBranch) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no preserved CLI workspace to continue.`);
    }
    if (resumeWorkspaceSessionId !== sessionId) {
      throw new ValidationError(
        `Clarification ${continuation.clarificationId} preserved workspace session does not match its source task run.`,
      );
    }
    if (taskRun.workerBranch && resumeWorkerBranch !== taskRun.workerBranch) {
      throw new ValidationError(
        `Clarification ${continuation.clarificationId} preserved workspace branch does not match its source task run.`,
      );
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
    if (!invocation) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no prior provider invocation to resume.`);
    }
    if (provider === "claude-code" && !invocation.nativeSessionId) {
      throw new ValidationError(`Clarification ${continuation.clarificationId} has no captured Claude Code session id to resume.`);
    }
    const continuedTask = await this.deps.taskRerunService.continueTaskFromClarification(continuation.taskId, {
      clarificationId: continuation.clarificationId,
      answerMarkdown: continuation.answerMarkdown,
      provider,
      model: invocation?.model || task.model || undefined,
      providerConfigId: this.deps.resolveProviderConfigId?.(continuation.projectId, task.agentPresetId) ?? undefined,
      resumeWorkspaceSessionId,
      resumeWorkerBranch,
    });
    const continuedSessionId = continuedTask.session_id;
    const continuedTaskRun = continuedSessionId
      && typeof this.deps.executionRepository.getLatestTaskRunBySessionId === "function"
      ? this.deps.executionRepository.getLatestTaskRunBySessionId(continuedSessionId)
      : null;
    if (continuedTaskRun) {
      this.deps.executionRepository.appendTaskRunEvent(
        continuedTaskRun.id,
        "worker_clarification_continuation_started",
        continuation.repliedByAgentId,
        {
          clarificationId: continuation.clarificationId,
          attentionItemId: continuation.clarificationId,
          parentTaskRunId: continuation.taskRunId,
          parentExecutionInvocationId: continuation.executionInvocationId,
          parentWorkspaceSessionId: resumeWorkspaceSessionId,
          provider,
          workerBranch: resumeWorkerBranch,
        },
        { sourceEventKey: `worker-clarification:${continuation.clarificationId}:continuation-started` },
      );
      const continuedInvocation = this.deps.executionRepository.listExecutionInvocations({
        projectId: continuation.projectId,
        taskRunId: continuedTaskRun.id,
        limit: 1,
      })[0];
      if (continuedInvocation) {
        this.deps.executionRepository.appendExecutionInvocationMessage(continuedInvocation.id, {
          role: "system",
          contentMarkdown: `Continuing clarification ${continuation.clarificationId} in the preserved ${provider} session and workspace.`,
          metadata: {
            kind: "worker_clarification_continuation",
            clarificationId: continuation.clarificationId,
            attentionItemId: continuation.clarificationId,
            parentTaskRunId: continuation.taskRunId,
            parentExecutionInvocationId: continuation.executionInvocationId,
            workspaceSessionId: resumeWorkspaceSessionId,
          },
        });
      }
    }
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
