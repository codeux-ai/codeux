import * as os from "node:os";
import type { ProviderId } from "../contracts/app-types.js";
import type { ProviderInvocationPurpose, ProviderInvocationUsageRecord } from "../contracts/execution-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ProviderClaimAdmissionPolicy } from "./provider-concurrency-service.js";

const GIB = 1024 ** 3;
const DEFAULT_SAMPLE_TTL_MS = 1_000;
const ESTIMATED_ACTIVE_PROVIDER_BYTES = 2.5 * GIB;
const MIN_RESERVED_MEMORY_BYTES = 4 * GIB;
const RESERVED_MEMORY_RATIO = 0.15;
const CONSTRAINED_LOAD_PER_CPU = 0.9;
const CRITICAL_LOAD_PER_CPU = 1.5;
const CONSTRAINED_FREE_MEMORY_RATIO = 0.15;
const CRITICAL_FREE_MEMORY_RATIO = 0.07;

const INTERACTIVE_PURPOSES = new Set<ProviderInvocationPurpose>([
  "worker_reply",
  "dashboard_reply",
  "clarification_reply",
]);

export type ResourcePressureLevel = "healthy" | "constrained" | "critical";

export interface ProviderAdmissionResourceSnapshot {
  cpuCount: number;
  loadOneMinute: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  sampledAtMs: number;
  /** Raw free-memory pressure is not portable: Darwin excludes readily reclaimable cache. */
  platform?: NodeJS.Platform;
}

export interface ProviderAdmissionResourceSource {
  sample(): ProviderAdmissionResourceSnapshot;
}

interface AdaptiveProviderAdmissionPolicyDeps {
  executionRepository: {
    listRunningProviderInvocationUsages(providers?: string[]): ProviderInvocationUsageRecord[];
  };
  logger?: Pick<Logger, "info">;
  resourceSource?: ProviderAdmissionResourceSource;
  sampleTtlMs?: number;
  now?: () => number;
}

class OsProviderAdmissionResourceSource implements ProviderAdmissionResourceSource {
  sample(): ProviderAdmissionResourceSnapshot {
    return {
      cpuCount: Math.max(1, os.availableParallelism?.() || os.cpus().length || 1),
      loadOneMinute: Math.max(0, os.loadavg()[0] || 0),
      totalMemoryBytes: Math.max(1, os.totalmem()),
      freeMemoryBytes: Math.max(0, os.freemem()),
      sampledAtMs: Date.now(),
      platform: process.platform,
    };
  }
}

/**
 * Keeps provider starts work-conserving while preventing an unlimited launch wave from pushing the
 * host into swap and Docker control-plane collapse. The policy never shells out: resource samples
 * are cheap, cached OS reads and the final limit is still enforced atomically by SQLite.
 */
export class AdaptiveProviderAdmissionPolicy implements ProviderClaimAdmissionPolicy {
  private readonly resourceSource: ProviderAdmissionResourceSource;
  private readonly sampleTtlMs: number;
  private readonly now: () => number;
  private cachedSnapshot: ProviderAdmissionResourceSnapshot | null = null;
  private lastPressureLevel: ResourcePressureLevel | null = null;

  constructor(private readonly deps: AdaptiveProviderAdmissionPolicyDeps) {
    this.resourceSource = deps.resourceSource ?? new OsProviderAdmissionResourceSource();
    this.sampleTtlMs = Math.max(100, Math.floor(deps.sampleTtlMs ?? DEFAULT_SAMPLE_TTL_MS));
    this.now = deps.now ?? Date.now;
  }

  getEffectiveLimit(input: {
    provider: ProviderId;
    configuredLimit: number;
    purpose?: ProviderInvocationPurpose;
  }): number {
    // Jules executes remotely and does not consume a local Docker/CPU budget.
    if (input.provider === "jules") {
      return this.normalizeConfiguredLimit(input.configuredLimit);
    }

    const snapshot = this.getSnapshot();
    const pressure = this.getPressure(snapshot);
    this.logPressureTransition(pressure, snapshot);

    const automaticLimit = this.getAutomaticLimit(snapshot);
    const configuredLimit = this.normalizeConfiguredLimit(input.configuredLimit);
    const hardLimit = configuredLimit > 0
      ? Math.min(configuredLimit, automaticLimit)
      : automaticLimit;
    const isInteractive = input.purpose ? INTERACTIVE_PURPOSES.has(input.purpose) : false;

    if (pressure === "healthy") {
      // Leave one claim available for a human-facing reply instead of allowing background coding
      // and CI to occupy every automatically calculated slot.
      return isInteractive ? hardLimit : Math.max(1, hardLimit - 1);
    }

    const running = this.deps.executionRepository.listRunningProviderInvocationUsages([input.provider]);
    const runningCount = running.length;
    const hasReliableCriticalMemoryPressure = this.hasReliableCriticalMemoryPressure(snapshot);
    if (pressure === "critical") {
      // Linux load includes runnable and uninterruptible/I/O-wait work. A CI burst can therefore
      // report extreme load while CPU time is still available. Preserve the reply reservation
      // unless memory is critically low; the explicit/automatic hard limit still cannot be crossed.
      if (
        isInteractive
        && !hasReliableCriticalMemoryPressure
        && !running.some((invocation) => INTERACTIVE_PURPOSES.has(invocation.purpose))
      ) {
        return Math.max(1, Math.min(hardLimit, runningCount + 1));
      }
      // Host load can be generated by CI or other applications and may never return to "healthy"
      // while Code UX has no provider running. Keep one work-conserving slot so adaptive admission
      // cannot deadlock at zero; only a reliable critically-low-memory signal may pause all starts.
      return runningCount > 0
        ? Math.min(hardLimit, runningCount)
        : hasReliableCriticalMemoryPressure ? -1 : 1;
    }

    if (isInteractive && !running.some((invocation) => INTERACTIVE_PURPOSES.has(invocation.purpose))) {
      return Math.max(1, Math.min(hardLimit, runningCount + 1));
    }

    // Freeze background expansion at the current load. Existing providers keep running; new work
    // resumes automatically as soon as the cached pressure sample becomes healthy.
    return runningCount > 0 ? Math.min(hardLimit, runningCount) : 1;
  }

  private getSnapshot(): ProviderAdmissionResourceSnapshot {
    const now = this.now();
    if (this.cachedSnapshot && now - this.cachedSnapshot.sampledAtMs < this.sampleTtlMs) {
      return this.cachedSnapshot;
    }
    this.cachedSnapshot = this.resourceSource.sample();
    return this.cachedSnapshot;
  }

  private getAutomaticLimit(snapshot: ProviderAdmissionResourceSnapshot): number {
    const cpuLimit = Math.max(1, Math.floor(snapshot.cpuCount / 2));
    const reservedMemory = Math.max(
      MIN_RESERVED_MEMORY_BYTES,
      snapshot.totalMemoryBytes * RESERVED_MEMORY_RATIO,
    );
    const memoryBudget = Math.max(ESTIMATED_ACTIVE_PROVIDER_BYTES, snapshot.totalMemoryBytes - reservedMemory);
    const memoryLimit = Math.max(1, Math.floor(memoryBudget / ESTIMATED_ACTIVE_PROVIDER_BYTES));
    return Math.max(1, Math.min(cpuLimit, memoryLimit));
  }

  private getPressure(snapshot: ProviderAdmissionResourceSnapshot): ResourcePressureLevel {
    const loadPerCpu = snapshot.loadOneMinute / Math.max(1, snapshot.cpuCount);
    const freeMemoryRatio = snapshot.freeMemoryBytes / Math.max(1, snapshot.totalMemoryBytes);
    const memoryPressureReliable = snapshot.platform !== "darwin";
    if (
      loadPerCpu >= CRITICAL_LOAD_PER_CPU
      || (memoryPressureReliable && freeMemoryRatio <= CRITICAL_FREE_MEMORY_RATIO)
    ) {
      return "critical";
    }
    if (
      loadPerCpu >= CONSTRAINED_LOAD_PER_CPU
      || (memoryPressureReliable && freeMemoryRatio <= CONSTRAINED_FREE_MEMORY_RATIO)
    ) {
      return "constrained";
    }
    return "healthy";
  }

  private hasReliableCriticalMemoryPressure(snapshot: ProviderAdmissionResourceSnapshot): boolean {
    if (snapshot.platform === "darwin") {
      return false;
    }
    return snapshot.freeMemoryBytes / Math.max(1, snapshot.totalMemoryBytes) <= CRITICAL_FREE_MEMORY_RATIO;
  }

  private logPressureTransition(
    pressure: ResourcePressureLevel,
    snapshot: ProviderAdmissionResourceSnapshot,
  ): void {
    if (pressure === this.lastPressureLevel) {
      return;
    }
    this.lastPressureLevel = pressure;
    this.deps.logger?.info("Provider admission resource pressure changed", {
      pressure,
      cpuCount: snapshot.cpuCount,
      loadOneMinute: Number(snapshot.loadOneMinute.toFixed(2)),
      freeMemoryMb: Math.round(snapshot.freeMemoryBytes / 1024 ** 2),
      totalMemoryMb: Math.round(snapshot.totalMemoryBytes / 1024 ** 2),
      memoryPressureReliable: snapshot.platform !== "darwin",
    });
  }

  private normalizeConfiguredLimit(limit: number): number {
    return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  }
}
