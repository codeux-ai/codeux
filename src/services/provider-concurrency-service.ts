import type { DockerContainer, ProviderId } from "../contracts/app-types.js";
import type {
  CreateProviderInvocationUsageInput,
  ProviderInvocationUsageRecord,
  ProviderInvocationPurpose,
  TaskDispatchRecord,
  TaskRunRecord,
} from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { sleepWithSignal } from "../shared/providers/provider-retry-policy.js";
import { failStaleProviderInvocation } from "../domain/runtime/provider-invocation-recovery.js";
import type { DockerContainerInventory } from "./docker-service.js";

const STALE_DOCKER_PROVIDER_INVOCATION_MS = 60_000;
const STALE_DOCKER_PROVIDER_ACTIVITY_IDLE_MS = 180_000;
// A running Jules provider invocation whose linked task run is already terminal is released
// after this age. Orphaned claims (no associated session/task run yet) are only released once
// they are clearly abandoned, to avoid reclaiming a slot mid-dispatch.
const STALE_JULES_PROVIDER_INVOCATION_MS = 60_000;
const STALE_JULES_PROVIDER_ORPHAN_MS = 600_000;
const ACTIVE_DISPATCH_STATUSES = new Set(["queued", "claimed", "running", "cancel_requested", "paused"]);
const TERMINAL_FAILURE_TASK_RUN_STATES = new Set(["FAILED", "BLOCKED", "QUOTA"]);
const RECONCILIATION_THROTTLE_MS = 10_000;
const RECONCILIATION_DOCKER_INVENTORY_TTL_MS = 10_000;
const MAX_DESTRUCTIVE_DOCKER_INVENTORY_AGE_MS = 2_000;
const ADMISSION_WAIT_HEARTBEAT_MS = 10_000;

type ProviderAdmissionWaitReason = "resource_pressure" | "provider_capacity";
type ProviderAdmissionWaitOutcome = "admitted" | "timed_out" | "cancelled" | "failed";

export interface ProviderClaimAdmissionPolicy {
  getEffectiveLimit(input: {
    provider: ProviderId;
    configuredLimit: number;
    purpose?: ProviderInvocationPurpose;
  }): number | Promise<number>;
}

type ProviderConcurrencyDockerService = {
  getContainerInventory?: (maxAgeMs?: number) => Promise<DockerContainerInventory>;
  isAvailable?: () => Promise<boolean>;
  listContainers?: () => Promise<DockerContainer[]>;
};

export interface ProviderConcurrencyServiceDeps {
  executionRepository: ExecutionRepository;
  projectManagementRepository?: Pick<ProjectManagementRepository, "getTask" | "updateTask">;
  logger: Logger;
  dockerService?: ProviderConcurrencyDockerService;
  admissionPolicy?: ProviderClaimAdmissionPolicy;
}

/**
 * Service to manage provider invocation concurrency caps globally across all projects.
 */
export class ProviderConcurrencyService {
  private readonly reconciliationLastRunMs = new Map<ProviderId, number>();
  private readonly activeReconciliations = new Map<ProviderId, Promise<boolean>>();
  private readonly capWaitLogLastRunMs = new Map<ProviderId, number>();

  constructor(private readonly deps: ProviderConcurrencyServiceDeps) {}

  /**
   * Blocks until a slot is available for the given provider according to the global cap.
   * 
   * @param provider The provider ID (e.g. "jules", "gemini")
   * @param limit The configured maximum. Production local-provider `0` delegates to adaptive
   * admission; hosted Jules and service compositions without a policy retain unbounded `0`.
   * @param signal Optional AbortSignal to cancel waiting
  */
  async waitForSlot(provider: ProviderId, limit: number, signal?: AbortSignal, maxWaitMs?: number): Promise<void> {
    const startMs = Date.now();
    let lastLogMs = 0;

    while (true) {
      this.throwIfAborted(signal);

      const effectiveLimit = await this.resolveEffectiveLimit(provider, limit);
      if (effectiveLimit === 0) {
        return;
      }
      if (maxWaitMs !== undefined && Date.now() - startMs >= maxWaitMs) {
        throw new Error(`Provider concurrency wait timed out after ${maxWaitMs}ms`);
      }

      // Count running invocations across ALL projects in the repository.
      const currentCount = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]).length;
      if (effectiveLimit > 0 && currentCount < effectiveLimit) {
        return;
      }

      const reconciled = effectiveLimit > 0
        ? await this.reconcileStaleProviderInvocations(provider)
        : false;
      if (reconciled) {
        const reconciledCount = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]).length;
        if (reconciledCount < effectiveLimit) {
          return;
        }
      }

      lastLogMs = this.logProviderCapWait(provider, effectiveLimit, currentCount, lastLogMs);

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
    maxWaitMs?: number,
    executionInvocationId?: string,
  ): Promise<ProviderInvocationUsageRecord> {
    const startMs = Date.now();
    let lastLogMs = 0;
    let lastAdmissionHeartbeatMs = 0;
    let waitReason: ProviderAdmissionWaitReason | null = null;
    const waitCycleKey = `${executionInvocationId || input.sessionId || input.taskRunId || provider}:${startMs}`;

    try {
      while (true) {
        this.throwIfAborted(signal);

        // Keep the status check and synchronous repository claim in the same event-loop turn.
        // Dashboard cancellation can therefore stop a waiting execution before it manufactures
        // provider usage or consumes capacity.
        this.assertExecutionInvocationCanClaim(executionInvocationId);
        const effectiveLimit = await this.resolveEffectiveLimit(provider, limit, input.purpose);
        if (effectiveLimit === 0) {
          const invocation = this.deps.executionRepository.createProviderInvocationUsage(input);
          this.finishAdmissionWait(input, provider, waitReason, startMs, "admitted", waitCycleKey);
          this.linkExecutionInvocation(executionInvocationId, invocation.id);
          return invocation;
        }
        if (maxWaitMs !== undefined && Date.now() - startMs >= maxWaitMs) {
          throw new Error(`Provider concurrency wait timed out after ${maxWaitMs}ms`);
        }

        let invocation = effectiveLimit > 0
          ? this.deps.executionRepository.tryCreateProviderInvocationUsage(input, effectiveLimit)
          : null;
        if (invocation) {
          this.finishAdmissionWait(input, provider, waitReason, startMs, "admitted", waitCycleKey);
          this.linkExecutionInvocation(executionInvocationId, invocation.id);
          return invocation;
        }

        // Stale recovery is only paid when the atomic claim says capacity is full.
        // A successful reconciliation gets one immediate atomic retry before sleeping.
        const reconciled = effectiveLimit > 0
          ? await this.reconcileStaleProviderInvocations(provider)
          : false;
        if (reconciled) {
          this.throwIfAborted(signal);
          this.assertExecutionInvocationCanClaim(executionInvocationId);
          invocation = this.deps.executionRepository.tryCreateProviderInvocationUsage(input, effectiveLimit);
          if (invocation) {
            this.finishAdmissionWait(input, provider, waitReason, startMs, "admitted", waitCycleKey);
            this.linkExecutionInvocation(executionInvocationId, invocation.id);
            return invocation;
          }
        }

        // Count for logging/tracking purposes. A dispatch that has already been claimed must remain
        // observably alive while adaptive admission intentionally pauses it, otherwise runtime
        // recovery and E2E stall detection cannot distinguish backpressure from a dead worker.
        const runningCount = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]).length;
        const nextWaitReason: ProviderAdmissionWaitReason = effectiveLimit < 0
          ? "resource_pressure"
          : "provider_capacity";
        const nowMs = Date.now();
        if (waitReason !== nextWaitReason || nowMs - lastAdmissionHeartbeatMs >= ADMISSION_WAIT_HEARTBEAT_MS) {
          this.recordAdmissionWait(
            input,
            provider,
            nextWaitReason,
            runningCount,
            effectiveLimit,
            nowMs - startMs,
            waitReason !== nextWaitReason,
            waitCycleKey,
          );
          lastAdmissionHeartbeatMs = nowMs;
          waitReason = nextWaitReason;
        }
        lastLogMs = this.logProviderCapWait(provider, effectiveLimit, runningCount, lastLogMs);

        let delayMs = 2000;
        if (maxWaitMs !== undefined) {
          const remainingMs = maxWaitMs - (Date.now() - startMs);
          delayMs = Math.min(delayMs, Math.max(0, remainingMs));
        }

        await sleepWithSignal(delayMs, signal);
      }
    } catch (error) {
      const outcome: ProviderAdmissionWaitOutcome = signal?.aborted
        ? "cancelled"
        : error instanceof Error && error.message.includes("concurrency wait timed out")
          ? "timed_out"
          : "failed";
      this.finishAdmissionWait(input, provider, waitReason, startMs, outcome, waitCycleKey);
      throw error;
    }
  }

  private recordAdmissionWait(
    input: CreateProviderInvocationUsageInput,
    provider: ProviderId,
    reason: ProviderAdmissionWaitReason,
    runningCount: number,
    effectiveLimit: number,
    elapsedMs: number,
    reasonChanged: boolean,
    waitCycleKey: string,
  ): void {
    try {
      if (input.dispatchId) {
        const dispatch = this.deps.executionRepository.getTaskDispatch(input.dispatchId);
        if (dispatch && ACTIVE_DISPATCH_STATUSES.has(dispatch.status)) {
          this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
            lastHeartbeatAt: new Date().toISOString(),
          });
        }
      }
      if (reasonChanged && input.taskRunId) {
        this.deps.executionRepository.appendTaskRunEvent(
          input.taskRunId,
          "provider_admission_waiting",
          "system",
          {
            provider,
            reason,
            runningCount,
            effectiveLimit: effectiveLimit < 0 ? null : effectiveLimit,
            elapsedMs,
          },
          { sourceEventKey: `provider:admission:waiting:${waitCycleKey}:${reason}` },
        );
      }
    } catch (error) {
      // Admission telemetry must never turn recoverable host pressure into a task failure.
      this.deps.logger.warn("Failed to persist provider admission wait heartbeat", {
        provider,
        dispatchId: input.dispatchId ?? null,
        taskRunId: input.taskRunId ?? null,
        error,
      });
    }
  }

  private finishAdmissionWait(
    input: CreateProviderInvocationUsageInput,
    provider: ProviderId,
    reason: ProviderAdmissionWaitReason | null,
    startMs: number,
    outcome: ProviderAdmissionWaitOutcome,
    waitCycleKey: string,
  ): void {
    if (!reason || !input.taskRunId) {
      return;
    }
    try {
      this.deps.executionRepository.appendTaskRunEvent(
        input.taskRunId,
        "provider_admission_wait_ended",
        "system",
        {
          provider,
          reason,
          outcome,
          elapsedMs: Math.max(0, Date.now() - startMs),
        },
        { sourceEventKey: `provider:admission:ended:${waitCycleKey}` },
      );
    } catch (error) {
      this.deps.logger.warn("Failed to persist provider admission wait completion", {
        provider,
        taskRunId: input.taskRunId,
        outcome,
        error,
      });
    }
  }

  private assertExecutionInvocationCanClaim(executionInvocationId: string | undefined): void {
    if (!executionInvocationId) {
      return;
    }
    const invocation = this.deps.executionRepository.getExecutionInvocation(executionInvocationId);
    if (invocation?.status === "cancelled") {
      throw new Error(`Execution invocation ${executionInvocationId} is ${invocation.status}; provider slot will not be claimed.`);
    }
  }

  private linkExecutionInvocation(executionInvocationId: string | undefined, providerInvocationId: string): void {
    if (!executionInvocationId) {
      return;
    }
    this.deps.executionRepository.updateExecutionInvocation(executionInvocationId, {
      providerInvocationId,
    });
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
    const available = await this.getAvailableCapacityCount(provider, limit);
    return available === null || available > 0;
  }

  /**
   * Returns the number of immediately claimable slots, or null when admission is
   * unbounded. Schedulers use this to avoid manufacturing more local work than
   * the configured/adaptive provider policy can currently admit; the repository
   * claim remains the final cross-process authority.
   */
  async getAvailableCapacityCount(
    provider: ProviderId,
    limit: number,
    purpose?: ProviderInvocationPurpose,
  ): Promise<number | null> {
    const effectiveLimit = await this.resolveEffectiveLimit(provider, limit, purpose);
    if (effectiveLimit < 0) {
      return 0;
    }
    if (effectiveLimit === 0) {
      return null;
    }

    const counts = this.getGlobalRunningCounts([provider]);
    let current = counts[provider] || 0;
    if (current >= effectiveLimit && await this.reconcileStaleProviderInvocations(provider)) {
      const reconciledCounts = this.getGlobalRunningCounts([provider]);
      current = reconciledCounts[provider] || 0;
    }
    return Math.max(0, effectiveLimit - current);
  }

  async tryClaimSlot(
    provider: ProviderId,
    limit: number,
    input: CreateProviderInvocationUsageInput,
  ): Promise<ProviderInvocationUsageRecord | null> {
    const effectiveLimit = await this.resolveEffectiveLimit(provider, limit, input.purpose);
    if (effectiveLimit < 0) {
      return null;
    }
    if (effectiveLimit === 0) {
      return this.deps.executionRepository.createProviderInvocationUsage(input);
    }

    let invocation = this.deps.executionRepository.tryCreateProviderInvocationUsage(input, effectiveLimit);
    if (invocation) {
      return invocation;
    }

    const reconciled = await this.reconcileStaleProviderInvocations(provider);
    if (!reconciled) {
      return null;
    }
    invocation = this.deps.executionRepository.tryCreateProviderInvocationUsage(input, effectiveLimit);
    return invocation;
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

    this.deps.logger.info(
      limit < 0
        ? "Provider admission paused by host resource pressure"
        : "Provider concurrency cap reached, waiting for slot",
      {
        provider,
        ...(limit >= 0 ? { limit } : {}),
        currentCount,
      },
    );
    this.capWaitLogLastRunMs.set(provider, now);
    return now;
  }

  private async resolveEffectiveLimit(
    provider: ProviderId,
    configuredLimit: number,
    purpose?: ProviderInvocationPurpose,
  ): Promise<number> {
    const candidate = this.deps.admissionPolicy
      ? await this.deps.admissionPolicy.getEffectiveLimit({ provider, configuredLimit, purpose })
      : configuredLimit;
    if (!Number.isFinite(candidate)) {
      throw new Error(`Provider admission policy returned an invalid limit for ${provider}.`);
    }
    const normalized = Math.floor(candidate);
    // Admission policies use -1 to pause new claims under pressure. Zero retains
    // the public provider-setting meaning of unbounded admission (hosted Jules or
    // a service composed without an adaptive policy).
    return normalized < 0 ? -1 : normalized;
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) {
      return;
    }
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error(String(signal.reason || "AbortSignal triggered"));
  }

  private async reconcileStaleProviderInvocations(provider: ProviderId): Promise<boolean> {
    const active = this.activeReconciliations.get(provider);
    if (active) {
      return active;
    }

    const nowMs = Date.now();
    const lastRunMs = this.reconciliationLastRunMs.get(provider) || 0;
    if (nowMs - lastRunMs < RECONCILIATION_THROTTLE_MS) {
      return false;
    }

    this.reconciliationLastRunMs.set(provider, nowMs);

    const reconciliation = (async (): Promise<boolean> => {
      try {
        const dockerRecovered = await this.reconcileStaleDockerProviderInvocations(provider);
        const julesRecovered = this.reconcileStaleJulesProviderInvocations(provider);
        return dockerRecovered || julesRecovered;
      } finally {
        this.activeReconciliations.delete(provider);
      }
    })();

    this.activeReconciliations.set(provider, reconciliation);
    return reconciliation;
  }

  private async reconcileStaleDockerProviderInvocations(provider: ProviderId): Promise<boolean> {
    if (provider === "jules" || !this.deps.dockerService) {
      return false;
    }

    const running = this.deps.executionRepository.listRunningProviderInvocationUsages([provider])
      .filter((invocation) => invocation.executionMode === "DOCKER");
    if (running.length === 0) {
      return false;
    }

    const inventory = await this.readDockerContainerInventory();
    if (!inventory.available) {
      return false;
    }
    // A shared snapshot may intentionally be reused for non-destructive reads for
    // ten seconds. Do not use an older snapshot as proof that a container is gone;
    // another process may have launched it after that inventory was collected.
    if (Date.now() - inventory.fetchedAtMs > MAX_DESTRUCTIVE_DOCKER_INVENTORY_AGE_MS) {
      return false;
    }

    const activeSessionIds = new Set(
      inventory.containers
        .map((container) => container.labels?.["code-ux.session-id"]?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    );
    const nowMs = Date.now();
    const reconciledAt = new Date().toISOString();
    let recovered = false;

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
        recovered = true;
        continue;
      }
      if (terminalStatus === "failed") {
        this.failDockerProviderInvocation(invocation, linkedInvocations, reconciledAt, provider);
        recovered = true;
        continue;
      }

      if (!this.isProviderInvocationIdle(linkedInvocations)) {
        continue;
      }

      this.failDockerProviderInvocation(invocation, linkedInvocations, reconciledAt, provider);
      recovered = true;
    }
    return recovered;
  }

  private async readDockerContainerInventory(): Promise<DockerContainerInventory> {
    const dockerService = this.deps.dockerService;
    if (!dockerService) {
      return { available: false, containers: [], fetchedAtMs: Date.now() };
    }
    if (dockerService.getContainerInventory) {
      return dockerService.getContainerInventory(RECONCILIATION_DOCKER_INVENTORY_TTL_MS)
        .catch(() => ({ available: false, containers: [], fetchedAtMs: Date.now() }));
    }

    // Compatibility for focused test doubles and embedders that implement the
    // previous two-call DockerService shape. The production service uses the
    // unified inventory API above.
    const available = dockerService.isAvailable
      ? await dockerService.isAvailable().catch(() => false)
      : false;
    if (!available) {
      return { available: false, containers: [], fetchedAtMs: Date.now() };
    }
    if (!dockerService.listContainers) {
      return { available: false, containers: [], fetchedAtMs: Date.now() };
    }
    try {
      const containers = await dockerService.listContainers();
      return { available: true, containers, fetchedAtMs: Date.now() };
    } catch {
      return { available: false, containers: [], fetchedAtMs: Date.now() };
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
  private reconcileStaleJulesProviderInvocations(provider: ProviderId): boolean {
    if (provider !== "jules") {
      return false;
    }

    const running = this.deps.executionRepository.listRunningProviderInvocationUsages(["jules"]);
    if (running.length === 0) {
      return false;
    }

    const nowMs = Date.now();
    const reconciledAt = new Date().toISOString();
    let recovered = false;

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
      recovered = true;

      this.deps.logger.warn("Recovered stale Jules provider invocation while claiming provider slot", {
        provider,
        providerInvocationId: invocation.id,
        sessionId: invocation.sessionId,
        purpose: invocation.purpose,
      });
    }
    return recovered;
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
