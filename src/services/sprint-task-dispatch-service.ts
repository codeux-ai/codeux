import { randomUUID } from "node:crypto";
import type { DashboardSettings, DashboardSettingsScope, JulesSession, ProviderId, Subtask } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, TaskDispatchExecutorType, TaskRunRecord } from "../contracts/execution-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { TaskService } from "./task-service.js";
import type { GuardrailService } from "./guardrail-service.js";
import type { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import type { Logger } from "../shared/logging/logger.js";

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

export interface TaskDispatchDeferral {
  reason: "provider_concurrency_cap";
  provider?: string;
  limit?: number;
  currentCount?: number;
}

export function getTaskDispatchDeferral(error: unknown): TaskDispatchDeferral | null {
  if (error instanceof ProviderCapReachedError) {
    return {
      reason: error.deferralReason,
      provider: error.provider,
      limit: error.limit,
      currentCount: error.currentCount,
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
  };
  if (candidate.retryableDispatchDeferral !== true || candidate.deferralReason !== "provider_concurrency_cap") {
    return null;
  }

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
}

export interface StartSprintDispatchResult {
  id?: string;
  name?: string;
  provider?: string;
  runtimeLabel?: string;
}

export class SprintTaskDispatchService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly taskService: TaskService,
    private readonly guardrailService: GuardrailService,
    private readonly providerConcurrencyService: ProviderConcurrencyService,
    private readonly getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings,
    private readonly logger?: Logger,
  ) {}

  async startTask(args: StartSprintDispatchArgs): Promise<StartSprintDispatchResult> {
    const taskRecordId = this.requireTaskRecordId(args.task);
    const taskRecord = args.taskRecord || this.projectManagementRepository.getTask(taskRecordId);
    if (!taskRecord) {
      throw new Error(`Task record not found: ${taskRecordId}`);
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

    if (provider && limit > 0) {
      const counts = this.providerConcurrencyService.getGlobalRunningCounts([provider]);
      const currentCount = counts[provider] || 0;
      if (currentCount >= limit) {
        throw this.deferForProviderCapacity(args, taskRecordId, provider, executorType, limit, currentCount);
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
      if (error instanceof ProviderCapReachedError) {
        const pStr = provider || "jules";
        const counts = this.providerConcurrencyService.getGlobalRunningCounts([pStr]);
        const currentCount = counts[pStr] || 0;
        throw this.deferForProviderCapacity(args, taskRecordId, pStr, executorType, error.limit, currentCount);
      }
      throw error;
    }

    const queuedAt = new Date().toISOString();
    const dispatch = this.executionRepository.createTaskDispatch({
      projectId: args.projectId,
      sprintId: args.sprintId,
      taskId: taskRecordId,
      sprintRunId: args.sprintRunId,
      executorType,
      queuedAt,
    });

    const taskRun = this.executionRepository.createTaskRun({
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
      startedAt: queuedAt,
      lastHeartbeatAt: queuedAt,
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
          resumeWorkspaceSessionId: args.resumeWorkspaceSessionId,
          resumeWorkerBranch: args.resumeWorkerBranch,
          forceFreshWorkspace: args.forceFreshWorkspace,
          providerConfigId: args.providerConfigId,
        },
      );
      const sessionName = session.name || null;
      const sessionId = session.id || null;
      const nextProvider = session.provider || provider;

      // Re-key the claimed concurrency slot onto the real Jules session id so the session-sync
      // terminal handler can release it when the session completes or fails.
      if (julesClaim) {
        const associatedSessionId = sessionId || sessionName;
        if (associatedSessionId) {
          this.executionRepository.associateProviderInvocationSession(julesClaim.id, associatedSessionId, sessionId);
        }
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
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      // Release the claimed Jules concurrency slot so a failed dispatch never leaks capacity.
      if (julesClaim) {
        this.executionRepository.updateProviderInvocationUsage(julesClaim.id, {
          status: "failed",
          finishedAt,
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

    const claim = await this.providerConcurrencyService.tryClaimSlot("jules" as ProviderId, limit, {
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
      const currentCount = counts["jules"] || 0;
      throw new ProviderCapReachedError("jules", limit, currentCount);
    }

    return claim;
  }

  private requireTaskRecordId(task: Subtask): string {
    if (typeof task.record_id === "string" && task.record_id.trim().length > 0) {
      return task.record_id;
    }
    throw new Error(`Task ${task.id} is missing its database record id.`);
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
      });
      if (dispatch) {
        this.executionRepository.updateTaskDispatch(dispatch.id, {
          status: "queued",
        });
      }
    }

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
