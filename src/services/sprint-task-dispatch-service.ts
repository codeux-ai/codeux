import { randomUUID } from "node:crypto";
import type { DashboardSettings, DashboardSettingsScope, JulesSession, ProviderId, Subtask } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, TaskDispatchExecutorType, TaskDispatchRecord, TaskRunRecord } from "../contracts/execution-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { TaskService } from "./task-service.js";
import type { GuardrailService } from "./guardrail-service.js";
import type { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import type { WorkerClarificationService } from "./worker-clarification-service.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  isJulesSessionCapacityError,
  isJulesSessionConsumingConcurrentTask,
} from "../integrations/jules-api-client.js";

/**
 * Thrown when a task cannot be dispatched because the provider's global concurrency cap is
 * currently reached. This is a deferral, not a failure: callers should re-queue the task and
 * retry on a later cycle rather than counting it toward the emergency-stop failure budget.
 */
export class ProviderCapReachedError extends Error {
  readonly retryableDispatchDeferral = true;
  readonly deferralReason = "provider_concurrency_cap" as const;

  constructor(public readonly provider: string, public readonly limit: number, public readonly currentCount: number) {
    super(`Provider concurrency cap reached for ${provider} (limit ${limit}, current ${currentCount}); task deferred.`);
    this.name = "ProviderCapReachedError";
  }
}

export class ProviderCapacityCheckUnavailableError extends Error {
  readonly retryableDispatchDeferral = true;
  readonly deferralReason = "provider_concurrency_cap" as const;

  constructor(
    public readonly provider: string,
    public readonly limit: number,
    public readonly currentCount: number,
    cause: unknown,
  ) {
    super(`Provider capacity could not be verified for ${provider}; task deferred to avoid exceeding limit ${limit}.`, {
      cause,
    });
    this.name = "ProviderCapacityCheckUnavailableError";
  }
}

export class WorkerClarificationPendingError extends Error {
  readonly retryableDispatchDeferral = true;
  readonly deferralReason = "worker_clarification_pending" as const;

  constructor(public readonly clarificationId: string) {
    super(`Worker clarification ${clarificationId} is pending; ordinary task dispatch is deferred.`);
    this.name = "WorkerClarificationPendingError";
  }
}

export type TaskDispatchDeferral =
  | {
    reason: "provider_concurrency_cap";
    provider?: string;
    limit?: number;
    currentCount?: number;
  }
  | {
    reason: "worker_clarification_pending";
    clarificationId: string;
  };

export function getTaskDispatchDeferral(error: unknown): TaskDispatchDeferral | null {
  if (error instanceof ProviderCapReachedError) {
    return {
      reason: error.deferralReason,
      provider: error.provider,
      limit: error.limit,
      currentCount: error.currentCount,
    };
  }
  if (error instanceof WorkerClarificationPendingError) {
    return {
      reason: error.deferralReason,
      clarificationId: error.clarificationId,
    };
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as {
    retryableDispatchDeferral?: unknown;
    deferralReason?: unknown;
    provider?: unknown;
    limit?: unknown;
    currentCount?: unknown;
    clarificationId?: unknown;
  };
  if (candidate.retryableDispatchDeferral !== true) {
    return null;
  }
  if (
    candidate.deferralReason === "worker_clarification_pending"
    && typeof candidate.clarificationId === "string"
  ) {
    return {
      reason: "worker_clarification_pending",
      clarificationId: candidate.clarificationId,
    };
  }
  if (candidate.deferralReason !== "provider_concurrency_cap") return null;

  return {
    reason: "provider_concurrency_cap",
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    limit: typeof candidate.limit === "number" ? candidate.limit : undefined,
    currentCount: typeof candidate.currentCount === "number" ? candidate.currentCount : undefined,
  };
}

export interface StartSprintDispatchArgs {
  task: Subtask;
  projectId: string;
  sprintId: string;
  sprintRunId: string;
  sourceId?: string;
  featureBranch: string;
  repoPath: string;
  sprintNumber: number;
  taskRecord?: import("../contracts/project-management-types.js").TaskRecord;
  providerConfigId?: string;
  resumeWorkspaceSessionId?: string;
  resumeWorkerBranch?: string;
  forceFreshWorkspace?: boolean;
  requireProviderSessionResume?: boolean;
  clarificationContinuationId?: string;
}

export interface StartSprintDispatchResult {
  id?: string;
  name?: string;
  provider?: string;
  runtimeLabel?: string;
  dispatchId?: string;
  taskRunId?: string;
  startedNew?: boolean;
}

const DUPLICATE_BLOCKING_TASK_DISPATCH_STATUSES = new Set<TaskDispatchRecord["status"]>([
  "claimed",
  "running",
  "cancel_requested",
  "paused",
]);
const PROVIDER_REPORTED_CAPACITY_RETRY_MS = 30_000;

interface ProviderReportedCapacityBackoff {
  maxRunningBeforeProbe: number;
  retryAfterMs: number;
}

export class SprintTaskDispatchService {
  private readonly providerReportedCapacityBackoff = new Map<string, ProviderReportedCapacityBackoff>();

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly taskService: TaskService,
    private readonly guardrailService: GuardrailService,
    private readonly providerConcurrencyService: ProviderConcurrencyService,
    private readonly getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings,
    private readonly logger?: Logger,
    private readonly listJulesSessionsForCapacity?: () => Promise<JulesSession[]>,
    private readonly workerClarificationService?: WorkerClarificationService,
  ) {}

  async startTask(args: StartSprintDispatchArgs): Promise<StartSprintDispatchResult> {
    const taskRecordId = this.requireTaskRecordId(args.task);
    const taskRecord = args.taskRecord || this.projectManagementRepository.getTask(taskRecordId);
    if (!taskRecord) {
      throw new Error(`Task record not found: ${taskRecordId}`);
    }

    const pendingClarification = this.workerClarificationService?.findPendingForTask(
      args.projectId,
      taskRecordId,
      args.sprintRunId,
    ) ?? null;
    if (pendingClarification && args.clarificationContinuationId !== pendingClarification.id) {
      throw new WorkerClarificationPendingError(pendingClarification.id);
    }
    if (args.clarificationContinuationId && !pendingClarification) {
      throw new Error(
        `Cannot continue clarification ${args.clarificationContinuationId}: it is no longer pending for this task run.`,
      );
    }

    const activeDispatch = this.findDuplicateBlockingDispatchForTask(args.projectId, args.sprintRunId, taskRecordId);
    if (activeDispatch) {
      const taskRun = this.executionRepository.getTaskRunByDispatchId(activeDispatch.id)
        || this.executionRepository.getLatestTaskRun(taskRecordId, args.sprintRunId);
      if (args.clarificationContinuationId) {
        throw new Error(
          `Cannot continue clarification ${args.clarificationContinuationId}: task already has active dispatch ${activeDispatch.id}.`,
        );
      }
      this.logger?.warn("Skipped duplicate sprint task dispatch because an active dispatch already exists", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        taskId: taskRecordId,
        dispatchId: activeDispatch.id,
        dispatchStatus: activeDispatch.status,
        taskRunId: taskRun?.id,
        taskRunState: taskRun?.state,
      });
      return {
        id: taskRun?.sessionId || activeDispatch.id,
        name: taskRun?.sessionName || taskRun?.sessionId || activeDispatch.id,
        provider: taskRun?.provider || undefined,
        runtimeLabel: taskRun?.provider ? String(taskRun.provider).toUpperCase() : "EXISTING",
        dispatchId: activeDispatch.id,
        taskRunId: taskRun?.id,
        startedNew: false,
      };
    }

    const preferredExecutor = taskRecord.executorType;
    const settingsScope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const provider = this.taskService.resolveTaskProvider(args.task, settingsScope, preferredExecutor);
    const executorType: TaskDispatchExecutorType = provider === "jules" ? "jules" : "docker_cli";

    const settings = this.getDashboardSettings(settingsScope);
    const providerSettings = provider
      ? (settings.aiProvider.providers[provider as ProviderId]
         ?? Object.values(settings.aiProvider.providers).find((entry) => entry.provider === provider))
      : undefined;
    const limit = providerSettings?.maxConcurrentTasks ?? 0;

    if (provider) {
      const counts = this.providerConcurrencyService.getGlobalRunningCounts([provider]);
      const currentCount = counts[provider] || 0;
      if (limit > 0 && currentCount >= limit) {
        throw this.deferForProviderCapacity(args, taskRecordId, provider, executorType, limit, currentCount);
      }
      const providerBackoff = this.providerReportedCapacityBackoff.get(provider);
      if (
        providerBackoff
        && Date.now() < providerBackoff.retryAfterMs
        && currentCount >= providerBackoff.maxRunningBeforeProbe
      ) {
        throw this.deferForProviderCapacity(
          args,
          taskRecordId,
          provider,
          executorType,
          providerBackoff.maxRunningBeforeProbe,
          currentCount,
        );
      }
    }

    // Jules sessions run remotely and are not gated by the CLI execution path's atomic slot
    // claim. Claim a global concurrency slot here — before creating any dispatch/task-run
    // records or calling the Jules API — so the provider cap is enforced atomically across all
    // sprints and projects. CLI/docker tasks claim their slot later inside ProviderExecutionService.
    let julesClaim: ProviderInvocationUsageRecord | null = null;
    try {
      julesClaim = executorType === "jules"
        ? await this.claimJulesSlot(args, taskRecordId, settingsScope)
        : null;
    } catch (error) {
      const deferral = getTaskDispatchDeferral(error);
      if (deferral?.reason === "provider_concurrency_cap") {
        const pStr = provider || "jules";
        const counts = this.providerConcurrencyService.getGlobalRunningCounts([pStr]);
        const currentCount = counts[pStr] || 0;
        throw this.deferForProviderCapacity(
          args,
          taskRecordId,
          pStr,
          executorType,
          deferral.limit ?? 0,
          Math.max(currentCount, deferral.currentCount ?? 0),
        );
      }
      throw error;
    }

    const queuedAt = new Date().toISOString();
    const queuedDispatch = this.findQueuedDispatchForTask(args.projectId, args.sprintRunId, taskRecordId);
    const dispatch = queuedDispatch || this.executionRepository.createTaskDispatch({
      projectId: args.projectId,
      sprintId: args.sprintId,
      taskId: taskRecordId,
      sprintRunId: args.sprintRunId,
      executorType,
      queuedAt,
    });

    let taskRun = this.executionRepository.getTaskRunByDispatchId(dispatch.id);
    if (taskRun) {
      taskRun = this.executionRepository.updateTaskRun(taskRun.id, {
        provider,
        mode: executorType,
        state: "RUNNING",
        finishedAt: null,
        durationMs: null,
      });
    } else {
      taskRun = this.executionRepository.createTaskRun({
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: taskRecordId,
        sprintRunId: args.sprintRunId,
        dispatchId: dispatch.id,
        provider,
        mode: executorType,
        state: "RUNNING",
        startedAt: queuedAt,
      });
    }

    if (julesClaim) {
      this.executionRepository.associateProviderInvocationRuntime(julesClaim.id, {
        sprintRunId: args.sprintRunId,
        dispatchId: dispatch.id,
        taskRunId: taskRun.id,
      });
    }

    const julesExecutionInvocation = julesClaim
      ? this.executionRepository.createExecutionInvocation({
          projectId: args.projectId,
          sprintId: args.sprintId,
          taskId: taskRecordId,
          sprintRunId: args.sprintRunId,
          dispatchId: dispatch.id,
          taskRunId: taskRun.id,
          providerInvocationId: julesClaim.id,
          type: "task_coding",
          status: "running",
          provider: "jules",
          model: "jules-agent",
          startedAt: queuedAt,
          invocationSource: "EXTERNAL_API",
        })
      : null;
    if (julesExecutionInvocation) {
      this.executionRepository.appendExecutionInvocationMessage(julesExecutionInvocation.id, {
        role: "system",
        contentMarkdown: "Jules task dispatched. Waiting for remote session transcript.",
        metadata: { provider: "jules", model: "jules-agent", kind: "dispatch_started" },
        createdAt: queuedAt,
      });
    }

    this.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_started", "system", {
      dispatchId: dispatch.id,
      executorType,
      provider,
    });
    this.projectManagementRepository.updateTask(taskRecordId, {
      status: "in_progress",
    });

    this.executionRepository.updateTaskDispatch(dispatch.id, {
      status: "running",
      claimedAt: queuedAt,
      startedAt: dispatch.startedAt || queuedAt,
      finishedAt: null,
      lastHeartbeatAt: queuedAt,
      errorMessage: null,
    });

    try {
      const session = await this.taskService.startSprintTask(
        args.task,
        args.sourceId,
        args.featureBranch,
        args.repoPath,
        args.sprintNumber,
        settingsScope,
        dispatch.id,
        taskRun.id,
        {
          taskRecordId,
          resumeWorkspaceSessionId: args.resumeWorkspaceSessionId,
          resumeWorkerBranch: args.resumeWorkerBranch,
          forceFreshWorkspace: args.forceFreshWorkspace,
          requireProviderSessionResume: args.requireProviderSessionResume,
          providerConfigId: args.providerConfigId,
        },
      );
      const sessionName = session.name || null;
      const sessionId = session.id || null;
      const nextProvider = session.provider || provider;
      if (nextProvider) {
        this.providerReportedCapacityBackoff.delete(nextProvider);
      }

      // Re-key the claimed concurrency slot onto the real Jules session id so the session-sync
      // terminal handler can release it when the session completes or fails.
      if (julesClaim) {
        const associatedSessionId = sessionId || sessionName;
        if (associatedSessionId) {
          this.executionRepository.associateProviderInvocationSession(julesClaim.id, associatedSessionId, sessionId);
        }
      }

      if (!this.canRecordStartedSession(args.sprintRunId, dispatch.id)) {
        return {
          id: session.id,
          name: session.name,
          provider: nextProvider || undefined,
          dispatchId: dispatch.id,
          taskRunId: taskRun.id,
          startedNew: false,
        };
      }

      this.executionRepository.updateTaskRun(taskRun.id, {
        provider: nextProvider,
        sessionId,
        sessionName,
        workerBranch: this.resolveWorkerBranch(session),
        prUrl: this.resolvePrUrl(session),
      });
      this.executionRepository.updateTaskDispatch(dispatch.id, {
        status: "running",
        lastHeartbeatAt: new Date().toISOString(),
      });
      this.executionRepository.appendTaskRunEvent(taskRun.id, "session_created", "system", {
        sessionId,
        sessionName,
        provider: nextProvider,
      });

      // Record the coding invocation against the per-task guardrail ledger (record-once;
      // this is the single dispatch entry for both Jules and CLI executors).
      this.guardrailService.record(
        { projectId: args.projectId, sprintId: args.sprintId },
        taskRecordId,
        "task_coding",
      );

      return {
        id: session.id,
        name: session.name,
        provider: nextProvider || undefined,
        dispatchId: dispatch.id,
        taskRunId: taskRun.id,
        startedNew: true,
      };
    } catch (error) {
      let deferral = getTaskDispatchDeferral(error);
      if (!deferral && executorType === "jules" && isJulesSessionCapacityError(error)) {
        const counts = this.providerConcurrencyService.getGlobalRunningCounts(["jules"]);
        const claimedCount = counts.jules || 0;
        const currentCount = Math.max(0, claimedCount - (julesClaim?.status === "running" ? 1 : 0));
        this.providerReportedCapacityBackoff.set("jules", {
          maxRunningBeforeProbe: currentCount,
          retryAfterMs: Date.now() + PROVIDER_REPORTED_CAPACITY_RETRY_MS,
        });
        deferral = {
          reason: "provider_concurrency_cap",
          provider: "jules",
          limit: currentCount,
          currentCount,
        };
        this.logger?.info("Jules task dispatch deferred after the provider reported session capacity", {
          projectId: args.projectId,
          sprintId: args.sprintId,
          sprintRunId: args.sprintRunId,
          taskId: taskRecordId,
          currentCount,
          retryAfterMs: PROVIDER_REPORTED_CAPACITY_RETRY_MS,
          providerError: error instanceof Error ? error.message : String(error),
        });
      }
      if (!deferral && executorType === "jules" && this.isGenericJulesPreconditionError(error)) {
        // Jules currently returns a generic FAILED_PRECONDITION with no quota
        // detail when createSession loses a subscription-capacity race. The
        // list API has no state filter/count endpoint and may place old running
        // sessions beyond its first page, so a bounded post-error snapshot
        // cannot disprove the provider's authoritative rejection. Always make
        // this retryable: INVALID_ARGUMENT remains the terminal validation path.
        const confirmedCapacity = await this.confirmJulesCapacityAfterRejectedCreate(
          limit,
          julesClaim?.id || null,
        ).catch(() => null);
        const locallyRunning = this.providerConcurrencyService.getGlobalRunningCounts(["jules"]).jules || 0;
        const currentCount = Math.max(limit, locallyRunning, confirmedCapacity?.currentCount ?? 0);
        this.providerReportedCapacityBackoff.set("jules", {
          maxRunningBeforeProbe: Math.max(0, locallyRunning - (julesClaim?.status === "running" ? 1 : 0)),
          retryAfterMs: Date.now() + PROVIDER_REPORTED_CAPACITY_RETRY_MS,
        });
        deferral = {
          reason: "provider_concurrency_cap",
          provider: "jules",
          limit,
          currentCount,
        };
        this.logger?.info("Jules generic precondition response treated as retryable provider capacity", {
          projectId: args.projectId,
          sprintId: args.sprintId,
          sprintRunId: args.sprintRunId,
          taskId: taskRecordId,
          configuredLimit: limit,
          currentCount,
          capacitySnapshotConfirmed: confirmedCapacity !== null,
        });
      }
      if (deferral?.reason === "provider_concurrency_cap") {
        const deferredProvider = deferral.provider || provider || executorType;
        this.releaseJulesClaimForDeferral(julesClaim, julesExecutionInvocation?.id || null, error);
        throw this.deferForProviderCapacity(
          args,
          taskRecordId,
          deferredProvider,
          executorType,
          deferral.limit ?? 0,
          deferral.currentCount ?? 0,
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      // Release the claimed Jules concurrency slot so a failed dispatch never leaks capacity.
      if (julesClaim) {
        this.executionRepository.updateProviderInvocationUsage(julesClaim.id, {
          status: "failed",
          finishedAt,
        });
      }
      if (julesExecutionInvocation) {
        this.executionRepository.updateExecutionInvocation(julesExecutionInvocation.id, {
          status: "failed",
          finishedAt,
          errorMessage: message,
          lastErrorMessage: message,
        });
        this.executionRepository.appendExecutionInvocationMessage(julesExecutionInvocation.id, {
          role: "system",
          contentMarkdown: `Jules dispatch failed: ${message}`,
          metadata: { provider: "jules", model: "jules-agent", kind: "dispatch_failed" },
          createdAt: finishedAt,
        });
      }
      this.executionRepository.updateTaskRun(taskRun.id, {
        state: "FAILED",
        finishedAt,
        durationMs: this.calculateDurationMs(taskRun, finishedAt),
      });
      this.executionRepository.updateTaskDispatch(dispatch.id, {
        status: "failed",
        finishedAt,
        errorMessage: message,
        lastHeartbeatAt: finishedAt,
      });
      this.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_failed", "system", {
        dispatchId: dispatch.id,
        error: message,
      });
      this.logger?.error("Sprint task dispatch failed", {
        taskId: args.task.id,
        taskRecordId: args.task.record_id,
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        error: message,
      });
      throw error;
    }
  }

  private releaseJulesClaimForDeferral(
    claim: ProviderInvocationUsageRecord | null,
    executionInvocationId: string | null,
    cause: unknown,
  ): void {
    if (!claim) {
      return;
    }
    const deferredAt = new Date().toISOString();
    this.executionRepository.updateProviderInvocationUsage(claim.id, {
      status: "cancelled",
      finishedAt: deferredAt,
    });
    if (!executionInvocationId) {
      return;
    }
    this.executionRepository.updateExecutionInvocation(executionInvocationId, {
      status: "cancelled",
      finishedAt: deferredAt,
      errorMessage: null,
      lastErrorMessage: null,
    });
    this.executionRepository.appendExecutionInvocationMessage(executionInvocationId, {
      role: "system",
      contentMarkdown: "Jules dispatch deferred because the provider reported that session capacity is currently full.",
      metadata: {
        provider: "jules",
        model: "jules-agent",
        kind: "dispatch_deferred",
        providerMessage: cause instanceof Error ? cause.message : String(cause),
      },
      createdAt: deferredAt,
    });
  }

  private canRecordStartedSession(sprintRunId: string, dispatchId: string): boolean {
    const sprintRun = this.executionRepository.getSprintRun(sprintRunId);
    if (sprintRun?.status === "cancelled" || sprintRun?.status === "failed" || sprintRun?.status === "completed" || sprintRun?.status === "cancel_requested") {
      return false;
    }

    const dispatch = this.executionRepository.getTaskDispatch(dispatchId);
    return dispatch?.status === "running";
  }

  /**
   * Resolves the effective Jules concurrency cap for the scope (already clamped to the system
   * cap during settings resolution) and atomically claims a slot. Throws ProviderCapReachedError
   * when no slot is available so the caller can defer the task instead of exceeding the cap.
   */
  private async claimJulesSlot(
    args: StartSprintDispatchArgs,
    taskRecordId: string,
    settingsScope: DashboardSettingsScope,
  ): Promise<ProviderInvocationUsageRecord> {
    const settings = this.getDashboardSettings(settingsScope);
    const julesSettings = settings.aiProvider.providers["jules"]
      ?? Object.values(settings.aiProvider.providers).find((entry) => entry.provider === "jules");
    const limit = julesSettings?.maxConcurrentTasks ?? 0;

    const admission = await this.resolveJulesAdmission(limit);
    const claim = await this.providerConcurrencyService.tryClaimSlot("jules" as ProviderId, admission.localLimit, {
      projectId: args.projectId,
      sprintId: args.sprintId,
      taskId: taskRecordId,
      sprintRunId: args.sprintRunId,
      // Placeholder session id until the Jules API returns the real one; re-keyed on success.
      sessionId: `jules-pending:${taskRecordId}:${randomUUID()}`,
      provider: "jules",
      purpose: "task_coding",
      status: "running",
      invocationSource: "EXTERNAL_API",
    });

    if (!claim) {
      const counts = this.providerConcurrencyService.getGlobalRunningCounts(["jules"]);
      const currentCount = (counts["jules"] || 0) + admission.remoteOnlyCount;
      throw new ProviderCapReachedError("jules", limit, currentCount);
    }

    return claim;
  }

  private async resolveJulesAdmission(limit: number, excludedLocalInvocationId?: string | null): Promise<{
    localLimit: number;
    remoteOnlyCount: number;
  }> {
    if (limit <= 0 || !this.listJulesSessionsForCapacity) {
      return { localLimit: limit, remoteOnlyCount: 0 };
    }

    let sessions: JulesSession[];
    try {
      sessions = await this.listJulesSessionsForCapacity();
    } catch (error) {
      const localCount = this.providerConcurrencyService.getGlobalRunningCounts(["jules"]).jules || 0;
      this.logger?.warn("Jules dispatch deferred because remote session capacity could not be verified", {
        provider: "jules",
        configuredLimit: limit,
        localRunningCount: localCount,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProviderCapacityCheckUnavailableError("jules", limit, localCount, error);
    }

    const remoteActive = this.uniqueActiveJulesSessions(sessions);
    const localRunning = this.providerConcurrencyService.listCapacityConsumingProviderInvocations(["jules"])
      .filter((invocation) => invocation.id !== excludedLocalInvocationId);
    const localSessionIds = new Set<string>();
    for (const invocation of localRunning) {
      this.addJulesSessionIdentity(localSessionIds, invocation.sessionId);
      this.addJulesSessionIdentity(localSessionIds, invocation.nativeSessionId);
    }
    const remoteOnlyCount = remoteActive.filter((session) => {
      const identities = new Set<string>();
      this.addJulesSessionIdentity(identities, session.id);
      this.addJulesSessionIdentity(identities, session.name);
      return !Array.from(identities).some((identity) => localSessionIds.has(identity));
    }).length;
    const totalRunningCount = localRunning.length + remoteOnlyCount;

    if (totalRunningCount >= limit) {
      throw new ProviderCapReachedError("jules", limit, totalRunningCount);
    }

    if (remoteOnlyCount > 0) {
      this.logger?.info("Jules admission included remotely active sessions outside local runtime accounting", {
        provider: "jules",
        configuredLimit: limit,
        remoteActiveCount: remoteActive.length,
        remoteOnlyCount,
        localRunningCount: localRunning.length,
        availableSlots: Math.max(0, limit - totalRunningCount),
      });
    }

    // Atomic local claims now enforce the subscription limit after reserving
    // room for sessions that are active in Jules but absent from this DB.
    return {
      localLimit: Math.max(0, limit - remoteOnlyCount),
      remoteOnlyCount,
    };
  }

  private isGenericJulesPreconditionError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }
    const candidate = error as { status?: unknown; apiStatus?: unknown; message?: unknown };
    return candidate.status === 400
      && String(candidate.apiStatus || "").toUpperCase() === "FAILED_PRECONDITION"
      && String(candidate.message || "").toLowerCase().includes("precondition");
  }

  private async confirmJulesCapacityAfterRejectedCreate(
    limit: number,
    excludedLocalInvocationId: string | null,
  ): Promise<{ currentCount: number } | null> {
    if (limit <= 0 || !this.listJulesSessionsForCapacity) {
      return null;
    }
    try {
      await this.resolveJulesAdmission(limit, excludedLocalInvocationId);
      return null;
    } catch (error) {
      const deferral = getTaskDispatchDeferral(error);
      if (!deferral || deferral.reason !== "provider_concurrency_cap") {
        throw error;
      }
      return { currentCount: deferral.currentCount ?? limit };
    }
  }

  private uniqueActiveJulesSessions(sessions: readonly JulesSession[]): JulesSession[] {
    const unique = new Map<string, JulesSession>();
    for (const session of sessions) {
      if (!isJulesSessionConsumingConcurrentTask(session)) {
        continue;
      }
      const key = session.id || session.name;
      if (key && !unique.has(key)) {
        unique.set(key, session);
      }
    }
    return Array.from(unique.values());
  }

  private addJulesSessionIdentity(target: Set<string>, value: string | null | undefined): void {
    const normalized = value?.trim();
    if (!normalized) {
      return;
    }
    target.add(normalized);
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
      target.add(normalized.slice(slashIndex + 1));
    }
  }

  private requireTaskRecordId(task: Subtask): string {
    if (typeof task.record_id === "string" && task.record_id.trim().length > 0) {
      return task.record_id;
    }
    throw new Error(`Task ${task.id} is missing its database record id.`);
  }

  private findDuplicateBlockingDispatchForTask(projectId: string, sprintRunId: string, taskId: string): TaskDispatchRecord | null {
    const activeDispatches = this.executionRepository.listTaskDispatches({
      projectId,
      sprintRunId,
      taskId,
    }).filter((dispatch) => DUPLICATE_BLOCKING_TASK_DISPATCH_STATUSES.has(dispatch.status));
    return this.getMostRecentDispatch(activeDispatches);
  }

  private findQueuedDispatchForTask(projectId: string, sprintRunId: string, taskId: string): TaskDispatchRecord | null {
    const queuedDispatches = this.executionRepository.listTaskDispatches({
      projectId,
      sprintRunId,
      taskId,
    }).filter((dispatch) => dispatch.status === "queued");
    return this.getMostRecentDispatch(queuedDispatches);
  }

  private getMostRecentDispatch(dispatches: TaskDispatchRecord[]): TaskDispatchRecord | null {
    const activeDispatches = dispatches;
    if (activeDispatches.length === 0) {
      return null;
    }
    return activeDispatches.sort((left, right) => {
      const leftTime = Date.parse(left.startedAt || left.claimedAt || left.queuedAt || left.createdAt);
      const rightTime = Date.parse(right.startedAt || right.claimedAt || right.queuedAt || right.createdAt);
      return rightTime - leftTime;
    })[0] ?? null;
  }

  private deferForProviderCapacity(
    args: StartSprintDispatchArgs,
    taskRecordId: string,
    provider: string,
    executorType: TaskDispatchExecutorType,
    limit: number,
    currentCount: number,
  ): ProviderCapReachedError {
    let taskRun = this.executionRepository.getLatestTaskRun(taskRecordId, args.sprintRunId);
    let dispatch = taskRun?.dispatchId ? this.executionRepository.getTaskDispatch(taskRun.dispatchId) : null;

    if (!taskRun) {
      const queuedAt = new Date().toISOString();
      dispatch = this.executionRepository.createTaskDispatch({
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: taskRecordId,
        sprintRunId: args.sprintRunId,
        executorType,
        queuedAt,
        status: "queued",
      });

      taskRun = this.executionRepository.createTaskRun({
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: taskRecordId,
        sprintRunId: args.sprintRunId,
        dispatchId: dispatch.id,
        provider,
        mode: executorType,
        state: "PENDING",
        startedAt: queuedAt,
      });
    } else {
      this.executionRepository.updateTaskRun(taskRun.id, {
        state: "PENDING",
        provider,
        mode: executorType,
        finishedAt: null,
        durationMs: null,
      });
      if (dispatch) {
        this.executionRepository.updateTaskDispatch(dispatch.id, {
          status: "queued",
          finishedAt: null,
          errorMessage: null,
          lastHeartbeatAt: null,
        });
      }
    }

    this.projectManagementRepository.updateTask(taskRecordId, {
      status: "pending",
    });

    this.executionRepository.appendTaskRunEvent(taskRun.id, "provider_concurrency_wait", "system", {
      provider,
      currentCount,
      limit,
    });
    this.logger?.info("Sprint task dispatch deferred: provider concurrency cap reached", {
      taskId: args.task.id,
      taskRecordId,
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId,
      provider,
      limit,
      currentCount,
    });

    return new ProviderCapReachedError(provider, limit, currentCount);
  }

  private resolveWorkerBranch(session: JulesSession): string | null {
    const output = Array.isArray(session.outputs) ? session.outputs[0] : undefined;
    const branch = output?.pullRequest?.workerBranch;
    return typeof branch === "string" && branch.trim().length > 0 ? branch : null;
  }

  private resolvePrUrl(session: JulesSession): string | null {
    const output = Array.isArray(session.outputs) ? session.outputs[0] : undefined;
    const prUrl = output?.pullRequest?.url;
    return typeof prUrl === "string" && prUrl.trim().length > 0 ? prUrl : null;
  }

  private calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
    if (!taskRun.startedAt) {
      return null;
    }

    return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
  }
}
