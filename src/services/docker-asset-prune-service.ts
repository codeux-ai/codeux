import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runCommandStrict, type CommandResult } from "./cli-process-runner.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { AsyncSemaphore } from "../shared/async-semaphore.js";
import type { Logger } from "../shared/logging/logger.js";
import { getRuntimeOwnerLabel } from "../shared/config/runtime-owner.js";

export interface DockerAssetPruneResult {
  prunedWorkspaceVolumes: string[];
  prunedSetupImages: string[];
  prunedLoginContainers: string[];
  prunedProviderContainers?: string[];
  prunedHelperContainers?: string[];
  prunedTempCredentialsDirs?: string[];
  prunedProviderToolVolumes?: string[];
  prunedPlaywrightBrowserVolumes?: string[];
}

export interface DockerAssetPruneServiceOptions {
  dockerConcurrency?: number;
  fileSystemConcurrency?: number;
  dockerBatchSize?: number;
  protectedWorkspaceSessionIds?: () => Iterable<string>;
}

interface DockerVolumeInspection {
  Name?: string;
  CreatedAt?: string;
  Labels?: Record<string, string>;
}

const WORKSPACE_VOLUME_PREFIX = "code-ux-";
const WORKSPACE_VOLUME_LABEL = "code-ux.workspace=true";
const RUNTIME_VOLUME_LABEL = "code-ux.workspace-runtime=true";
const WORKSPACE_SESSION_LABEL = "code-ux.workspace-session";
const RUNTIME_VOLUME_SUFFIX = "-runtime";
const DOCKER_PRUNE_TIMEOUT_MS = 10_000;
const DOCKER_REMOVE_BATCH_SIZE = 50;
const DEFAULT_DOCKER_CONCURRENCY = 4;
const DEFAULT_FILE_SYSTEM_CONCURRENCY = 8;
const PROVIDER_TOOL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WORKSPACE_VOLUME_CREATION_GRACE_MS = 10 * 60 * 1000;

export class DockerAssetPruneService {
  private readonly dockerSemaphore: AsyncSemaphore;
  private readonly fileSystemSemaphore: AsyncSemaphore;
  private readonly dockerBatchSize: number;
  private readonly protectedWorkspaceSessionIds: () => Iterable<string>;
  private cleanupInFlight: Promise<DockerAssetPruneResult> | null = null;

  constructor(
    private readonly sessionTrackingRepository: SessionTrackingRepository,
    private readonly logger?: Logger,
    options: DockerAssetPruneServiceOptions = {},
  ) {
    this.dockerSemaphore = new AsyncSemaphore(options.dockerConcurrency ?? DEFAULT_DOCKER_CONCURRENCY);
    this.fileSystemSemaphore = new AsyncSemaphore(
      options.fileSystemConcurrency ?? DEFAULT_FILE_SYSTEM_CONCURRENCY,
    );
    const configuredBatchSize = Math.floor(options.dockerBatchSize ?? DOCKER_REMOVE_BATCH_SIZE);
    this.dockerBatchSize = Number.isFinite(configuredBatchSize)
      ? Math.max(1, configuredBatchSize)
      : DOCKER_REMOVE_BATCH_SIZE;
    this.protectedWorkspaceSessionIds = options.protectedWorkspaceSessionIds ?? (() => []);
  }

  cleanupOnStartup(): Promise<DockerAssetPruneResult> {
    if (this.cleanupInFlight) {
      return this.cleanupInFlight;
    }

    const cleanup = this.performCleanupOnStartup();
    this.cleanupInFlight = cleanup;
    void cleanup.then(
      () => this.clearCleanup(cleanup),
      () => this.clearCleanup(cleanup),
    );
    return cleanup;
  }

  private async performCleanupOnStartup(): Promise<DockerAssetPruneResult> {
    const trackedSessionIds = new Set(
      this.sessionTrackingRepository
        .listTrackedCliSessions()
        .map((session) => session.id),
    );

    // Old helper generations may still be running after a hard process exit;
    // remove them first so the generic non-running scan cannot race the same ID.
    const prunedHelperContainers = await this.pruneOrphanedHelperContainers();
    const [
      prunedProviderContainers,
      prunedLoginContainers,
      prunedTempCredentialsDirs,
    ] = await Promise.all([
      this.pruneOrphanedProviderContainers(),
      this.pruneOrphanedLoginContainers(),
      this.pruneTemporaryCredentialsDirectories(),
    ]);

    // Remove helper containers before workspace volumes: a surviving helper keeps its volume
    // mounted, which would otherwise block the volume removal below.
    const [
      prunedWorkspaceVolumes,
      prunedProviderToolVolumes,
      prunedPlaywrightBrowserVolumes,
    ] = await Promise.all([
      this.pruneWorkspaceVolumes(trackedSessionIds),
      this.pruneProviderToolVolumes(),
      this.prunePlaywrightBrowserVolumes(),
    ]);
    const prunedSetupImages: string[] = [];

    if (
      prunedWorkspaceVolumes.length > 0 ||
      prunedSetupImages.length > 0 ||
      prunedLoginContainers.length > 0 ||
      prunedProviderContainers.length > 0 ||
      prunedHelperContainers.length > 0 ||
      prunedTempCredentialsDirs.length > 0 ||
      prunedProviderToolVolumes.length > 0 ||
      prunedPlaywrightBrowserVolumes.length > 0
    ) {
      this.logger?.info("Pruned stale Docker and credential assets on startup", {
        prunedWorkspaceVolumes: prunedWorkspaceVolumes.length,
        prunedSetupImages: prunedSetupImages.length,
        prunedLoginContainers: prunedLoginContainers.length,
        prunedProviderContainers: prunedProviderContainers.length,
        prunedHelperContainers: prunedHelperContainers.length,
        prunedTempCredentialsDirs: prunedTempCredentialsDirs.length,
        prunedProviderToolVolumes: prunedProviderToolVolumes.length,
        prunedPlaywrightBrowserVolumes: prunedPlaywrightBrowserVolumes.length,
      });
    }

    return {
      prunedWorkspaceVolumes,
      prunedSetupImages,
      prunedLoginContainers,
      prunedProviderContainers,
      prunedHelperContainers,
      prunedTempCredentialsDirs,
      prunedProviderToolVolumes,
      prunedPlaywrightBrowserVolumes,
    };
  }

  private async pruneWorkspaceVolumes(startupSessionIds: ReadonlySet<string>): Promise<string[]> {
    const [workspaceResult, runtimeResult] = await Promise.all([
      this.runDocker(["volume", "ls", "-q", "--filter", `label=${WORKSPACE_VOLUME_LABEL}`, "--filter", `label=${getRuntimeOwnerLabel()}`]),
      this.runDocker(["volume", "ls", "-q", "--filter", `label=${RUNTIME_VOLUME_LABEL}`, "--filter", `label=${getRuntimeOwnerLabel()}`]),
    ]);

    const volumeNames = [
      ...this.parseLines(workspaceResult?.stdout),
      ...this.parseLines(runtimeResult?.stdout),
    ].filter((line, index, all) => line.startsWith(WORKSPACE_VOLUME_PREFIX) && all.indexOf(line) === index);
    const activeSessionIds = new Set(startupSessionIds);
    // Startup cleanup runs in the background. Sessions can become tracked
    // after cleanup begins but before it removes the listed volumes, so take a
    // second snapshot at the destructive boundary.
    for (const session of this.sessionTrackingRepository.listTrackedCliSessions()) {
      activeSessionIds.add(session.id);
    }
    try {
      for (const sessionId of this.protectedWorkspaceSessionIds()) {
        const normalized = String(sessionId || "").trim();
        if (normalized) {
          activeSessionIds.add(normalized);
        }
      }
    } catch (error) {
      this.logger?.warn("Failed to resolve protected Docker workspace sessions during startup cleanup", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const inspections = await this.readVolumeInspections(volumeNames);
    const recentCutoff = Date.now() - WORKSPACE_VOLUME_CREATION_GRACE_MS;
    const staleVolumes: string[] = [];

    for (const volumeName of volumeNames) {
      const inspection = inspections.get(volumeName);
      const labeledSessionId = inspection?.Labels?.[WORKSPACE_SESSION_LABEL]?.trim();
      if (labeledSessionId && activeSessionIds.has(labeledSessionId)) {
        continue;
      }
      // Volumes created before the durable session label was introduced remain
      // recoverable when their unmodified name token matches a tracked session.
      const workspaceKey = this.extractWorkspaceKey(volumeName);
      if (!workspaceKey) {
        continue;
      }
      if (activeSessionIds.has(workspaceKey)) {
        continue;
      }
      const createdAt = Date.parse(inspection?.CreatedAt || "");
      // A workspace is created before its provider session is persisted. Never
      // let an overlapping startup scan delete that short-lived untracked
      // window and cause Docker to recreate an empty volume at launch.
      if (Number.isFinite(createdAt) && createdAt >= recentCutoff) {
        continue;
      }
      staleVolumes.push(volumeName);
    }

    return await this.removeDockerItems(["volume", "rm", "-f"], staleVolumes);
  }

  private async pruneOrphanedLoginContainers(): Promise<string[]> {
    const result = await this.runDocker(["ps", "-aq", "--filter", "label=code-ux.login=true", "--filter", `label=${getRuntimeOwnerLabel()}`]);
    if (!result) {
      return [];
    }

    return await this.removeDockerItems(["rm", "-f", "-v"], this.parseLines(result.stdout));
  }

  private async pruneOrphanedProviderContainers(): Promise<string[]> {
    // Provider clients cannot be reattached after the Code UX process exits.
    // Remove their owner-scoped container generation in every state. This also
    // covers `docker run --rm` clients interrupted after daemon create but
    // before start, which otherwise remain in `created` forever.
    const result = await this.runDocker([
      "ps",
      "-aq",
      "--filter", "label=code-ux.managed=true",
      "--filter", "label=code-ux.command",
      "--filter", `label=${getRuntimeOwnerLabel()}`,
    ]);
    if (!result) {
      return [];
    }

    return await this.removeDockerItems(["rm", "-f", "-v"], this.parseLines(result.stdout));
  }

  private async pruneProviderToolVolumes(): Promise<string[]> {
    const listed = await this.runDocker(["volume", "ls", "-q", "--filter", "label=ai.codeux.asset=provider-tool", "--filter", `label=${getRuntimeOwnerLabel()}`]);
    const names = this.parseLines(listed?.stdout);
    if (names.length === 0) return [];
    const [active, inspections] = await Promise.all([
      this.readActiveProviderToolVolumes(),
      this.readVolumeInspections(names),
    ]);
    const inspected = names.flatMap((name) => {
      const entry = inspections.get(name);
      return entry ? [{
        name,
        provider: entry.Labels?.["ai.codeux.provider"] || "unknown",
        createdAt: Date.parse(entry.CreatedAt || "") || 0,
      }] : [];
    });
    const newestByProvider = new Map<string, Set<string>>();
    for (const item of [...inspected].sort((left, right) => right.createdAt - left.createdAt)) {
      const keep = newestByProvider.get(item.provider) ?? new Set<string>();
      if (keep.size < 2) keep.add(item.name);
      newestByProvider.set(item.provider, keep);
    }
    const cutoff = Date.now() - PROVIDER_TOOL_RETENTION_MS;
    const stale = inspected
      .filter((item) => item.createdAt > 0 && item.createdAt < cutoff)
      .filter((item) => !active.has(item.name) && !newestByProvider.get(item.provider)?.has(item.name))
      .map((item) => item.name);
    return await this.removeDockerItems(["volume", "rm", "-f"], stale);
  }

  private async readActiveProviderToolVolumes(): Promise<Set<string>> {
    try {
      const statePath = path.join(os.homedir(), ".code-ux", "runtime", "provider-tools.json");
      const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, { volumeName?: unknown }>;
      return new Set(Object.values(parsed)
        .map((entry) => typeof entry?.volumeName === "string" ? entry.volumeName : "")
        .filter(Boolean));
    } catch {
      return new Set();
    }
  }

  private async prunePlaywrightBrowserVolumes(): Promise<string[]> {
    const listed = await this.runDocker(["volume", "ls", "-q", "--filter", "label=ai.codeux.asset=playwright-browser", "--filter", `label=${getRuntimeOwnerLabel()}`]);
    const names = this.parseLines(listed?.stdout);
    if (names.length === 0) return [];
    const [active, inspections] = await Promise.all([
      this.readActivePlaywrightBrowserVolumes(),
      this.readVolumeInspections(names),
    ]);
    const inspected = names.flatMap((name) => {
      const entry = inspections.get(name);
      return entry ? [{ name, createdAt: Date.parse(entry.CreatedAt || "") || 0 }] : [];
    });
    const newest = new Set(
      [...inspected]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 2)
        .map((item) => item.name),
    );
    const cutoff = Date.now() - PROVIDER_TOOL_RETENTION_MS;
    const stale = inspected
      .filter((item) => item.createdAt > 0 && item.createdAt < cutoff)
      .filter((item) => !active.has(item.name) && !newest.has(item.name))
      .map((item) => item.name);
    return await this.removeDockerItems(["volume", "rm", "-f"], stale);
  }

  private async readActivePlaywrightBrowserVolumes(): Promise<Set<string>> {
    try {
      const statePath = path.join(os.homedir(), ".code-ux", "runtime", "playwright-browser.json");
      const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, { volumeName?: unknown }>;
      return new Set(Object.values(parsed)
        .map((entry) => typeof entry?.volumeName === "string" ? entry.volumeName : "")
        .filter(Boolean));
    } catch {
      return new Set();
    }
  }

  private async pruneOrphanedHelperContainers(): Promise<string[]> {
    // Scope cleanup to this state home. An isolated test runtime may share the daemon with a live
    // app, and unscoped removal would terminate Git operations in that other runtime.
    const result = await this.runDocker(["ps", "-aq", "--filter", "label=code-ux.helper", "--filter", `label=${getRuntimeOwnerLabel()}`]);
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

      const removed = await Promise.all(tempDirsToPrune.map(async (tempDir) => {
        const fullPath = path.join(credentialsParentDir, tempDir);
        try {
          await this.fileSystemSemaphore.run(
            async () => await fs.rm(fullPath, { recursive: true, force: true }),
          );
          return tempDir;
        } catch {
          // Ignore deletion errors on individual directories
          return null;
        }
      }));
      return removed.filter((tempDir): tempDir is string => tempDir !== null);
    } catch {
      // If credentials directory doesn't exist or is not readable, just return empty array
      return [];
    }
  }

  private async runDocker(args: string[]): Promise<CommandResult | null> {
    return await this.dockerSemaphore.run(async () => {
      try {
        return await runCommandStrict("docker", args, process.cwd(), process.env, { timeout: DOCKER_PRUNE_TIMEOUT_MS });
      } catch {
        return null;
      }
    });
  }

  private parseLines(value: string | undefined): string[] {
    return (value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private async removeDockerItems(baseArgs: string[], itemNames: string[]): Promise<string[]> {
    const batchResults = await Promise.all(this.toDockerBatches(itemNames).map(async (batch) => {
      const result = await this.runDocker([...baseArgs, ...batch]);
      if (result?.ok) {
        return batch;
      }
      if (batch.length === 1) {
        return [];
      }
      const individualResults = await Promise.all(batch.map(async (item) => {
        const singleResult = await this.runDocker([...baseArgs, item]);
        return singleResult?.ok ? item : null;
      }));
      return individualResults.filter((item): item is string => item !== null);
    }));
    return batchResults.flat();
  }

  private async readVolumeInspections(
    volumeNames: string[],
  ): Promise<Map<string, DockerVolumeInspection>> {
    const inspections = new Map<string, DockerVolumeInspection>();
    const batchResults = await Promise.all(this.toDockerBatches(volumeNames).map(async (batch) => {
      const result = await this.runDocker(["volume", "inspect", ...batch]);
      const entries = this.parseVolumeInspections(batch, result);
      if (entries.length > 0 || batch.length === 1) {
        return entries;
      }

      // A volume can disappear between list and inspect. Preserve the former
      // per-volume behavior for the rest of the batch without serializing it.
      const individualEntries = await Promise.all(batch.map(async (name) => (
        this.parseVolumeInspections(
          [name],
          await this.runDocker(["volume", "inspect", name]),
        )
      )));
      return individualEntries.flat();
    }));

    for (const [name, entry] of batchResults.flat()) {
      inspections.set(name, entry);
    }
    return inspections;
  }

  private parseVolumeInspections(
    requestedNames: string[],
    result: CommandResult | null,
  ): Array<[string, DockerVolumeInspection]> {
    if (!result?.ok) return [];
    try {
      const entries = JSON.parse(result.stdout) as DockerVolumeInspection[];
      return entries.flatMap((entry, index) => {
        const name = entry?.Name || requestedNames[index];
        return name ? [[name, entry] as [string, DockerVolumeInspection]] : [];
      });
    } catch {
      return [];
    }
  }

  private toDockerBatches(itemNames: string[]): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < itemNames.length; index += this.dockerBatchSize) {
      batches.push(itemNames.slice(index, index + this.dockerBatchSize));
    }
    return batches;
  }

  private clearCleanup(cleanup: Promise<DockerAssetPruneResult>): void {
    if (this.cleanupInFlight === cleanup) {
      this.cleanupInFlight = null;
    }
  }

  private extractWorkspaceKey(volumeName: string): string | null {
    const workspaceVolumeName = volumeName.endsWith(RUNTIME_VOLUME_SUFFIX)
      ? volumeName.slice(0, -RUNTIME_VOLUME_SUFFIX.length)
      : volumeName;
    const match = workspaceVolumeName.match(/^code-ux-.+-([a-f0-9]{12})-(.+)$/);
    return match?.[2] || null;
  }
}
