import { runCommandStrict } from "./cli-process-runner.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface DockerAssetPruneResult {
  prunedWorkspaceVolumes: string[];
  prunedSetupImages: string[];
}

const WORKSPACE_VOLUME_PREFIX = "code-ux-";
const SETUP_IMAGE_PREFIX = "code-ux-setup-cache:";

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

    const prunedWorkspaceVolumes = await this.pruneWorkspaceVolumes(activeSessionIds);
    const prunedSetupImages = await this.pruneSetupImages();

    if (prunedWorkspaceVolumes.length > 0 || prunedSetupImages.length > 0) {
      this.logger?.info("Pruned stale Docker assets on startup", {
        prunedWorkspaceVolumes: prunedWorkspaceVolumes.length,
        prunedSetupImages: prunedSetupImages.length,
      });
    }

    return {
      prunedWorkspaceVolumes,
      prunedSetupImages,
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

  private async pruneSetupImages(): Promise<string[]> {
    const result = await this.runDocker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"]);
    if (!result) {
      return [];
    }

    const imageRefs = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(SETUP_IMAGE_PREFIX));
    const pruned: string[] = [];

    for (const imageRef of imageRefs) {
      const removed = await this.runDocker(["image", "rm", "-f", imageRef]);
      if (removed?.ok) {
        pruned.push(imageRef);
      }
    }

    return pruned;
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
