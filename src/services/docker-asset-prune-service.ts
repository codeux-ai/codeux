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

    // Remove helper containers before workspace volumes: a surviving helper keeps its volume
    // mounted, which would otherwise block the volume removal below.
    const prunedHelperContainers = await this.pruneOrphanedHelperContainers();
    const prunedWorkspaceVolumes = await this.pruneWorkspaceVolumes(activeSessionIds);
    const prunedSetupImages: string[] = [];
    const prunedLoginContainers = await this.pruneOrphanedLoginContainers();
    const prunedTempCredentialsDirs = await this.pruneTemporaryCredentialsDirectories();

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
    const result = await this.runDocker(["volume", "ls", "--format", "{{.Name}}"]);
    if (!result) {
      return [];
    }

    const volumeNames = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(WORKSPACE_VOLUME_PREFIX));
    const pruned: string[] = [];

    for (const volumeName of volumeNames) {
      const workspaceKey = this.extractWorkspaceKey(volumeName);
      if (!workspaceKey) {
        continue;
      }
      if (activeSessionIds.has(workspaceKey)) {
        continue;
      }
      const removed = await this.runDocker(["volume", "rm", "-f", volumeName]);
      if (removed?.ok) {
        pruned.push(volumeName);
      }
    }

    return pruned;
  }

  private async pruneOrphanedLoginContainers(): Promise<string[]> {
    const result = await this.runDocker(["ps", "-aq", "--filter", "label=code-ux.login=true"]);
    if (!result) {
      return [];
    }

    const containerIds = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const pruned: string[] = [];

    for (const containerId of containerIds) {
      const removed = await this.runDocker(["rm", "-f", containerId]);
      if (removed?.ok) {
        pruned.push(containerId);
      }
    }

    return pruned;
  }

  private async pruneOrphanedHelperContainers(): Promise<string[]> {
    // Persistent git/file helper containers (`code-ux.helper`) from a previous process are
    // recreated on demand, so any survivors at startup are safe to remove.
    const result = await this.runDocker(["ps", "-aq", "--filter", "label=code-ux.helper"]);
    if (!result) {
      return [];
    }

    const containerIds = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const pruned: string[] = [];

    for (const containerId of containerIds) {
      const removed = await this.runDocker(["rm", "-f", containerId]);
      if (removed?.ok) {
        pruned.push(containerId);
      }
    }

    return pruned;
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
      return await runCommandStrict("docker", args, process.cwd());
    } catch {
      return null;
    }
  }

  private extractWorkspaceKey(volumeName: string): string | null {
    const match = volumeName.match(/^code-ux-.+-([a-f0-9]{12})-(.+)$/);
    return match?.[2] || null;
  }
}
