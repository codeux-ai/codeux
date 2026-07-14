import * as fs from "fs/promises";
import * as path from "path";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { AsyncSemaphore } from "../shared/async-semaphore.js";
import { type Logger } from "../shared/logging/logger.js";
import {
  getCodexRuntimeHomePath,
  getDockerRuntimeBaseRoot,
  resolveDockerRuntimeRoot,
} from "../infrastructure/providers/cli/docker-runtime-paths.js";

export interface DockerRuntimePruneResult {
  prunedPaths: string[];
}

export interface DockerRuntimePruneServiceOptions {
  runtimeBaseRoots?: string[];
  resolveRuntimeRoot?: (repoPath: string) => string;
  fileSystemConcurrency?: number;
}

const STALE_RUNTIME_HOME_MS = 15 * 60 * 1000;
const DEFAULT_FILE_SYSTEM_CONCURRENCY = 8;
const SHARED_RUNTIME_TMP_DIRS = [
  ["home", ".gemini", "tmp"],
  ["home", ".codex", "tmp"],
] as const;

export class DockerRuntimePruneService {
  private readonly fileSystemSemaphore: AsyncSemaphore;
  private cleanupInFlight: Promise<DockerRuntimePruneResult> | null = null;

  constructor(
    private readonly sessionTrackingRepository: SessionTrackingRepository,
    private readonly logger?: Logger,
    private readonly options: DockerRuntimePruneServiceOptions = {},
  ) {
    this.fileSystemSemaphore = new AsyncSemaphore(
      options.fileSystemConcurrency ?? DEFAULT_FILE_SYSTEM_CONCURRENCY,
    );
  }

  cleanup(now = new Date()): Promise<DockerRuntimePruneResult> {
    if (this.cleanupInFlight) {
      return this.cleanupInFlight;
    }

    const cleanup = this.performCleanup(now);
    this.cleanupInFlight = cleanup;
    void cleanup.then(
      () => this.clearCleanup(cleanup),
      () => this.clearCleanup(cleanup),
    );
    return cleanup;
  }

  private async performCleanup(now: Date): Promise<DockerRuntimePruneResult> {
    const sessions = this.sessionTrackingRepository.listTrackedCliSessions();
    const activeRuntimeRoots = new Set<string>();
    const activeCodexHomes = new Set<string>();

    for (const session of sessions) {
      if (session.state !== "RUNNING" || !session.repoPath) {
        continue;
      }
      const runtimeRoot = (this.options.resolveRuntimeRoot || resolveDockerRuntimeRoot)(session.repoPath);
      activeRuntimeRoots.add(runtimeRoot);
      if (session.provider === "codex") {
        activeCodexHomes.add(getCodexRuntimeHomePath(runtimeRoot, session.id));
      }
    }

    const runtimeRoots = new Set((await Promise.all(
      (this.options.runtimeBaseRoots || [getDockerRuntimeBaseRoot()])
        .map((runtimeBaseRoot) => this.listChildDirectories(runtimeBaseRoot)),
    )).flat());
    const prunedPaths = (await Promise.all([...runtimeRoots].map(async (runtimeRoot) => {
      const [codexHomes, sharedTemp] = await Promise.all([
        this.pruneCodexHomes(runtimeRoot, activeCodexHomes, now),
        activeRuntimeRoots.has(runtimeRoot)
          ? Promise.resolve([])
          : this.pruneSharedRuntimeTemp(runtimeRoot, now),
      ]);
      return [...codexHomes, ...sharedTemp];
    }))).flat().sort();

    if (prunedPaths.length > 0) {
      this.logger?.info("Pruned stale Docker runtime paths", {
        prunedCount: prunedPaths.length,
        samplePaths: prunedPaths.slice(0, 5),
        additionalPrunedCount: Math.max(prunedPaths.length - 5, 0),
      });
    }

    return { prunedPaths };
  }

  private async pruneCodexHomes(
    runtimeRoot: string,
    activeCodexHomes: Set<string>,
    now: Date,
  ): Promise<string[]> {
    const homeDirs = await this.listChildDirectories(runtimeRoot);
    const removed = await Promise.all(homeDirs.map(async (homeDir) => {
      if (!path.basename(homeDir).startsWith("home-codex-")) {
        return null;
      }
      if (
        activeCodexHomes.has(homeDir)
        || !await this.isOlderThan(homeDir, now, STALE_RUNTIME_HOME_MS)
      ) {
        return null;
      }
      return await this.removePath(homeDir);
    }));
    return removed.filter((targetPath): targetPath is string => targetPath !== null);
  }

  private async pruneSharedRuntimeTemp(runtimeRoot: string, now: Date): Promise<string[]> {
    const removed = await Promise.all(SHARED_RUNTIME_TMP_DIRS.map(async (segments) => {
      const tempRoot = path.join(runtimeRoot, ...segments);
      const tempPaths = await this.listChildPaths(tempRoot);
      return await Promise.all(tempPaths.map(async (tempPath) => {
        if (!await this.isOlderThan(tempPath, now, STALE_RUNTIME_HOME_MS)) {
          return null;
        }
        return await this.removePath(tempPath);
      }));
    }));
    return removed.flat().filter((targetPath): targetPath is string => targetPath !== null);
  }

  private async listChildDirectories(targetPath: string): Promise<string[]> {
    try {
      const entries = await this.fileSystemSemaphore.run(
        async () => await fs.readdir(targetPath, { withFileTypes: true }),
      );
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(targetPath, entry.name));
    } catch {
      return [];
    }
  }

  private async listChildPaths(targetPath: string): Promise<string[]> {
    try {
      const entries = await this.fileSystemSemaphore.run(
        async () => await fs.readdir(targetPath, { withFileTypes: true }),
      );
      return entries
        .map((entry) => path.join(targetPath, entry.name));
    } catch {
      return [];
    }
  }

  private async isOlderThan(targetPath: string, now: Date, ageMs: number): Promise<boolean> {
    try {
      const stats = await this.fileSystemSemaphore.run(async () => await fs.stat(targetPath));
      return now.getTime() - stats.mtimeMs >= ageMs;
    } catch {
      return false;
    }
  }

  private async removePath(targetPath: string): Promise<string | null> {
    try {
      await this.fileSystemSemaphore.run(
        async () => await fs.rm(targetPath, { recursive: true, force: true }),
      );
      return targetPath;
    } catch {
      // Ignore best-effort cleanup failures.
      return null;
    }
  }

  private clearCleanup(cleanup: Promise<DockerRuntimePruneResult>): void {
    if (this.cleanupInFlight === cleanup) {
      this.cleanupInFlight = null;
    }
  }
}
