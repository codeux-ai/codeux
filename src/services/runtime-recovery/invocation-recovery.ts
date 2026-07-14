import type { ExecutionInvocationRecord, ProviderInvocationUsageRecord, TaskRunRecord } from "../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { SessionTrackingRepository } from "../../repositories/session-tracking-repository.js";
import { calculateInvocationDurationMs, isTerminalTaskRunState } from "./recovery-utils.js";
import { failStaleProviderInvocation } from "../../domain/runtime/provider-invocation-recovery.js";

const QA_RUN_START_TIMEOUT_MS = 60_000;
const TASK_CODING_INVOCATION_TYPES = ["task_coding", "cli_task_coding", "cli_task_followup"] as const;
const STRUCTURED_INVOCATION_TYPES = ["planning", "qa_review"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;

interface InvocationRecoveryServiceDeps {
  executionRepository: ExecutionRepository;
  sessionTracking: SessionTrackingRepository;
  projectManagementRepository: ProjectManagementRepository;
}

export class InvocationRecoveryService {
  constructor(private readonly deps: InvocationRecoveryServiceDeps) {}

  reconcileTerminalProviderLinkedInvocations(): string[] {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listActiveExecutionInvocations?: () => ExecutionInvocationRecord[];
    };
    if (typeof executionRepository.listActiveExecutionInvocations !== "function") {
      return [];
    }

    const invocations = executionRepository.listActiveExecutionInvocations();
    if (invocations.length === 0) {
      return [];
    }

    const reconciledInvocationIds: string[] = [];
    for (const invocation of invocations) {
      if (this.isTypeSpecificStartupInvocation(invocation.type)) {
        continue;
      }
      if (!invocation.providerInvocationId) {
        const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
        const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;
        if (ageMs < QA_RUN_START_TIMEOUT_MS) {
          continue;
        }
        const finishedAt = new Date().toISOString();
        const message = `Recovered stale ${invocation.type} invocation after it stayed running without provider runtime linkage.`;
        this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
          status: "cancelled",
          finishedAt,
          errorMessage: null,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
          role: "system",
          contentMarkdown: message,
          metadata: {
            recovery: "startup_terminal_provider_invocation_reconcile",
            providerInvocationId: null,
          },
          createdAt: finishedAt,
        });
        reconciledInvocationIds.push(invocation.id);
        continue;
      }
      const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
      if (!providerInvocation || providerInvocation.status === "running") {
        continue;
      }

      const finishedAt = providerInvocation.finishedAt || new Date().toISOString();
      const status = this.mapTerminalProviderStatus(providerInvocation.status);
      const message = `Recovered stale ${invocation.type} invocation after the backing provider invocation ${providerInvocation.status}.`;
      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status,
        finishedAt,
        errorMessage: status === "failed" ? message : null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: message,
        metadata: {
          recovery: "startup_terminal_provider_invocation_reconcile",
          providerInvocationId: providerInvocation.id,
          providerStatus: providerInvocation.status,
        },
        createdAt: finishedAt,
      });

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private isTypeSpecificStartupInvocation(type: string): boolean {
    return TASK_CODING_INVOCATION_TYPES.includes(type as (typeof TASK_CODING_INVOCATION_TYPES)[number])
      || STRUCTURED_INVOCATION_TYPES.includes(type as (typeof STRUCTURED_INVOCATION_TYPES)[number]);
  }

  async reconcileInterruptedStructuredInvocations(activeContainerSessionIds: ReadonlySet<string>): Promise<string[]> {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listActiveExecutionInvocationsByTypes?: (types: string[]) => ExecutionInvocationRecord[];
    };
    if (typeof executionRepository.listActiveExecutionInvocationsByTypes !== "function") {
      return [];
    }

    const invocations = executionRepository.listActiveExecutionInvocationsByTypes(["planning", "qa_review"]);
    if (invocations.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledInvocationIds: string[] = [];

    for (const invocation of invocations) {
      const resolution = this.resolveInterruptedStructuredInvocation(invocation, activeContainerSessionIds);
      if (!resolution) {
        continue;
      }

      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: resolution.status,
        finishedAt: reconciledAt,
        errorMessage: resolution.status === "failed" ? resolution.message : null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: resolution.message,
        metadata: {
          recovery: "startup_structured_invocation_reconcile",
          provider: invocation.provider,
        },
        createdAt: reconciledAt,
      });

      const providerInvocation = invocation.providerInvocationId
        ? this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId)
        : null;
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: resolution.status,
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  async reconcileInterruptedTaskCodingInvocations(activeContainerSessionIds: ReadonlySet<string>): Promise<string[]> {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listActiveExecutionInvocationsByTypes?: (types: string[]) => ExecutionInvocationRecord[];
    };
    if (typeof executionRepository.listActiveExecutionInvocationsByTypes !== "function") {
      return [];
    }

    const invocations = executionRepository.listActiveExecutionInvocationsByTypes([...TASK_CODING_INVOCATION_TYPES]);
    if (invocations.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledInvocationIds: string[] = [];

    for (const invocation of invocations) {
      const resolution = this.resolveInterruptedTaskCodingInvocation(invocation, activeContainerSessionIds);
      if (!resolution) {
        continue;
      }

      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: resolution.status,
        finishedAt: reconciledAt,
        errorMessage: resolution.status === "failed" ? resolution.message : null,
        lastErrorCategory: resolution.status === "failed" ? invocation.lastErrorCategory ?? "UNKNOWN" : null,
        lastErrorMessage: resolution.status === "failed" ? resolution.message : null,
        lastRetryAfterIso: null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: resolution.message,
        metadata: {
          recovery: "startup_task_coding_invocation_reconcile",
          provider: invocation.provider,
          taskRunId: invocation.taskRunId || null,
        },
        createdAt: reconciledAt,
      });

      const providerInvocation = invocation.providerInvocationId
        ? this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId)
        : null;
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: resolution.status,
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }
      if (providerInvocation?.sessionId) {
        this.deps.sessionTracking.updateSession(providerInvocation.sessionId, {
          state: this.mapInvocationStatusToSessionState(resolution.status),
        });
        this.deps.sessionTracking.appendActivity(providerInvocation.sessionId, {
          originator: "system",
          description: resolution.message,
        });
      }

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private resolveInterruptedTaskCodingInvocation(
    invocation: ExecutionInvocationRecord,
    activeContainerSessionIds: ReadonlySet<string>,
  ): { status: "completed" | "failed" | "cancelled"; message: string } | null {
    const taskRun = invocation.taskRunId ? this.deps.executionRepository.getTaskRun(invocation.taskRunId) : null;
    if (taskRun && isTerminalTaskRunState(taskRun)) {
      return {
        status: taskRun.state === "COMPLETED" ? "completed" : "failed",
        message: `Recovered stale task coding invocation after the linked task run was already ${taskRun.state}.`,
      };
    }

    const sprintRun = invocation.sprintRunId ? this.deps.executionRepository.getSprintRun(invocation.sprintRunId) : null;
    if (sprintRun && ["completed", "failed", "cancelled"].includes(sprintRun.status)) {
      return {
        status: sprintRun.status === "cancelled" ? "cancelled" : "failed",
        message: `Recovered stale task coding invocation after the linked sprint run was already ${sprintRun.status}.`,
      };
    }

    const dispatch = invocation.dispatchId ? this.deps.executionRepository.getTaskDispatch(invocation.dispatchId) : null;
    if (
      dispatch
      && dispatch.status !== "paused"
      && !ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])
    ) {
      return {
        status: dispatch.status === "completed"
          ? "completed"
          : dispatch.status === "cancelled" ? "cancelled" : "failed",
        message: `Recovered stale task coding invocation after the linked task dispatch was already ${dispatch.status}.`,
      };
    }

    const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;

    if (!invocation.providerInvocationId) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return {
        status: "failed",
        message: "Recovered stale task coding invocation after it stayed running without provider runtime linkage.",
      };
    }

    const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return {
        status: "failed",
        message: "Recovered stale task coding invocation after the backing provider invocation disappeared.",
      };
    }

    if (providerInvocation.status !== "running") {
      return {
        status: providerInvocation.status === "completed"
          ? "completed"
          : providerInvocation.status === "cancelled" ? "cancelled" : "failed",
        message: `Recovered stale task coding invocation after the backing provider invocation ${providerInvocation.status}.`,
      };
    }

    const providerResolution = this.resolveOrphanedTaskCodingProviderInvocation(providerInvocation);
    if (providerResolution) {
      return providerResolution;
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return {
        status: "cancelled",
        message: `Recovered stale task coding invocation after its Docker container disappeared for session ${providerInvocation.sessionId}.`,
      };
    }

    return null;
  }

  private mapTerminalProviderStatus(status: ProviderInvocationUsageRecord["status"]): "completed" | "failed" | "cancelled" {
    if (status === "completed") {
      return "completed";
    }
    if (status === "cancelled") {
      return "cancelled";
    }
    return "failed";
  }

  reconcileOrphanedTaskCodingProviderInvocations(): string[] {
    const runningProviders = this.deps.executionRepository.listRunningProviderInvocationUsages()
      .filter((invocation) => invocation.purpose === "task_coding");
    if (runningProviders.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledProviderIds: string[] = [];

    for (const providerInvocation of runningProviders) {
      const resolution = this.resolveOrphanedTaskCodingProviderInvocation(providerInvocation);
      if (!resolution) {
        continue;
      }

      if (resolution.status === "failed") {
        const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(providerInvocation.id);
        failStaleProviderInvocation(
          this.deps.executionRepository,
          providerInvocation,
          linkedExecutionInvocations,
          {
            reconciledAt,
            recoveryReason: "startup_task_coding_provider_reconcile",
            systemMessage: resolution.message,
          }
        );
      } else {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: resolution.status,
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });

        const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(providerInvocation.id);
        for (const executionInvocation of linkedExecutionInvocations) {
          if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
            continue;
          }
          this.deps.executionRepository.updateExecutionInvocation(executionInvocation.id, {
            status: resolution.status,
            finishedAt: reconciledAt,
            errorMessage: null,
          });
        }
      }

      reconciledProviderIds.push(providerInvocation.id);
    }

    return reconciledProviderIds;
  }

  private resolveOrphanedTaskCodingProviderInvocation(
    providerInvocation: ProviderInvocationUsageRecord,
  ): { status: "completed" | "failed" | "cancelled"; message: string } | null {
    if (providerInvocation.purpose !== "task_coding" || providerInvocation.status !== "running") {
      return null;
    }
    if (providerInvocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(providerInvocation.taskRunId);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        return null;
      }
      if (taskRun?.state === "COMPLETED") {
        return {
          status: "completed",
          message: "Recovered stale task coding provider invocation after the linked task run completed.",
        };
      }
      if (taskRun?.state === "FAILED" || taskRun?.state === "BLOCKED" || taskRun?.state === "QUOTA") {
        return {
          status: "failed",
          message: `Recovered stale task coding provider invocation after the linked task run was already ${taskRun.state}.`,
        };
      }
    }

    const task = providerInvocation.taskId
      ? this.deps.projectManagementRepository.getTask(providerInvocation.taskId)
      : null;
    if (task?.status === "completed" || task?.status === "coding_completed") {
      return {
        status: "completed",
        message: `Recovered stale task coding provider invocation after the project task was already ${task.status}.`,
      };
    }
    if (task?.status === "QA_REVIEW_FAILED") {
      return {
        status: "failed",
        message: "Recovered stale task coding provider invocation after the project task was already QA_REVIEW_FAILED.",
      };
    }

    const sprintRun = providerInvocation.sprintRunId
      ? this.deps.executionRepository.getSprintRun(providerInvocation.sprintRunId)
      : null;
    if (sprintRun && ["completed", "failed", "cancelled"].includes(sprintRun.status)) {
      return {
        status: sprintRun.status === "cancelled" ? "cancelled" : "failed",
        message: `Recovered stale task coding provider invocation after the linked sprint run was already ${sprintRun.status}.`,
      };
    }

    if (providerInvocation.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(providerInvocation.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        return null;
      }
    }

    const startedAtMs = Date.parse(providerInvocation.startedAt);
    const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0;
    if (ageMs < QA_RUN_START_TIMEOUT_MS) {
      return null;
    }

    if (!providerInvocation.taskRunId && !providerInvocation.dispatchId) {
      return {
        status: "failed",
        message: "Recovered stale task coding provider invocation after it remained running without task-run or dispatch linkage.",
      };
    }

    return null;
  }

  private resolveInterruptedStructuredInvocation(
    invocation: ExecutionInvocationRecord,
    activeContainerSessionIds: ReadonlySet<string>,
  ): { status: "failed" | "cancelled"; message: string } | null {
    const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;
    const purpose = invocation.type === "qa_review" ? "QA review" : "planning";

    if (!invocation.providerInvocationId) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return {
        status: "failed",
        message: `Recovered stale ${purpose} invocation after the backing invocation stayed running without provider runtime linkage.`,
      };
    }

    const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return {
        status: "failed",
        message: `Recovered stale ${purpose} invocation after the backing provider invocation disappeared.`,
      };
    }

    if (providerInvocation.status !== "running") {
      return {
        status: providerInvocation.status === "cancelled" ? "cancelled" : "failed",
        message: `Recovered stale ${purpose} invocation after the backing provider invocation ${providerInvocation.status}.`,
      };
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return {
        status: "cancelled",
        message: `Recovered stale ${purpose} invocation after its Docker container disappeared for session ${providerInvocation.sessionId}.`,
      };
    }

    return null;
  }

  private mapInvocationStatusToSessionState(status: "completed" | "failed" | "cancelled"): string {
    if (status === "completed") {
      return "COMPLETED";
    }
    if (status === "cancelled") {
      return "CANCELLED";
    }
    return "FAILED";
  }
}
