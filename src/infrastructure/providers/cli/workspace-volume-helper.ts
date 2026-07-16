import { createHash } from "node:crypto";
import path from "node:path";
import type { CommandResult } from "../../../services/cli-process-runner.js";
import { isRuntimeShutdownInProgress } from "../../../services/shutdown-state.js";
import {
  DOCKER_NETWORK_NONE_ARGS,
  DOCKER_NO_NEW_PRIVILEGES_ARGS,
  toDockerMountArg,
} from "../../../services/cli-docker-utils.js";
import { getRuntimeOwnerDockerArgs } from "../../../shared/config/runtime-owner.js";
import {
  DockerHelperContainerPool,
  HELPER_LABEL,
  HELPER_OWNER_NAME_SUFFIX,
  defaultHelperRunner,
  type HelperCommandRunner,
  type HelperRunnerOptions,
} from "./docker-helper-pool.js";

const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_RUNTIME_HOME = "/code-ux-runtime-home";
const CONTAINER_HELPER_HOME = "/tmp/code-ux-home";
const HELPER_IMAGE = "alpine/git";
const KEEPALIVE_COMMAND = "tail -f /dev/null";
const HELPER_HOME_MOUNT = `type=tmpfs,target=${CONTAINER_HELPER_HOME},tmpfs-mode=1777,tmpfs-size=1048576`;
const HELPER_KEY_DELIMITER = "\n";
const DEFAULT_IDLE_TTL_MS = 30_000;
const DEFAULT_REAP_INTERVAL_MS = 5_000;
const DEFAULT_MAX_CONTAINERS = 16;
const DOCKER_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOCKER_USER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?$/;
const DOCKER_VOLUME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export interface WorkspaceSidecarExecOptions extends HelperRunnerOptions {
  /** Explicit command-only container environment. Ambient host variables are never inherited. */
  environment?: Readonly<NodeJS.ProcessEnv>;
  /** Docker user/user:group applied only to this command. */
  user?: string;
  /** Absolute command workdir below /workspace (or the mounted runtime home). */
  workdir?: string;
}

export interface WorkspaceSidecarLifecycleOptions {
  idleTtlMs?: number;
  reapIntervalMs?: number;
  maxContainers?: number;
}

interface VolumeGate {
  activeCommands: number;
  idleWaiters: Set<() => void>;
  releasePromise?: Promise<void>;
}

type WorkspaceExecAttempt =
  | { kind: "result"; containerId: string; result: CommandResult }
  | { kind: "runner-error"; error: unknown };

const buildHelperKey = (workspaceVolumeName: string, runtimeVolumeName?: string): string =>
  [workspaceVolumeName, runtimeVolumeName || ""].join(HELPER_KEY_DELIMITER);

const parseHelperKey = (key: string): { workspaceVolumeName: string; runtimeVolumeName: string | null } => {
  const [workspaceVolumeName, runtimeVolumeName = ""] = key.split(HELPER_KEY_DELIMITER);
  return { workspaceVolumeName, runtimeVolumeName: runtimeVolumeName || null };
};

/**
 * Maintains one short-lived, Git-capable sidecar per workspace/runtime-volume pair.
 *
 * Commands use `docker exec` against a warm sidecar, while all identity, environment, working
 * directory, stdin, and cancellation settings remain command-scoped. Sidecars have no network and
 * no-new-privileges, are automatically reaped after a bounded idle window, and fall back to an
 * equivalent one-shot container if a helper generation cannot be created or disappears twice.
 */
export class WorkspaceVolumeHelperPool {
  private readonly pool: DockerHelperContainerPool;
  private readonly keysByWorkspaceVolume = new Map<string, Set<string>>();
  private readonly volumeGates = new Map<string, VolumeGate>();
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly runner: HelperCommandRunner = defaultHelperRunner,
    private readonly image: string = HELPER_IMAGE,
    lifecycle: WorkspaceSidecarLifecycleOptions = {},
  ) {
    if (!image || image.includes("\0")) {
      throw new Error("Workspace sidecar image cannot be empty or contain null bytes.");
    }
    this.pool = new DockerHelperContainerPool({
      nameFor: (key) => `code-ux-vol-helper-${HELPER_OWNER_NAME_SUFFIX}-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`,
      buildCreateArgs: (key, name) => {
        const { workspaceVolumeName, runtimeVolumeName } = parseHelperKey(key);
        const args = [
          "run",
          "-d",
          "--name",
          name,
          ...DOCKER_NETWORK_NONE_ARGS,
          ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
          "--label",
          "code-ux.managed=true",
          "--label",
          `${HELPER_LABEL}=volume`,
          ...getRuntimeOwnerDockerArgs(),
          "--workdir",
          CONTAINER_WORKSPACE_ROOT,
          "--mount",
          toDockerMountArg({ source: workspaceVolumeName, destination: CONTAINER_WORKSPACE_ROOT, readonly: false, type: "volume" }),
          // alpine/git declares /git as a volume. Mask it so the warm sidecar does not allocate an
          // anonymous Docker volume; `docker rm -v` remains a second line of cleanup defense.
          "--mount",
          "type=tmpfs,target=/git",
          // WorkspaceManager deliberately gives Git an isolated HOME instead of inheriting a
          // provider home. Mount it explicitly so both root bootstrap commands and later
          // uid-scoped commands can create/read the transient global Git config.
          "--mount",
          HELPER_HOME_MOUNT,
        ];
        if (runtimeVolumeName) {
          args.push(
            "--mount",
            toDockerMountArg({ source: runtimeVolumeName, destination: CONTAINER_RUNTIME_HOME, readonly: false, type: "volume" }),
          );
        }
        args.push("--entrypoint", "sh", this.image, "-c", KEEPALIVE_COMMAND);
        return args;
      },
      idleTtlMs: lifecycle.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
      reapIntervalMs: lifecycle.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS,
      maxContainers: lifecycle.maxContainers ?? DEFAULT_MAX_CONTAINERS,
    }, runner);
  }

  /** Keeps a logical workspace helper generation reusable until the returned lease is released. */
  reserve(volumeName: string, runtimeVolumeName?: string): () => void {
    this.validateVolumeName(volumeName, "workspace");
    if (runtimeVolumeName !== undefined) {
      this.validateVolumeName(runtimeVolumeName, "runtime");
    }
    return this.pool.reserve(buildHelperKey(volumeName, runtimeVolumeName));
  }

  /**
   * Runs an executable and arguments inside the workspace sidecar.
   *
   * A non-zero command resolves to a non-ok CommandResult. Invalid sidecar options reject before
   * Docker is invoked. When `stdinFile` is present, Docker receives `-i` and the host runner streams
   * that file to the command's stdin.
   */
  async exec(
    volumeName: string,
    commandArgs: readonly string[],
    runtimeVolumeName?: string,
    options: WorkspaceSidecarExecOptions = {},
  ): Promise<CommandResult> {
    this.validateVolumeName(volumeName, "workspace");
    if (runtimeVolumeName !== undefined) {
      this.validateVolumeName(runtimeVolumeName, "runtime");
    }
    this.validateCommandArgs(commandArgs);
    const commandDockerArgs = this.buildCommandDockerArgs(options, runtimeVolumeName);
    const runnerOptions = this.buildRunnerOptions(options);
    const releaseCommand = await this.acquireVolumeCommand(volumeName);

    try {
      const key = buildHelperKey(volumeName, runtimeVolumeName);
      const keys = this.keysByWorkspaceVolume.get(volumeName) || new Set<string>();
      keys.add(key);
      this.keysByWorkspaceVolume.set(volumeName, keys);

      const runViaExec = (): Promise<WorkspaceExecAttempt> => (
        this.pool.withContainer(key, async (containerId) => {
          try {
            return {
              kind: "result" as const,
              containerId,
              result: await this.runner(
                "docker",
                ["exec", ...commandDockerArgs, containerId, ...commandArgs],
                runnerOptions,
              ),
            };
          } catch (error) {
            // Only sidecar lifecycle failures use the one-shot fallback. A host-runner exception
            // may have happened after the command started, so repeating it could duplicate writes.
            return { kind: "runner-error" as const, error };
          }
        })
      );

      let attempt: WorkspaceExecAttempt;
      try {
        attempt = await runViaExec();
      } catch (error) {
        return this.fallbackRun(
          volumeName,
          commandArgs,
          runtimeVolumeName,
          commandDockerArgs,
          runnerOptions,
          options,
          error,
        );
      }
      if (attempt.kind === "runner-error") {
        throw attempt.error;
      }

      if (!attempt.result.ok && this.pool.isContainerGone(attempt.result)) {
        // Invalidate only the generation that failed. A concurrent caller may already have
        // installed a replacement, in which case the next acquisition joins that generation.
        this.pool.invalidate(key, attempt.containerId);
        try {
          attempt = await runViaExec();
        } catch (error) {
          return this.fallbackRun(
            volumeName,
            commandArgs,
            runtimeVolumeName,
            commandDockerArgs,
            runnerOptions,
            options,
            error,
          );
        }
        if (attempt.kind === "runner-error") {
          throw attempt.error;
        }
        if (!attempt.result.ok && this.pool.isContainerGone(attempt.result)) {
          this.pool.invalidate(key, attempt.containerId);
          return this.fallbackRun(
            volumeName,
            commandArgs,
            runtimeVolumeName,
            commandDockerArgs,
            runnerOptions,
            options,
            new Error(attempt.result.stderr.trim() || "Workspace helper replacement stopped before command execution."),
          );
        }
      }
      return attempt.result;
    } finally {
      releaseCommand();
    }
  }

  /**
   * Drains commands using `volumeName`, then removes all sidecars that mount it. The named workspace
   * and runtime volumes themselves are preserved. A concurrent release joins the same drain; a new
   * command waits until release completes before creating a fresh sidecar generation.
   */
  async releaseVolume(volumeName: string): Promise<void> {
    this.validateVolumeName(volumeName, "workspace");
    const gate = this.getOrCreateVolumeGate(volumeName);
    if (gate.releasePromise) {
      await gate.releasePromise;
      return;
    }

    const releasePromise = this.releaseVolumeGeneration(volumeName, gate);
    gate.releasePromise = releasePromise;
    try {
      await releasePromise;
    } finally {
      if (gate.releasePromise === releasePromise) {
        gate.releasePromise = undefined;
      }
      if (gate.activeCommands === 0 && this.volumeGates.get(volumeName) === gate) {
        this.volumeGates.delete(volumeName);
      }
    }
  }

  /** Drains active commands and removes every sidecar. Idempotent. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    this.shutdownPromise = this.shutdownAll();
    return this.shutdownPromise;
  }

  private async shutdownAll(): Promise<void> {
    const volumes = new Set([
      ...this.keysByWorkspaceVolume.keys(),
      ...this.volumeGates.keys(),
    ]);
    await Promise.all([...volumes].map((volumeName) => this.releaseVolume(volumeName)));
    await this.pool.shutdown();
  }

  private async releaseVolumeGeneration(volumeName: string, gate: VolumeGate): Promise<void> {
    await this.waitForVolumeIdle(gate);
    const keys = [...(this.keysByWorkspaceVolume.get(volumeName) || new Set([buildHelperKey(volumeName)]))];
    try {
      await Promise.all(keys.map((key) => this.pool.release(key)));
    } finally {
      this.keysByWorkspaceVolume.delete(volumeName);
    }
  }

  private async acquireVolumeCommand(volumeName: string): Promise<() => void> {
    for (;;) {
      if (this.shuttingDown) {
        throw new Error("Workspace sidecar pool is shutting down.");
      }
      const gate = this.getOrCreateVolumeGate(volumeName);
      if (gate.releasePromise) {
        await gate.releasePromise;
        continue;
      }
      gate.activeCommands += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        gate.activeCommands = Math.max(0, gate.activeCommands - 1);
        if (gate.activeCommands === 0) {
          for (const resolve of gate.idleWaiters) {
            resolve();
          }
          gate.idleWaiters.clear();
          if (!gate.releasePromise && this.volumeGates.get(volumeName) === gate) {
            this.volumeGates.delete(volumeName);
          }
        }
      };
    }
  }

  private getOrCreateVolumeGate(volumeName: string): VolumeGate {
    const existing = this.volumeGates.get(volumeName);
    if (existing) {
      return existing;
    }
    const created: VolumeGate = {
      activeCommands: 0,
      idleWaiters: new Set(),
    };
    this.volumeGates.set(volumeName, created);
    return created;
  }

  private waitForVolumeIdle(gate: VolumeGate): Promise<void> {
    if (gate.activeCommands === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      gate.idleWaiters.add(resolve);
    });
  }

  /** One-shot equivalent so a pool failure never blocks the underlying operation. */
  private fallbackRun(
    volumeName: string,
    commandArgs: readonly string[],
    runtimeVolumeName: string | undefined,
    commandDockerArgs: string[],
    runnerOptions: HelperRunnerOptions,
    options: WorkspaceSidecarExecOptions,
    fallbackCause: unknown,
  ): Promise<CommandResult> {
    this.assertFallbackAllowed(options, fallbackCause);
    const args = [
      "run",
      "--rm",
      ...DOCKER_NETWORK_NONE_ARGS,
      ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
      "--label",
      "code-ux.managed=true",
      "--label",
      `${HELPER_LABEL}=volume`,
      ...getRuntimeOwnerDockerArgs(),
      "--mount",
      toDockerMountArg({ source: volumeName, destination: CONTAINER_WORKSPACE_ROOT, readonly: false, type: "volume" }),
      "--mount",
      "type=tmpfs,target=/git",
      "--mount",
      HELPER_HOME_MOUNT,
    ];
    if (runtimeVolumeName) {
      args.push(
        "--mount",
        toDockerMountArg({ source: runtimeVolumeName, destination: CONTAINER_RUNTIME_HOME, readonly: false, type: "volume" }),
      );
    }
    args.push(
      ...commandDockerArgs,
      "--entrypoint",
      commandArgs[0],
      this.image,
      ...commandArgs.slice(1),
    );
    return this.runner("docker", args, runnerOptions);
  }

  private assertFallbackAllowed(options: WorkspaceSidecarExecOptions, fallbackCause: unknown): void {
    if (options.signal?.aborted) {
      options.signal.throwIfAborted();
    }
    if (!this.shuttingDown && !isRuntimeShutdownInProgress()) {
      return;
    }
    if (fallbackCause instanceof Error) {
      throw fallbackCause;
    }
    throw new Error("Workspace sidecar fallback is unavailable while the runtime is shutting down.");
  }

  private buildCommandDockerArgs(
    options: WorkspaceSidecarExecOptions,
    runtimeVolumeName?: string,
  ): string[] {
    const args: string[] = [];
    if (options.stdinFile) {
      args.push("-i");
    }
    if (options.workdir !== undefined) {
      args.push("--workdir", this.validateWorkdir(options.workdir, Boolean(runtimeVolumeName)));
    }
    if (options.user !== undefined) {
      if (!DOCKER_USER_PATTERN.test(options.user) || options.user.includes("\0")) {
        throw new Error(`Invalid Docker sidecar user: ${options.user}`);
      }
      args.push("--user", options.user);
    }
    for (const [name, value] of Object.entries(options.environment || {})) {
      if (value === undefined || value.length === 0) {
        continue;
      }
      if (!DOCKER_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Invalid Docker sidecar environment name: ${name}`);
      }
      if (value.includes("\0")) {
        throw new Error(`Docker sidecar environment value contains a null byte: ${name}`);
      }
      args.push("--env", `${name}=${value}`);
    }
    return args;
  }

  private buildRunnerOptions(options: WorkspaceSidecarExecOptions): HelperRunnerOptions {
    return {
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.stdinFile !== undefined ? { stdinFile: options.stdinFile } : {}),
      ...(options.trimOutput !== undefined ? { trimOutput: options.trimOutput } : {}),
      ...(options.maxStdoutChars !== undefined ? { maxStdoutChars: options.maxStdoutChars } : {}),
      ...(options.onStdoutLine !== undefined ? { onStdoutLine: options.onStdoutLine } : {}),
      ...(options.onStderrLine !== undefined ? { onStderrLine: options.onStderrLine } : {}),
    };
  }

  private validateVolumeName(volumeName: string, kind: "workspace" | "runtime"): void {
    if (!DOCKER_VOLUME_NAME_PATTERN.test(volumeName) || volumeName.includes("\0")) {
      throw new Error(`Invalid ${kind} Docker volume name.`);
    }
  }

  private validateCommandArgs(commandArgs: readonly string[]): void {
    if (commandArgs.length === 0 || !commandArgs[0]) {
      throw new Error("Workspace sidecar command must include an executable.");
    }
    if (commandArgs.some((argument) => argument.includes("\0"))) {
      throw new Error("Workspace sidecar command arguments cannot contain null bytes.");
    }
  }

  private validateWorkdir(workdir: string, runtimeMounted: boolean): string {
    if (!workdir || workdir.includes("\0") || !path.posix.isAbsolute(workdir)) {
      throw new Error("Workspace sidecar workdir must be an absolute container path.");
    }
    const normalized = path.posix.normalize(workdir);
    const roots = runtimeMounted
      ? [CONTAINER_WORKSPACE_ROOT, CONTAINER_RUNTIME_HOME]
      : [CONTAINER_WORKSPACE_ROOT];
    if (!roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
      throw new Error("Workspace sidecar workdir must stay inside a mounted workspace or runtime volume.");
    }
    return normalized;
  }
}

/** Preferred name for new call sites; the old export remains source-compatible. */
export { WorkspaceVolumeHelperPool as WorkspaceSidecarPool };

/** Process-wide pool so all Docker runners share one sidecar generation per workspace key. */
export const workspaceVolumeHelperPool = new WorkspaceVolumeHelperPool();
