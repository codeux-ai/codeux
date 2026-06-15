import type { DockerContainer, ProviderId } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, CreateProviderInvocationUsageInput } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { sleepWithSignal } from "../shared/providers/provider-retry-policy.js";

const STALE_DOCKER_PROVIDER_INVOCATION_MS = 60_000;
const STALE_DOCKER_PROVIDER_ACTIVITY_IDLE_MS = 180_000;
// A running Jules provider invocation whose linked task run is already terminal is released
// after this age. Orphaned claims (no associated session/task run yet) are only released once
// they are clearly abandoned, to avoid reclaiming a slot mid-dispatch.
const STALE_JULES_PROVIDER_INVOCATION_MS = 60_000;
const STALE_JULES_PROVIDER_ORPHAN_MS = 600_000;

export interface ProviderConcurrencyServiceDeps {
  executionRepository: ExecutionRepository;
  logger: Logger;
  dockerService?: Pick<{ isAvailable: () => Promise<boolean>; listContainers: () => Promise<DockerContainer[]> }, "isAvailable" | "listContainers">;
}

/**
 * Service to manage provider invocation concurrency caps globally across all projects.
 */
export class ProviderConcurrencyService {
  constructor(private readonly deps: ProviderConcurrencyServiceDeps) {}

  /**
   * Blocks until a slot is available for the given provider according to the global cap.
   * 
   * @param provider The provider ID (e.g. "jules", "gemini")
   * @param limit The maximum number of concurrent invocations allowed (0 = infinite)
   * @param signal Optional AbortSignal to cancel waiting
   */
  async waitForSlot(provider: ProviderId, limit: number, signal?: AbortSignal, maxWaitMs?: number): Promise<void> {
    if (limit <= 0) return;

    const startMs = Date.now();
    let lastLogMs = 0;

    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || "AbortSignal triggered"));
      }

      if (maxWaitMs !== undefined && Date.now() - startMs >= maxWaitMs) {
        throw new Error(`Provider concurrency wait timed out after ${maxWaitMs}ms`);
      }

      await this.reconcileStaleDockerProviderInvocations(provider);

      // Count running invocations across ALL projects in the repository
      const runningInvocations = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]);
      const currentCount = runningInvocations.length;

      if (currentCount < limit) {
        return;
      }

      const now = Date.now();
      if (now - lastLogMs >= 10000) {
        this.deps.logger.info("Provider concurrency cap reached, waiting for slot", {
          provider,
          limit,
          currentCount,
        });
        lastLogMs = now;
      }

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
      return this.deps.executionRepository.createProviderInvocationUsage(input);
    }

    const startMs = Date.now();
    let lastLogMs = 0;

    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || "AbortSignal triggered"));
      }

      if (maxWaitMs !== undefined && Date.now() - startMs >= maxWaitMs) {
        throw new Error(`Provider concurrency wait timed out after ${maxWaitMs}ms`);
      }

      await this.reconcileStaleDockerProviderInvocations(provider);

      const invocation = this.deps.executionRepository.tryCreateProviderInvocationUsage(input, limit);
      if (invocation) {
        return invocation;
      }

      const now = Date.now();
      if (now - lastLogMs >= 10000) {
        // Count for logging/tracking purposes
        const runningCount = this.deps.executionRepository.listRunningProviderInvocationUsages([provider]).length;

        this.deps.logger.info("Provider concurrency cap reached, waiting for slot", {
          provider,
          limit,
          currentCount: runningCount,
        });
        lastLogMs = now;
      }

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
  async tryClaimSlot(
    provider: ProviderId,
    limit: number,
    input: CreateProviderInvocationUsageInput,
  ): Promise<ProviderInvocationUsageRecord | null> {
    if (limit <= 0) {
      return this.deps.executionRepository.createProviderInvocationUsage(input);
    }

    await this.reconcileStaleDockerProviderInvocations(provider);
    this.reconcileStaleJulesProviderInvocations(provider);

    return this.deps.executionRepository.tryCreateProviderInvocationUsage(input, limit);
  }

  /**
   * Returns the current running invocation counts per provider across all projects.
   */
  getGlobalRunningCounts(providers?: string[]): Record<string, number> {
    const running = this.deps.executionRepository.listRunningProviderInvocationUsages(providers);
    const counts: Record<string, number> = {};
    for (const inv of running) {
      if (inv.provider) {
        counts[inv.provider] = (counts[inv.provider] || 0) + 1;
      }
    }
    return counts;
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
    const reconciledAt = new Date().toISOString();

    for (const invocation of running) {
      if (activeSessionIds.has(invocation.sessionId)) {
        continue;
      }

      const ageMs = Date.now() - Date.parse(invocation.startedAt);
      if (!Number.isFinite(ageMs) || ageMs < STALE_DOCKER_PROVIDER_INVOCATION_MS) {
        continue;
      }

      const linkedInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id);
      if (!this.isProviderInvocationIdle(linkedInvocations)) {
        continue;
      }

      const message = `Recovered stale ${invocation.purpose} provider invocation after its Docker container disappeared for session ${invocation.sessionId}. Code UX will retry the work.`;
      this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
        status: "failed",
        finishedAt: reconciledAt,
        durationMs: this.calculateDurationMs(invocation, reconciledAt),
      });

      for (const executionInvocation of linkedInvocations) {
        if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
          continue;
        }
        this.deps.executionRepository.updateExecutionInvocation(executionInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          errorMessage: message,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(executionInvocation.id, {
          role: "system",
          contentMarkdown: message,
          metadata: {
            recovery: "provider_concurrency_stale_docker_reconcile",
            providerInvocationId: invocation.id,
            provider,
          },
          createdAt: reconciledAt,
        });
      }

      this.deps.logger.warn("Recovered stale Docker provider invocation while waiting for provider slot", {
        provider,
        providerInvocationId: invocation.id,
        sessionId: invocation.sessionId,
        purpose: invocation.purpose,
      });
    }
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

      this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
        status: "failed",
        finishedAt: reconciledAt,
        durationMs: this.calculateDurationMs(invocation, reconciledAt),
      });

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

  private calculateDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number {
    const startedAtMs = Date.parse(invocation.startedAt);
    const finishedAtMs = Date.parse(finishedAt);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
      return invocation.durationMs || 0;
    }
    return Math.max(0, finishedAtMs - startedAtMs);
  }
}
