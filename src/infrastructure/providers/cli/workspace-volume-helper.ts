import { CommandResult } from "../../../services/cli-process-runner.js";
import { toDockerMountArg } from "../../../services/cli-docker-utils.js";
import {
  DockerHelperContainerPool,
  HELPER_LABEL,
  defaultHelperRunner,
  type HelperCommandRunner,
} from "./docker-helper-pool.js";

const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_RUNTIME_HOME = "/code-ux-runtime-home";
const HELPER_IMAGE = "alpine:3.20";
const KEEPALIVE_COMMAND = "tail -f /dev/null";
const HELPER_KEY_DELIMITER = "\n";

const buildHelperKey = (workspaceVolumeName: string, runtimeVolumeName?: string): string =>
  [workspaceVolumeName, runtimeVolumeName || ""].join(HELPER_KEY_DELIMITER);

const parseHelperKey = (key: string): { workspaceVolumeName: string; runtimeVolumeName: string | null } => {
  const [workspaceVolumeName, runtimeVolumeName = ""] = key.split(HELPER_KEY_DELIMITER);
  return { workspaceVolumeName, runtimeVolumeName: runtimeVolumeName || null };
};

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
  private readonly keysByWorkspaceVolume = new Map<string, Set<string>>();

  constructor(
    private readonly runner: HelperCommandRunner = defaultHelperRunner,
    private readonly image: string = HELPER_IMAGE,
  ) {
    this.pool = new DockerHelperContainerPool({
      nameFor: (volumeName) => `code-ux-vol-helper-${volumeName.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 200)}`,
      buildCreateArgs: (key, name) => {
        const { workspaceVolumeName, runtimeVolumeName } = parseHelperKey(key);
        const args = [
          "run",
          "-d",
          "--name",
          name,
          "--label",
          `${HELPER_LABEL}=volume`,
          "--workdir",
          CONTAINER_WORKSPACE_ROOT,
          "--mount",
          toDockerMountArg({ source: workspaceVolumeName, destination: CONTAINER_WORKSPACE_ROOT, readonly: false, type: "volume" }),
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
    }, runner);
  }

  /** Runs a command inside the persistent helper container for the given workspace volume. */
  async exec(volumeName: string, commandArgs: string[], runtimeVolumeName?: string): Promise<CommandResult> {
    const key = buildHelperKey(volumeName, runtimeVolumeName);
    const keys = this.keysByWorkspaceVolume.get(volumeName) || new Set<string>();
    keys.add(key);
    this.keysByWorkspaceVolume.set(volumeName, keys);

    let id: string;
    try {
      id = await this.pool.ensure(key);
    } catch {
      return this.fallbackRun(volumeName, commandArgs, runtimeVolumeName);
    }
    this.pool.touch(key);

    let result = await this.runner("docker", ["exec", id, ...commandArgs]);
    if (!result.ok && this.pool.isContainerGone(result)) {
      // The helper vanished (e.g. external prune or daemon restart) — drop it and retry once.
      this.pool.invalidate(key);
      try {
        id = await this.pool.ensure(key);
        result = await this.runner("docker", ["exec", id, ...commandArgs]);
      } catch {
        return this.fallbackRun(volumeName, commandArgs, runtimeVolumeName);
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
    const keys = this.keysByWorkspaceVolume.get(volumeName) || new Set([buildHelperKey(volumeName)]);
    await Promise.all([...keys].map((key) => this.pool.release(key).catch(() => undefined)));
    this.keysByWorkspaceVolume.delete(volumeName);
  }

  /** Removes every helper container this pool is tracking (call on graceful shutdown). */
  async shutdown(): Promise<void> {
    await this.pool.shutdown();
  }

  /** One-shot `docker run --rm` so a pool failure never blocks the underlying operation. */
  private fallbackRun(volumeName: string, commandArgs: string[], runtimeVolumeName?: string): Promise<CommandResult> {
    const args = [
      "run",
      "--rm",
      "--workdir",
      CONTAINER_WORKSPACE_ROOT,
      "--mount",
      toDockerMountArg({ source: volumeName, destination: CONTAINER_WORKSPACE_ROOT, readonly: false, type: "volume" }),
    ];
    if (runtimeVolumeName) {
      args.push(
        "--mount",
        toDockerMountArg({ source: runtimeVolumeName, destination: CONTAINER_RUNTIME_HOME, readonly: false, type: "volume" }),
      );
    }
    args.push(this.image, ...commandArgs);
    return this.runner("docker", args);
  }
}

/**
 * Process-wide singleton so every DockerRunner instance shares one helper container per volume
 * (otherwise two runners would fight over the same deterministic container name).
 */
export const workspaceVolumeHelperPool = new WorkspaceVolumeHelperPool();
