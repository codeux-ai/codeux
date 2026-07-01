import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runCommandStrict } from "./cli-process-runner.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface DockerAssetPruneResult {
  prunedWorkspaceVolumes: string[];
  prunedSetupImages: string[];
  prunedLoginContainers: string[];
  prunedHelperContainers?: string[];
  prunedTempCredentialsDirs?: string[];
}

const WORKSPACE_VOLUME_PREFIX = "code-ux-";
const WORKSPACE_VOLUME_LABEL = "code-ux.workspace=true";
const RUNTIME_VOLUME_LABEL = "code-ux.workspace-runtime=true";
const RUNTIME_VOLUME_SUFFIX = "-runtime";
const DOCKER_PRUNE_TIMEOUT_MS = 10_000;
const DOCKER_REMOVE_BATCH_SIZE = 50;

export class DockerAssetPruneService {
  constructor(
    private readonly sessionTrackingRepository: SessionTrackingRepository,
    private readonly logger?: Logger,
  ) {}

  async cleanupOnStartup(): Promise<DockerAssetPruneResult> {
    const activeSessionIds = new Set(
      this.sessionTrackingRepository
        .listTrackedCliSessions()
        .filter((session) => session.state === "RUNNING")
        .map((session) => session.id),
    );

    const [
      prunedHelperContainers,
      prunedLoginContainers,
      prunedTempCredentialsDirs,
    ] = await Promise.all([
      this.pruneOrphanedHelperContainers(),
      this.pruneOrphanedLoginContainers(),
      this.pruneTemporaryCredentialsDirectories(),
    ]);

    // Remove helper containers before workspace volumes: a surviving helper keeps its volume
    // mounted, which would otherwise block the volume removal below.
    const prunedWorkspaceVolumes = await this.pruneWorkspaceVolumes(activeSessionIds);
    const prunedSetupImages: string[] = [];

    if (
      prunedWorkspaceVolumes.length > 0 ||
      prunedSetupImages.length > 0 ||
      prunedLoginContainers.length > 0 ||
      prunedHelperContainers.length > 0 ||
      prunedTempCredentialsDirs.length > 0
    ) {
      this.logger?.info("Pruned stale Docker and credential assets on startup", {
        prunedWorkspaceVolumes: prunedWorkspaceVolumes.length,
        prunedSetupImages: prunedSetupImages.length,
        prunedLoginContainers: prunedLoginContainers.length,
        prunedHelperContainers: prunedHelperContainers.length,
        prunedTempCredentialsDirs: prunedTempCredentialsDirs.length,
      });
    }

    return {
      prunedWorkspaceVolumes,
      prunedSetupImages,
      prunedLoginContainers,
      prunedHelperContainers,
      prunedTempCredentialsDirs,
    };
  }

  private async pruneWorkspaceVolumes(activeSessionIds: ReadonlySet<string>): Promise<string[]> {
    const [workspaceResult, runtimeResult] = await Promise.all([
      this.runDocker(["volume", "ls", "-q", "--filter", `label=${WORKSPACE_VOLUME_LABEL}`]),
      this.runDocker(["volume", "ls", "-q", "--filter", `label=${RUNTIME_VOLUME_LABEL}`]),
    ]);

    const volumeNames = [
      ...this.parseLines(workspaceResult?.stdout),
      ...this.parseLines(runtimeResult?.stdout),
    ].filter((line, index, all) => line.startsWith(WORKSPACE_VOLUME_PREFIX) && all.indexOf(line) === index);
    const staleVolumes: string[] = [];

    for (const volumeName of volumeNames) {
      const workspaceKey = this.extractWorkspaceKey(volumeName);
      if (!workspaceKey) {
        continue;
      }
      if (activeSessionIds.has(workspaceKey)) {
        continue;
      }
      staleVolumes.push(volumeName);
    }

    return await this.removeDockerItems(["volume", "rm", "-f"], staleVolumes);
  }

  private async pruneOrphanedLoginContainers(): Promise<string[]> {
    const result = await this.runDocker(["ps", "-aq", "--filter", "label=code-ux.login=true"]);
    if (!result) {
      return [];
    }

    return await this.removeDockerItems(["rm", "-f", "-v"], this.parseLines(result.stdout));
  }

  private async pruneOrphanedHelperContainers(): Promise<string[]> {
    // Persistent git/file helper containers (`code-ux.helper`) from a previous process are
    // recreated on demand, so any survivors at startup are safe to remove.
    const result = await this.runDocker(["ps", "-aq", "--filter", "label=code-ux.helper"]);
    if (!result) {
      return [];
    }

    return await this.removeDockerItems(["rm", "-f", "-v"], this.parseLines(result.stdout));
  }

  private async pruneTemporaryCredentialsDirectories(): Promise<string[]> {
    const credentialsParentDir = path.join(os.homedir(), ".code-ux", "credentials");
    try {
      const files = await fs.readdir(credentialsParentDir, { withFileTypes: true });
      const tempDirsToPrune = files
        .filter((file) => file.isDirectory() && /-temp-[a-z0-9]+$/.test(file.name))
        .map((file) => file.name);

      const pruned: string[] = [];
      for (const tempDir of tempDirsToPrune) {
        const fullPath = path.join(credentialsParentDir, tempDir);
        try {
          await fs.rm(fullPath, { recursive: true, force: true });
          pruned.push(tempDir);
        } catch (e) {
          // Ignore deletion errors on individual directories
        }
      }
      return pruned;
    } catch {
      // If credentials directory doesn't exist or is not readable, just return empty array
      return [];
    }
  }

  private async runDocker(args: string[]) {
    try {
      return await runCommandStrict("docker", args, process.cwd(), process.env, { timeout: DOCKER_PRUNE_TIMEOUT_MS });
    } catch {
      return null;
    }
  }

  private parseLines(value: string | undefined): string[] {
    return (value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private async removeDockerItems(baseArgs: string[], itemNames: string[]): Promise<string[]> {
    const pruned: string[] = [];
    for (let index = 0; index < itemNames.length; index += DOCKER_REMOVE_BATCH_SIZE) {
      const batch = itemNames.slice(index, index + DOCKER_REMOVE_BATCH_SIZE);
      const result = await this.runDocker([...baseArgs, ...batch]);
      if (result?.ok) {
        pruned.push(...batch);
        continue;
      }
      if (batch.length === 1) {
        continue;
      }
      for (const item of batch) {
        const singleResult = await this.runDocker([...baseArgs, item]);
        if (singleResult?.ok) {
          pruned.push(item);
        }
      }
    }
    return pruned;
  }

  private extractWorkspaceKey(volumeName: string): string | null {
    const workspaceVolumeName = volumeName.endsWith(RUNTIME_VOLUME_SUFFIX)
      ? volumeName.slice(0, -RUNTIME_VOLUME_SUFFIX.length)
      : volumeName;
    const match = workspaceVolumeName.match(/^code-ux-.+-([a-f0-9]{12})-(.+)$/);
    return match?.[2] || null;
  }
}
