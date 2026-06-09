import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";

export type HelperCommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export const defaultHelperRunner: HelperCommandRunner = (command, args) =>
  runStreamingCommand(command, args, process.cwd(), process.env);

/** Shared docker label so every persistent helper container can be reaped together. */
export const HELPER_LABEL = "code-ux.helper";

export interface HelperPoolSpec {
  /** Deterministic container name for a pool key (used so a previous process's helper is reclaimed). */
  nameFor: (key: string) => string;
  /** `docker run -d …` args (including --name, label, mounts, image and keep-alive entrypoint). */
  buildCreateArgs: (key: string, name: string) => string[];
  idleTtlMs?: number;
  reapIntervalMs?: number;
}

interface HelperEntry {
  id: string;
  lastUsed: number;
  creating?: Promise<string>;
}

/**
 * Generic manager for long-lived `docker` helper containers keyed by an arbitrary string.
 * Containers are created lazily, reused across operations, reaped after an idle window, and
 * recreated transparently if they disappear. Callers run their actual work via `docker exec`
 * into {@link ensure}'s container id; this class only owns lifecycle.
 */
export class DockerHelperContainerPool {
  private readonly helpers = new Map<string, HelperEntry>();
  private reaper: NodeJS.Timeout | null = null;
  private readonly idleTtlMs: number;
  private readonly reapIntervalMs: number;

  constructor(
    private readonly spec: HelperPoolSpec,
    private readonly runner: HelperCommandRunner = defaultHelperRunner,
  ) {
    this.idleTtlMs = spec.idleTtlMs ?? 120_000;
    this.reapIntervalMs = spec.reapIntervalMs ?? 60_000;
  }

  /** Returns the id of the live helper container for `key`, creating it if necessary. */
  async ensure(key: string): Promise<string> {
    const existing = this.helpers.get(key);
    if (existing?.creating) {
      return existing.creating;
    }
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.id;
    }

    const creating = this.create(key);
    this.helpers.set(key, { id: "", lastUsed: Date.now(), creating });
    try {
      const id = await creating;
      this.helpers.set(key, { id, lastUsed: Date.now() });
      this.startReaper();
      return id;
    } catch (error) {
      this.helpers.delete(key);
      throw error;
    }
  }

  /** Marks the helper for `key` as recently used so the idle reaper leaves it alone. */
  touch(key: string): void {
    const entry = this.helpers.get(key);
    if (entry && !entry.creating) {
      entry.lastUsed = Date.now();
    }
  }

  /** Drops the tracked helper for `key` without removing the container (used before a retry). */
  invalidate(key: string): void {
    this.helpers.delete(key);
  }

  /** Removes the helper container for `key` (by tracked id and by deterministic name). */
  async release(key: string): Promise<void> {
    const entry = this.helpers.get(key);
    this.helpers.delete(key);
    await this.runner("docker", ["rm", "-f", this.spec.nameFor(key)]).catch(() => undefined);
    if (entry?.creating) {
      await entry.creating.catch(() => undefined);
      await this.runner("docker", ["rm", "-f", this.spec.nameFor(key)]).catch(() => undefined);
    }
  }

  /** Removes every helper container this pool is tracking (call on graceful shutdown). */
  async shutdown(): Promise<void> {
    const entries = [...this.helpers.values()];
    this.helpers.clear();
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
    await Promise.all(entries.map((entry) => (
      entry.id ? this.runner("docker", ["rm", "-f", entry.id]).catch(() => undefined) : Promise.resolve(undefined)
    )));
  }

  isContainerGone(result: CommandResult): boolean {
    const text = `${result.stderr || ""} ${result.stdout || ""}`.toLowerCase();
    return text.includes("no such container")
      || text.includes("is not running")
      || text.includes("no such object");
  }

  private async create(key: string): Promise<string> {
    const name = this.spec.nameFor(key);
    // Reclaim a same-named helper left behind by a previous process before starting a fresh one.
    await this.runner("docker", ["rm", "-f", name]).catch(() => undefined);
    const result = await this.runner("docker", this.spec.buildCreateArgs(key, name));
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Failed to start helper container.");
    }
    return (result.stdout || "").trim() || name;
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
    const removals: Array<Promise<unknown>> = [];
    for (const [key, entry] of [...this.helpers.entries()]) {
      if (entry.creating || now - entry.lastUsed < this.idleTtlMs) {
        continue;
      }
      this.helpers.delete(key);
      if (entry.id) {
        removals.push(this.runner("docker", ["rm", "-f", entry.id]).catch(() => undefined));
      }
    }
    await Promise.all(removals);
    if (this.helpers.size === 0 && this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }
}
