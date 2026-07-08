import type { DockerContainer, ProviderId } from "../contracts/app-types.js";
import type {
  CreateProviderInvocationUsageInput,
  ProviderInvocationUsageRecord,
  TaskDispatchRecord,
  TaskRunRecord,
} from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { sleepWithSignal } from "../shared/providers/provider-retry-policy.js";
import { failStaleProviderInvocation } from "../domain/runtime/provider-invocation-recovery.js";

const STALE_DOCKER_PROVIDER_INVOCATION_MS = 60_000;
const STALE_DOCKER_PROVIDER_ACTIVITY_IDLE_MS = 180_000;
// A running Jules provider invocation whose linked task run is already terminal is released
// after this age. Orphaned claims (no associated session/task run yet) are only released once
// they are clearly abandoned, to avoid reclaiming a slot mid-dispatch.
const STALE_JULES_PROVIDER_INVOCATION_MS = 60_000;
const STALE_JULES_PROVIDER_ORPHAN_MS = 600_000;
const ACTIVE_DISPATCH_STATUSES = new Set(["queued", "claimed", "running", "cancel_requested", "paused"]);
const TERMINAL_FAILURE_TASK_RUN_STATES = new Set(["FAILED", "BLOCKED", "QUOTA"]);

export interface ProviderConcurrencyServiceDeps {
  executionRepository: ExecutionRepository;
  projectManagementRepository?: Pick<ProjectManagementRepository, "getTask" | "updateTask">;
  logger: Logger;
  dockerService?: Pick<{ isAvailable: () => Promise<boolean>; listContainers: () => Promise<DockerContainer[]> }, "isAvailable" | "listContainers">;
}

/**
 * Service to manage provider invocation concurrency caps globally across all projects.
 */
export class ProviderConcurrencyService {
  private readonly reconciliationLastRunMs = new Map<ProviderId, number>();
  private readonly RECONCILIATION_THROTTLE_MS = 10_000;
  private readonly activeReconciliations = new Map<ProviderId, Promise<void>>();
  private readonly capWaitLogLastRunMs = new Map<ProviderId, number>();

  constructor(private readonly deps: ProviderConcurrencyServiceDeps) {}

  /**
   * Blocks until a slot is available for the given provider according to the global cap.
   * 
   * @param provider The provider ID (e.g. "jules", "gemini")
   * @param limit The maximum number of concurrent invocations allowed (0 = infinite)
   * @param signal Optional AbortSignal to cancel waiting
   */
  async waitForSlot(provider: ProviderId, limit: number, signal?: AbortSignal, maxWaitMs?: number): Promise<void> {
    if (limit <= 0) {
      await this.reconcileStaleProviderInvocations(provider, true);
      return;
    }

    const startMs = Date.now();
    let lastLogMs = 0;
    let isFirstCheck = true;

    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || "AbortSignal triggered"));
      }

      if (maxWaitMs !== undefined && Date.now() - startMs >= maxWaitMs) {
        throw new Error(`Provider concurrency wait timed out after ${maxWaitMs}ms`);
      }

      await this.reconcileStaleProviderInvocations(provider, isFirstCheck);
      isFirstCheck = false;

      // Count running invocations across ALL projects in the repository
      const runningInvocations = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]);
      const currentCount = runningInvocations.length;

      if (currentCount < limit) {
        return;
      }

      lastLogMs = this.logProviderCapWait(provider, limit, currentCount, lastLogMs);

      let delayMs = 2000;
      if (maxWaitMs !== undefined) {
        const remainingMs = maxWaitMs - (Date.now() - startMs);
        delayMs = Math.min(delayMs, Math.max(0, remainingMs));
      }

      // Wait before checking again.
      await sleepWithSignal(delayMs, signal);
    }
  }

  /**
   * Blocks until a slot is available for the given provider and claims it atomically.
   */
  async waitForSlotAndClaim(
    provider: ProviderId,
    limit: number,
    input: CreateProviderInvocationUsageInput,
    signal?: AbortSignal,
    maxWaitMs?: number
  ): Promise<ProviderInvocationUsageRecord> {
    if (limit <= 0) {
      await this.reconcileStaleProviderInvocations(provider, true);
      return this.deps.executionRepository.createProviderInvocationUsage(input);
    }

    const startMs = Date.now();
    let lastLogMs = 0;
    let isFirstCheck = true;

    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || "AbortSignal triggered"));
      }

      if (maxWaitMs !== undefined && Date.now() - startMs >= maxWaitMs) {
        throw new Error(`Provider concurrency wait timed out after ${maxWaitMs}ms`);
      }

      await this.reconcileStaleProviderInvocations(provider, isFirstCheck);
      isFirstCheck = false;

      const invocation = this.deps.executionRepository.tryCreateProviderInvocationUsage(input, limit);
      if (invocation) {
        return invocation;
      }

      // Count for logging/tracking purposes.
      const runningCount = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]).length;
      lastLogMs = this.logProviderCapWait(provider, limit, runningCount, lastLogMs);

      let delayMs = 2000;
      if (maxWaitMs !== undefined) {
        const remainingMs = maxWaitMs - (Date.now() - startMs);
        delayMs = Math.min(delayMs, Math.max(0, remainingMs));
      }

      await sleepWithSignal(delayMs, signal);
    }
  }

  /**
   * Attempts to claim a concurrency slot for the given provider atomically without waiting.
   * Returns the claimed invocation record, or null if the global cap is currently reached.
   *
   * Unlike {@link waitForSlotAndClaim} this never blocks — callers that prefer to defer work
   * (e.g. Jules sprint dispatch, which blocks the task and retries next cycle) use this so the
   * cap is enforced globally and atomically across all sprints and projects.
   */

  /**
   * Checks if there is available concurrency capacity for the given provider without claiming a slot.
   */
  async hasAvailableCapacity(provider: ProviderId, limit: number): Promise<boolean> {
    if (limit <= 0) {
      await this.reconcileStaleProviderInvocations(provider, true);
      return true;
    }

    await this.reconcileStaleProviderInvocations(provider, true);

    const counts = this.getGlobalRunningCounts([provider]);
    const current = counts[provider] || 0;
    return current < limit;
  }

  async tryClaimSlot(
    provider: ProviderId,
    limit: number,
    input: CreateProviderInvocationUsageInput,
  ): Promise<ProviderInvocationUsageRecord | null> {
    if (limit <= 0) {
      await this.reconcileStaleProviderInvocations(provider, true);
      return this.deps.executionRepository.createProviderInvocationUsage(input);
    }

    await this.reconcileStaleProviderInvocations(provider, true);

    return this.deps.executionRepository.tryCreateProviderInvocationUsage(input, limit);
  }

  /**
   * Returns current provider load across all projects. Running provider invocations are the
   * primary capacity signal, while active task runs cover Docker/CLI dispatches that have been
   * accepted by the sprint loop but have not created their provider invocation row yet. The task
   * run query excludes rows whose linked provider invocation has already finished, so post-provider
   * local git/merge work does not keep throttling new provider work.
   */
  getGlobalRunningCounts(providers?: string[]): Record<string, number> {
    const running = this.deps.executionRepository.listRunningProviderInvocationUsages(providers);
    const counts: Record<string, number> = {};
    for (const inv of running) {
      if (inv.provider) {
        counts[inv.provider] = (counts[inv.provider] || 0) + 1;
      }
    }
    const countTaskRuns = this.deps.executionRepository.countGlobalRunningTaskRunsPerProvider;
    if (typeof countTaskRuns === "function") {
      const taskRunCounts = countTaskRuns.call(this.deps.executionRepository, providers);
      for (const [provider, count] of taskRunCounts) {
        counts[provider] = Math.max(counts[provider] || 0, count);
      }
    }
    return counts;
  }

  private logProviderCapWait(provider: ProviderId, limit: number, currentCount: number, localLastLogMs: number): number {
    const now = Date.now();
    if (now - localLastLogMs < 10000) {
      return localLastLogMs;
    }

    const globalLastLogMs = this.capWaitLogLastRunMs.get(provider) || 0;
    if (now - globalLastLogMs < 10000) {
      return now;
    }

    this.deps.logger.info("Provider concurrency cap reached, waiting for slot", {
      provider,
      limit,
      currentCount,
    });
    this.capWaitLogLastRunMs.set(provider, now);
    return now;
  }

  private async reconcileStaleProviderInvocations(provider: ProviderId, force = false): Promise<void> {
    const nowMs = Date.now();
    const lastRunMs = this.reconciliationLastRunMs.get(provider) || 0;
    if (!force && nowMs - lastRunMs < this.RECONCILIATION_THROTTLE_MS) {
      return;
    }

    let active = this.activeReconciliations.get(provider);
    if (active) {
      return active;
    }

    this.reconciliationLastRunMs.set(provider, nowMs);

    active = (async () => {
      try {
        await this.reconcileStaleDockerProviderInvocations(provider);
        this.reconcileStaleJulesProviderInvocations(provider);
      } finally {
        this.activeReconciliations.delete(provider);
      }
    })();

    this.activeReconciliations.set(provider, active);
    return active;
  }

  private async reconcileStaleDockerProviderInvocations(provider: ProviderId): Promise<void> {
    if (!this.deps.dockerService) {
      return;
    }

    const running = this.deps.executionRepository.listRunningProviderInvocationUsages([provider])
      .filter((invocation) => invocation.executionMode === "DOCKER");
    if (running.length === 0) {
      return;
    }

    const dockerAvailable = await this.deps.dockerService.isAvailable().catch(() => false);
    if (!dockerAvailable) {
      return;
    }

    const containers = await this.deps.dockerService.listContainers().catch(() => []);
    const activeSessionIds = new Set(
      containers
        .map((container) => container.labels?.["code-ux.session-id"]?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    );
    const nowMs = Date.now();
    const reconciledAt = new Date().toISOString();

    for (const invocation of running) {
      if (activeSessionIds.has(invocation.sessionId)) {
        continue;
      }

      const ageMs = Date.now() - Date.parse(invocation.startedAt);
      if (!Number.isFinite(ageMs) || ageMs < STALE_DOCKER_PROVIDER_INVOCATION_MS) {
        continue;
      }

      const terminalStatus = this.resolveDockerProviderInvocationTerminalStatus(invocation, nowMs);
      if (terminalStatus === "active") {
        continue;
      }

      const linkedInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id);
      if (terminalStatus === "completed") {
        this.completeStaleProviderInvocation(invocation, linkedInvocations, reconciledAt);
        continue;
      }
      if (terminalStatus === "failed") {
        this.failDockerProviderInvocation(invocation, linkedInvocations, reconciledAt, provider);
        continue;
      }

      if (!this.isProviderInvocationIdle(linkedInvocations)) {
        continue;
      }

      this.failDockerProviderInvocation(invocation, linkedInvocations, reconciledAt, provider);
    }
  }

  private resolveDockerProviderInvocationTerminalStatus(
    invocation: ProviderInvocationUsageRecord,
    nowMs: number,
  ): "active" | "completed" | "failed" | null {
    const taskRun = invocation.taskRunId ? this.deps.executionRepository.getTaskRun(invocation.taskRunId) : null;
    const dispatch = invocation.dispatchId ? this.deps.executionRepository.getTaskDispatch(invocation.dispatchId) : null;
    if (dispatch) {
      if (dispatch.status === "completed") {
        return "completed";
      }
      if (dispatch.status === "failed" || dispatch.status === "blocked" || dispatch.status === "quota") {
        return "failed";
      }
      if (dispatch.status === "cancelled") {
        return "failed";
      }
      if (ACTIVE_DISPATCH_STATUSES.has(dispatch.status) && this.isDispatchRecentlyActive(dispatch, nowMs)) {
        return "active";
      }
    }

    if (taskRun) {
      const taskRunStatus = this.resolveTaskRunStatus(taskRun);
      if (taskRunStatus) {
        return taskRunStatus;
      }
    }
    return null;
  }

  private resolveTaskRunStatus(taskRun: TaskRunRecord): "active" | "completed" | "failed" | null {
    if (taskRun.state === "COMPLETED") {
      return "completed";
    }
    if (TERMINAL_FAILURE_TASK_RUN_STATES.has(taskRun.state)) {
      return "failed";
    }
    if (taskRun.state === "RUNNING" || taskRun.state === "PENDING" || taskRun.state === "PAUSED") {
      return "active";
    }
    return null;
  }

  private isDispatchRecentlyActive(dispatch: TaskDispatchRecord, nowMs: number): boolean {
    const activityAt = dispatch.lastHeartbeatAt || dispatch.startedAt || dispatch.claimedAt || dispatch.queuedAt;
    const idleMs = nowMs - Date.parse(activityAt);
    return Number.isFinite(idleMs) && idleMs < STALE_DOCKER_PROVIDER_ACTIVITY_IDLE_MS;
  }

  private completeStaleProviderInvocation(
    invocation: ProviderInvocationUsageRecord,
    linkedInvocations: ReturnType<ExecutionRepository["listExecutionInvocationsByProviderInvocationId"]>,
    reconciledAt: string,
  ): void {
    const finishedAt = invocation.finishedAt || reconciledAt;
    this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt,
      durationMs: this.calculateInvocationDurationMs(invocation, finishedAt) ?? undefined,
    });

    if (invocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(invocation.taskRunId);
      if (taskRun && taskRun.state !== "COMPLETED") {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          state: "COMPLETED",
          finishedAt: taskRun.finishedAt || finishedAt,
          durationMs: this.calculateTaskRunDurationMs(taskRun, taskRun.finishedAt || finishedAt),
        });
      }
    }

    this.closeActiveDispatchForTerminalProviderInvocation(
      invocation,
      "completed",
      "COMPLETED",
      finishedAt,
      null,
      "provider_concurrency_stale_docker_completed_reconcile",
    );

    if (invocation.taskId && this.deps.projectManagementRepository) {
      const task = this.deps.projectManagementRepository.getTask(invocation.taskId);
      if (task?.status === "in_progress") {
        this.deps.projectManagementRepository.updateTask(invocation.taskId, {
          status: task.isMerged ? "completed" : "coding_completed",
        });
      }
    }

    for (const executionInvocation of linkedInvocations) {
      if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
        continue;
      }
      this.deps.executionRepository.updateExecutionInvocation(executionInvocation.id, {
        status: "completed",
        finishedAt,
        errorMessage: null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(executionInvocation.id, {
        role: "system",
        contentMarkdown: "Recovered stale Docker provider invocation after the linked task run or dispatch completed.",
        metadata: {
          recovery: "provider_concurrency_stale_docker_completed_reconcile",
          providerInvocationId: invocation.id,
          provider: invocation.provider,
          ...(invocation.sessionId ? { sessionId: invocation.sessionId } : {}),
        },
        createdAt: reconciledAt,
      });
    }
  }

  private failDockerProviderInvocation(
    invocation: ProviderInvocationUsageRecord,
    linkedInvocations: ReturnType<ExecutionRepository["listExecutionInvocationsByProviderInvocationId"]>,
    reconciledAt: string,
    provider: ProviderId,
  ): void {
    const message = `Recovered stale ${invocation.purpose} provider invocation after its Docker container disappeared for session ${invocation.sessionId}. Code UX will retry the work.`;
    failStaleProviderInvocation(
      this.deps.executionRepository,
      invocation,
      linkedInvocations,
      {
        reconciledAt,
        recoveryReason: "provider_concurrency_stale_docker_reconcile",
        systemMessage: message,
      }
    );

    this.closeActiveDispatchForTerminalProviderInvocation(
      invocation,
      "failed",
      "FAILED",
      reconciledAt,
      message,
      "provider_concurrency_stale_docker_failed_reconcile",
    );

    if (invocation.taskId && this.deps.projectManagementRepository) {
      const task = this.deps.projectManagementRepository.getTask(invocation.taskId);
      if (task?.status === "in_progress") {
        this.deps.projectManagementRepository.updateTask(invocation.taskId, {
          status: "pending",
        });
      }
    }

    this.deps.logger.warn("Recovered stale Docker provider invocation while waiting for provider slot", {
      provider,
      providerInvocationId: invocation.id,
      sessionId: invocation.sessionId,
      purpose: invocation.purpose,
    });
  }

  private closeActiveDispatchForTerminalProviderInvocation(
    invocation: ProviderInvocationUsageRecord,
    dispatchStatus: Extract<TaskDispatchRecord["status"], "completed" | "failed">,
    taskRunState: Extract<TaskRunRecord["state"], "COMPLETED" | "FAILED">,
    finishedAt: string,
    errorMessage: string | null,
    reason: string,
  ): void {
    if (!invocation.dispatchId) {
      return;
    }

    const dispatch = this.deps.executionRepository.getTaskDispatch(invocation.dispatchId);
    if (!dispatch || !ACTIVE_DISPATCH_STATUSES.has(dispatch.status)) {
      return;
    }

    const taskRun = invocation.taskRunId
      ? this.deps.executionRepository.getTaskRun(invocation.taskRunId)
      : null;

    this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
    this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
      connectionId: null,
      status: dispatchStatus,
      startedAt: dispatch.startedAt || taskRun?.startedAt || invocation.startedAt || finishedAt,
      finishedAt: dispatch.finishedAt || taskRun?.finishedAt || invocation.finishedAt || finishedAt,
      lastHeartbeatAt: finishedAt,
      errorMessage,
    });

    if (taskRun && taskRun.state !== taskRunState) {
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: null,
        state: taskRunState,
        finishedAt: taskRun.finishedAt || invocation.finishedAt || finishedAt,
        durationMs: this.calculateTaskRunDurationMs(taskRun, taskRun.finishedAt || invocation.finishedAt || finishedAt),
      });
    }

    if (taskRun) {
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_dispatch_reconciled", "system", {
        reason,
        providerInvocationId: invocation.id,
        providerStatus: dispatchStatus,
        previousDispatchStatus: dispatch.status,
        nextDispatchStatus: dispatchStatus,
        previousTaskRunState: taskRun.state,
        nextTaskRunState: taskRunState,
      }, {
        sourceEventKey: `${reason}:${dispatch.id}:${invocation.id}`,
      });
    }
  }

  private calculateInvocationDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number | null {
    const startedAtMs = Date.parse(invocation.startedAt);
    const finishedAtMs = Date.parse(finishedAt);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
      return invocation.durationMs || null;
    }
    return Math.max(0, finishedAtMs - startedAtMs);
  }

  private calculateTaskRunDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
    if (!taskRun.startedAt) {
      return taskRun.durationMs || null;
    }
    const startedAtMs = Date.parse(taskRun.startedAt);
    const finishedAtMs = Date.parse(finishedAt);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
      return taskRun.durationMs || null;
    }
    return Math.max(0, finishedAtMs - startedAtMs);
  }

  /**
   * Releases running Jules provider invocations whose work has already finished but whose slot
   * was never released (e.g. the session-sync terminal handler never observed the session, or a
   * dispatch crashed after claiming). Without this a leaked claim would permanently consume a
   * slot and starve the global cap.
   */
  private reconcileStaleJulesProviderInvocations(provider: ProviderId): void {
    if (provider !== "jules") {
      return;
    }

    const running = this.deps.executionRepository.listRunningProviderInvocationUsages(["jules"]);
    if (running.length === 0) {
      return;
    }

    const nowMs = Date.now();
    const reconciledAt = new Date().toISOString();

    for (const invocation of running) {
      const ageMs = nowMs - Date.parse(invocation.startedAt);
      if (!Number.isFinite(ageMs) || ageMs < STALE_JULES_PROVIDER_INVOCATION_MS) {
        continue;
      }

      const taskRun = this.deps.executionRepository.getLatestTaskRunBySessionId(invocation.sessionId);
      if (taskRun) {
        const terminal = taskRun.state === "COMPLETED" || taskRun.state === "FAILED";
        if (!terminal) {
          // The underlying Jules work is still active — keep holding the slot.
          continue;
        }
      } else if (ageMs < STALE_JULES_PROVIDER_ORPHAN_MS) {
        // No task run associated yet (claim still has a placeholder session id, or the dispatch
        // is mid-flight). Only reclaim once it is clearly abandoned.
        continue;
      }

      failStaleProviderInvocation(
        this.deps.executionRepository,
        invocation,
        [],
        {
          reconciledAt,
          recoveryReason: "provider_concurrency_stale_jules_reconcile",
          systemMessage: "Recovered stale Jules provider invocation.",
        }
      );

      this.deps.logger.warn("Recovered stale Jules provider invocation while claiming provider slot", {
        provider,
        providerInvocationId: invocation.id,
        sessionId: invocation.sessionId,
        purpose: invocation.purpose,
      });
    }
  }

  private isProviderInvocationIdle(
    linkedInvocations: ReturnType<ExecutionRepository["listExecutionInvocationsByProviderInvocationId"]>,
  ): boolean {
    const activeInvocations = linkedInvocations.filter((invocation) =>
      invocation.status === "running" || invocation.status === "paused"
    );
    if (activeInvocations.length === 0) {
      return true;
    }

    const nowMs = Date.now();
    return activeInvocations.every((invocation) => {
      const activityAt = invocation.lastMessageAt || invocation.startedAt;
      const idleMs = nowMs - Date.parse(activityAt);
      return Number.isFinite(idleMs) && idleMs >= STALE_DOCKER_PROVIDER_ACTIVITY_IDLE_MS;
    });
  }

}
