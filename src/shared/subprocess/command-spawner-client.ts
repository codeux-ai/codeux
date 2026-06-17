/**
 * Main-side client for the command-spawner host process. Forks the host lazily, routes run/abort
 * requests over IPC, dispatches streamed output lines to per-job callbacks, and resolves each job
 * with its raw result. If the host cannot be forked or dies, callers fall back to running the
 * command in-process (see CommandRunner.spawnProcess), so the spawner is a pure performance layer
 * and never a single point of failure. See command-spawner-protocol.ts for the rationale.
 */
import { fork, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import type {
  SpawnerCommandOptions,
  SpawnerRawResult,
  SpawnerResponse,
} from "./command-spawner-protocol.js";

export interface SpawnerRunCallbacks {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
}

interface PendingJob {
  resolve: (result: SpawnerRawResult) => void;
  reject: (error: Error) => void;
  callbacks: SpawnerRunCallbacks;
  abortListener?: () => void;
}

export class HostUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostUnavailableError";
  }
}

export class CommandSpawnerClient {
  private host: ChildProcess | null = null;
  private hostFailed = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();
  /** Snapshot of the environment the host inherited at fork time; used to compute per-job diffs. */
  private baseEnvSnapshot: Record<string, string> = {};

  constructor(private readonly hostModulePath: string = defaultHostModulePath()) {}

  /** Whether the spawner is usable. Once the host has failed to start we stop trying for this run. */
  isAvailable(): boolean {
    return !this.hostFailed;
  }

  run(
    command: string,
    args: string[],
    options: SpawnerCommandOptions,
    callbacks: SpawnerRunCallbacks,
  ): Promise<SpawnerRawResult> {
    const host = this.ensureHost();
    if (!host) {
      return Promise.reject(new HostUnavailableError("Command spawner host is unavailable"));
    }

    if (callbacks.signal?.aborted) {
      return Promise.reject(new HostUnavailableError("Aborted before dispatch"));
    }

    const id = this.nextId++;
    return new Promise<SpawnerRawResult>((resolve, reject) => {
      const job: PendingJob = { resolve, reject, callbacks };

      if (callbacks.signal) {
        const abortListener = () => {
          this.host?.send({ type: "abort", id });
        };
        job.abortListener = abortListener;
        callbacks.signal.addEventListener("abort", abortListener, { once: true });
      }

      this.pending.set(id, job);

      try {
        host.send({ type: "run", id, command, args, options });
      } catch (error) {
        this.settleReject(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Builds the small env payload (diff vs the host's base env) for a job's effective environment. */
  buildEnvPayload(env: NodeJS.ProcessEnv | undefined): Pick<SpawnerCommandOptions, "envOverride" | "envUnset" | "useBaseEnv"> {
    return computeEnvDiff(this.baseEnvSnapshot, env ?? process.env);
  }

  dispose(): void {
    const host = this.host;
    this.host = null;
    for (const id of [...this.pending.keys()]) {
      this.settleReject(id, new HostUnavailableError("Command spawner client disposed"));
    }
    host?.removeAllListeners();
    host?.disconnect?.();
    host?.kill();
  }

  private ensureHost(): ChildProcess | null {
    if (this.hostFailed) {
      return null;
    }
    if (this.host) {
      return this.host;
    }

    try {
      // Snapshot env immediately before fork so it matches what the host inherits, keeping per-job
      // diffs minimal.
      this.baseEnvSnapshot = snapshotEnv();
      const host = fork(this.hostModulePath, [], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
      host.on("message", (message: SpawnerResponse) => this.handleMessage(message));
      host.once("error", (error) => this.handleHostDown(error));
      host.once("exit", (code, signal) => {
        if (this.host === host) {
          this.handleHostDown(new Error(`Command spawner host exited (code=${code}, signal=${signal})`));
        }
      });
      this.host = host;
      return host;
    } catch (error) {
      this.hostFailed = true;
      this.host = null;
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  private handleMessage(message: SpawnerResponse): void {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "ready") {
      return;
    }
    const job = this.pending.get(message.id);
    if (!job) {
      return;
    }
    if (message.type === "stdoutLine") {
      job.callbacks.onStdoutLine?.(message.line);
    } else if (message.type === "stderrLine") {
      job.callbacks.onStderrLine?.(message.line);
    } else if (message.type === "result") {
      this.cleanupJob(message.id, job);
      job.resolve(message.result);
    }
  }

  private handleHostDown(error: Error): void {
    // Tear the host down and fail in-flight jobs; the next run() lazily respawns a fresh host so a
    // one-off crash doesn't permanently disable the spawner.
    this.host?.removeAllListeners();
    this.host = null;
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.settleReject(id, error);
    }
  }

  private settleReject(id: number, error: Error): void {
    const job = this.pending.get(id);
    if (!job) {
      return;
    }
    this.cleanupJob(id, job);
    job.reject(error);
  }

  private cleanupJob(id: number, job: PendingJob): void {
    this.pending.delete(id);
    if (job.abortListener && job.callbacks.signal) {
      job.callbacks.signal.removeEventListener("abort", job.abortListener);
    }
  }
}

/**
 * Computes the minimal env payload to reconstruct `effective` from `baseEnv` on the host side.
 * Keeps `process.send` from having to serialize the whole (large) environment per job: in the common
 * case where the job env matches the host's inherited base, this returns `{ useBaseEnv: true }`.
 */
export function computeEnvDiff(
  baseEnv: Record<string, string>,
  effective: NodeJS.ProcessEnv,
): Pick<SpawnerCommandOptions, "envOverride" | "envUnset" | "useBaseEnv"> {
  const override: Record<string, string> = {};
  const unset: string[] = [];

  for (const [key, value] of Object.entries(effective)) {
    if (typeof value === "string" && value !== baseEnv[key]) {
      override[key] = value;
    }
  }
  for (const key of Object.keys(baseEnv)) {
    if (typeof effective[key] !== "string") {
      unset.push(key);
    }
  }

  if (Object.keys(override).length === 0 && unset.length === 0) {
    return { useBaseEnv: true };
  }
  return {
    ...(Object.keys(override).length > 0 ? { envOverride: override } : {}),
    ...(unset.length > 0 ? { envUnset: unset } : {}),
  };
}

function snapshotEnv(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function defaultHostModulePath(): string {
  const here = fileURLToPath(import.meta.url);
  // Sibling module; same extension as this file (.js in dist, .ts under ts-node in dev).
  return here.replace(/command-spawner-client(\.[cm]?[jt]s)$/, "command-spawner-host$1");
}
