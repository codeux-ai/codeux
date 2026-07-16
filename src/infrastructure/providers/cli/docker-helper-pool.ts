import {
  type CommandResult,
  runStreamingCommand,
  type StreamingCommandOptions,
} from "../../../services/cli-process-runner.js";
import { getRuntimeOwnerId } from "../../../shared/config/runtime-owner.js";
import pLimit from "p-limit";

/** Options accepted by the host-side process that invokes Docker. */
export type HelperRunnerOptions = StreamingCommandOptions;

export type HelperCommandRunner = (
  command: string,
  args: string[],
  options?: HelperRunnerOptions,
) => Promise<CommandResult>;

export const defaultHelperRunner: HelperCommandRunner = (command, args, options = {}) =>
  runStreamingCommand(command, args, process.cwd(), process.env, options);

/** Shared docker label so every persistent helper container can be reaped together. */
export const HELPER_LABEL = "code-ux.helper";

/** Suffix helper names so runtimes backed by different state homes cannot replace each other. */
export const HELPER_OWNER_NAME_SUFFIX = getRuntimeOwnerId().slice(0, 12);
const HELPER_DOCKER_LIFECYCLE_CONCURRENCY = 4;
const helperDockerLifecycleLimit = pLimit(HELPER_DOCKER_LIFECYCLE_CONCURRENCY);

export interface HelperPoolSpec {
  /** Deterministic container name for a pool key (used so a previous process's helper is reclaimed). */
  nameFor: (key: string) => string;
  /** `docker run -d ...` args (including --name, labels, mounts, image and keep-alive command). */
  buildCreateArgs: (key: string, name: string) => string[];
  idleTtlMs?: number;
  reapIntervalMs?: number;
  /** Hard bound for tracked helper generations. Idle helpers are evicted before admission waits. */
  maxContainers?: number;
}

interface HelperEntry {
  id: string;
  lastUsed: number;
  activeUses: number;
  creating?: Promise<string>;
  releasing: boolean;
  idleWaiters: Set<() => void>;
}

/**
 * Generic manager for short-lived Docker sidecars keyed by an arbitrary string.
 *
 * Containers are created lazily, shared while commands are active, and removed after a bounded
 * idle window. {@link withContainer} pins a container generation for the duration of a command so
 * neither the idle reaper nor an explicit {@link release} can remove it in flight. Callers that
 * only need lifecycle compatibility may still use {@link ensure}, but command execution should use
 * {@link withContainer}.
 */
export class DockerHelperContainerPool {
  private readonly helpers = new Map<string, HelperEntry>();
  private readonly releases = new Map<string, Promise<void>>();
  private readonly reservations = new Map<string, number>();
  private reaper: NodeJS.Timeout | null = null;
  private readonly idleTtlMs: number;
  private readonly reapIntervalMs: number;
  private readonly maxContainers: number;
  private readonly capacityWaiters = new Set<() => void>();
  private shuttingDown = false;

  constructor(
    private readonly spec: HelperPoolSpec,
    private readonly runner: HelperCommandRunner = defaultHelperRunner,
  ) {
    this.idleTtlMs = spec.idleTtlMs ?? 120_000;
    this.reapIntervalMs = spec.reapIntervalMs ?? 60_000;
    this.maxContainers = spec.maxContainers ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs < 0) {
      throw new Error("Helper idle TTL must be a finite non-negative number.");
    }
    if (!Number.isFinite(this.reapIntervalMs) || this.reapIntervalMs <= 0) {
      throw new Error("Helper reap interval must be a finite positive number.");
    }
    if (this.maxContainers !== Number.POSITIVE_INFINITY
      && (!Number.isInteger(this.maxContainers) || this.maxContainers <= 0)) {
      throw new Error("Helper container capacity must be a positive integer.");
    }
  }

  /** Returns the id of the live helper container for `key`, creating it if necessary. */
  async ensure(key: string): Promise<string> {
    for (;;) {
      if (this.shuttingDown) {
        throw new Error("Helper container pool is shutting down.");
      }

      const releasing = this.releases.get(key);
      if (releasing) {
        await releasing;
        continue;
      }

      const existing = this.helpers.get(key);
      if (existing?.creating) {
        return existing.creating;
      }
      if (existing && !existing.releasing) {
        existing.lastUsed = Date.now();
        return existing.id;
      }

      if (this.helpers.size >= this.maxContainers) {
        const idleKey = this.findLeastRecentlyUsedIdleKey();
        if (idleKey !== undefined) {
          await this.release(idleKey);
        } else {
          await this.waitForCapacity();
        }
        continue;
      }

      const entry: HelperEntry = {
        id: "",
        lastUsed: Date.now(),
        activeUses: 0,
        releasing: false,
        idleWaiters: new Set(),
      };
      const creating = this.create(key);
      entry.creating = creating;
      this.helpers.set(key, entry);
      try {
        const id = await creating;
        const current = this.helpers.get(key);
        if (this.shuttingDown || current !== entry || entry.releasing) {
          await this.removeContainerWithVolumes(id || this.spec.nameFor(key));
          throw new Error("Helper container was released before startup completed.");
        }
        entry.id = id;
        entry.creating = undefined;
        entry.lastUsed = Date.now();
        this.startReaper();
        return id;
      } catch (error) {
        if (this.helpers.get(key) === entry) {
          this.helpers.delete(key);
          this.notifyCapacityWaiters();
        }
        throw error;
      }
    }
  }

  /**
   * Pins one container generation while `operation` runs. Idle and explicit cleanup wait until the
   * operation settles. A generation removed between `ensure` and pinning is retried transparently.
   */
  async withContainer<T>(key: string, operation: (containerId: string) => Promise<T>): Promise<T> {
    for (;;) {
      const id = await this.ensure(key);
      const entry = this.helpers.get(key);
      if (!entry || entry.creating || entry.releasing || entry.id !== id) {
        const releasing = this.releases.get(key);
        if (releasing) {
          await releasing;
        }
        continue;
      }

      entry.activeUses += 1;
      entry.lastUsed = Date.now();
      try {
        return await operation(id);
      } finally {
        entry.activeUses = Math.max(0, entry.activeUses - 1);
        entry.lastUsed = Date.now();
        if (entry.activeUses === 0) {
          for (const resolve of entry.idleWaiters) {
            resolve();
          }
          entry.idleWaiters.clear();
          this.notifyCapacityWaiters();
        }
      }
    }
  }

  /**
   * Protects the helper generation for `key` from capacity eviction and idle reaping across a
   * logical workflow. The reservation does not create a container or consume capacity until the
   * first command needs one. Callers must release the returned lease when that workflow settles.
   */
  reserve(key: string): () => void {
    if (this.shuttingDown) {
      throw new Error("Helper container pool is shutting down.");
    }
    this.reservations.set(key, (this.reservations.get(key) || 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const remaining = (this.reservations.get(key) || 1) - 1;
      if (remaining > 0) {
        this.reservations.set(key, remaining);
      } else {
        this.reservations.delete(key);
        this.notifyCapacityWaiters();
      }
    };
  }

  /** Marks the helper for `key` as recently used so the idle reaper leaves it alone. */
  touch(key: string): void {
    const entry = this.helpers.get(key);
    if (entry && !entry.creating && !entry.releasing) {
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Drops the tracked helper generation for `key` without removing the container (used before a
   * retry). With `expectedId`, a concurrent replacement is left intact.
   */
  invalidate(key: string, expectedId?: string): boolean {
    const current = this.helpers.get(key);
    if (!current || current.releasing) {
      return false;
    }
    if (expectedId !== undefined && (current.creating !== undefined || current.id !== expectedId)) {
      return false;
    }
    this.helpers.delete(key);
    this.notifyCapacityWaiters();
    return true;
  }

  /**
   * Removes the helper for `key` after its active commands settle. Concurrent releases share one
   * drain operation, and new acquisitions wait for that operation before creating a replacement.
   */
  async release(key: string): Promise<void> {
    const existingRelease = this.releases.get(key);
    if (existingRelease) {
      await existingRelease;
      return;
    }

    const releasePromise = this.releaseGeneration(key);
    this.releases.set(key, releasePromise);
    try {
      await releasePromise;
    } finally {
      if (this.releases.get(key) === releasePromise) {
        this.releases.delete(key);
      }
    }
  }

  /** Removes every helper after active commands finish (call on graceful shutdown). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.reservations.clear();
    this.notifyCapacityWaiters();
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
    const keys = new Set([...this.helpers.keys(), ...this.releases.keys()]);
    await Promise.all([...keys].map((key) => this.release(key)));
  }

  isContainerGone(result: CommandResult): boolean {
    const text = `${result.stderr || ""} ${result.stdout || ""}`.toLowerCase();
    return text.includes("no such container")
      || text.includes("is not running")
      || text.includes("no such object");
  }

  private async create(key: string): Promise<string> {
    const name = this.spec.nameFor(key);
    const createArgs = this.spec.buildCreateArgs(key, name);
    let result = await helperDockerLifecycleLimit(() => this.runner("docker", createArgs));
    if (!result.ok && this.isContainerNameConflict(result)) {
      // A deterministic name can survive a crashed process. Reclaim only when Docker proves that
      // this exact create collided; speculative removal doubles control-plane mutations in wide DAGs.
      await this.removeContainerWithVolumes(name);
      result = await helperDockerLifecycleLimit(() => this.runner("docker", createArgs));
    }
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Failed to start helper container.");
    }
    return (result.stdout || "").trim() || name;
  }

  private isContainerNameConflict(result: CommandResult): boolean {
    const text = `${result.stderr || ""} ${result.stdout || ""}`.toLowerCase();
    return text.includes("container name") && text.includes("already in use");
  }

  private async releaseGeneration(key: string): Promise<void> {
    const entry = this.helpers.get(key);
    if (entry) {
      entry.releasing = true;
      if (entry.creating) {
        await entry.creating.catch(() => undefined);
      }
      await this.waitForIdle(entry);
    }

    try {
      // Acquisitions for this key remain blocked by `releases`, so one exact generation reference
      // is sufficient. A create that was interrupted before publishing its id falls back to the
      // deterministic name while the ensure path separately reaps any late id it observed.
      await this.removeContainerWithVolumes(entry?.id || this.spec.nameFor(key));
    } finally {
      // Keep the releasing generation in the capacity count until Docker removal has settled. This
      // prevents a wide waiter set from creating replacements while the old containers still exist.
      if (entry && this.helpers.get(key) === entry) {
        this.helpers.delete(key);
        this.notifyCapacityWaiters();
      }
    }
  }

  private waitForIdle(entry: HelperEntry): Promise<void> {
    if (entry.activeUses === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      entry.idleWaiters.add(resolve);
    });
  }

  private findLeastRecentlyUsedIdleKey(): string | undefined {
    let candidate: { key: string; lastUsed: number } | undefined;
    for (const [key, entry] of this.helpers) {
      if (entry.creating || entry.releasing || entry.activeUses > 0 || this.reservations.has(key)) {
        continue;
      }
      if (!candidate || entry.lastUsed < candidate.lastUsed) {
        candidate = { key, lastUsed: entry.lastUsed };
      }
    }
    return candidate?.key;
  }

  private waitForCapacity(): Promise<void> {
    if (this.shuttingDown || this.helpers.size < this.maxContainers
      || this.findLeastRecentlyUsedIdleKey() !== undefined) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.capacityWaiters.add(resolve);
    });
  }

  private notifyCapacityWaiters(): void {
    for (const resolve of this.capacityWaiters) {
      resolve();
    }
    this.capacityWaiters.clear();
  }

  private startReaper(): void {
    if (this.reaper) {
      return;
    }
    this.reaper = setInterval(() => {
      void this.reapIdle();
    }, this.reapIntervalMs);
    if (typeof this.reaper.unref === "function") {
      this.reaper.unref();
    }
  }

  private async reapIdle(): Promise<void> {
    const now = Date.now();
    const removals: Array<Promise<void>> = [];
    for (const [key, entry] of [...this.helpers.entries()]) {
      if (entry.creating || entry.releasing || entry.activeUses > 0 || this.reservations.has(key)
        || now - entry.lastUsed < this.idleTtlMs) {
        continue;
      }
      removals.push(this.release(key));
    }
    await Promise.all(removals);
    if (this.helpers.size === 0 && this.releases.size === 0 && this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }

  private async removeContainerWithVolumes(containerRef: string): Promise<void> {
    await helperDockerLifecycleLimit(
      () => this.runner("docker", ["rm", "-f", "-v", containerRef]),
    ).catch(() => undefined);
  }
}
