import { CommandResult } from "../../../services/cli-process-runner.js";
import { toDockerMountArg } from "../../../services/cli-docker-utils.js";
import {
  DockerHelperContainerPool,
  HELPER_LABEL,
  defaultHelperRunner,
  type HelperCommandRunner,
} from "./docker-helper-pool.js";

const CONTAINER_WORKSPACE_ROOT = "/workspace";
const HELPER_IMAGE = "alpine:3.20";
const KEEPALIVE_COMMAND = "tail -f /dev/null";

/**
 * Maintains one long-lived `alpine:3.20` helper container per workspace volume and runs
 * read/maintenance commands inside it via `docker exec`, instead of spawning a fresh
 * `docker run --rm` container for every operation.
 *
 * The provider telemetry watcher polls workspace logs every ~1.5s per active session; with the
 * previous per-operation containers that produced a steady stream of container create/start/stop
 * churn. Reusing a single warm container per volume removes that churn entirely while keeping the
 * exact same commands and output.
 */
export class WorkspaceVolumeHelperPool {
  private readonly pool: DockerHelperContainerPool;

  constructor(
    private readonly runner: HelperCommandRunner = defaultHelperRunner,
    private readonly image: string = HELPER_IMAGE,
  ) {
    this.pool = new DockerHelperContainerPool({
      nameFor: (volumeName) => `code-ux-vol-helper-${volumeName.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 200)}`,
      buildCreateArgs: (volumeName, name) => [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        `${HELPER_LABEL}=volume`,
        "--workdir",
        CONTAINER_WORKSPACE_ROOT,
        "--mount",
        toDockerMountArg({ source: volumeName, destination: CONTAINER_WORKSPACE_ROOT, readonly: false, type: "volume" }),
        "--entrypoint",
        "sh",
        this.image,
        "-c",
        KEEPALIVE_COMMAND,
      ],
    }, runner);
  }

  /** Runs a command inside the persistent helper container for the given workspace volume. */
  async exec(volumeName: string, commandArgs: string[]): Promise<CommandResult> {
    let id: string;
    try {
      id = await this.pool.ensure(volumeName);
    } catch {
      return this.fallbackRun(volumeName, commandArgs);
    }
    this.pool.touch(volumeName);

    let result = await this.runner("docker", ["exec", id, ...commandArgs]);
    if (!result.ok && this.pool.isContainerGone(result)) {
      // The helper vanished (e.g. external prune or daemon restart) — drop it and retry once.
      this.pool.invalidate(volumeName);
      try {
        id = await this.pool.ensure(volumeName);
        result = await this.runner("docker", ["exec", id, ...commandArgs]);
      } catch {
        return this.fallbackRun(volumeName, commandArgs);
      }
    }
    return result;
  }

  /**
   * Removes the helper container holding the given volume. Must be called before deleting the
   * underlying workspace volume, otherwise `docker volume rm` fails because the helper still has
   * it mounted. Safe to call when no helper exists.
   */
  async releaseVolume(volumeName: string): Promise<void> {
    await this.pool.release(volumeName);
  }

  /** Removes every helper container this pool is tracking (call on graceful shutdown). */
  async shutdown(): Promise<void> {
    await this.pool.shutdown();
  }

  /** One-shot `docker run --rm` so a pool failure never blocks the underlying operation. */
  private fallbackRun(volumeName: string, commandArgs: string[]): Promise<CommandResult> {
    return this.runner("docker", [
      "run",
      "--rm",
      "--workdir",
      CONTAINER_WORKSPACE_ROOT,
      "--mount",
      toDockerMountArg({ source: volumeName, destination: CONTAINER_WORKSPACE_ROOT, readonly: false, type: "volume" }),
      this.image,
      ...commandArgs,
    ]);
  }
}

/**
 * Process-wide singleton so every DockerRunner instance shares one helper container per volume
 * (otherwise two runners would fight over the same deterministic container name).
 */
export const workspaceVolumeHelperPool = new WorkspaceVolumeHelperPool();
