import type { ProviderId } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, CreateProviderInvocationUsageInput } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { sleepWithSignal } from "../shared/providers/provider-retry-policy.js";

export interface ProviderConcurrencyServiceDeps {
  executionRepository: ExecutionRepository;
  logger: Logger;
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
}
