import * as fs from "fs";
import * as path from "path";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
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
}

const STALE_RUNTIME_HOME_MS = 15 * 60 * 1000;
const SHARED_RUNTIME_TMP_DIRS = [
  ["home", ".gemini", "tmp"],
  ["home", ".codex", "tmp"],
] as const;

export class DockerRuntimePruneService {
  constructor(
    private readonly sessionTrackingRepository: SessionTrackingRepository,
    private readonly logger?: Logger,
    private readonly options: DockerRuntimePruneServiceOptions = {},
  ) {}

  cleanup(now = new Date()): DockerRuntimePruneResult {
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

    const prunedPaths: string[] = [];
    for (const runtimeBaseRoot of this.options.runtimeBaseRoots || [getDockerRuntimeBaseRoot()]) {
      for (const runtimeRoot of this.listChildDirectories(runtimeBaseRoot)) {
        this.pruneCodexHomes(runtimeRoot, activeCodexHomes, now, prunedPaths);
        if (!activeRuntimeRoots.has(runtimeRoot)) {
          this.pruneSharedRuntimeTemp(runtimeRoot, now, prunedPaths);
        }
      }
    }

    if (prunedPaths.length > 0) {
      this.logger?.info("Pruned stale Docker runtime paths", {
        prunedCount: prunedPaths.length,
        samplePaths: prunedPaths.slice(0, 5),
        additionalPrunedCount: Math.max(prunedPaths.length - 5, 0),
      });
    }

    return { prunedPaths };
  }

  private pruneCodexHomes(
    runtimeRoot: string,
    activeCodexHomes: Set<string>,
    now: Date,
    prunedPaths: string[],
  ): void {
    for (const homeDir of this.listChildDirectories(runtimeRoot)) {
      if (!path.basename(homeDir).startsWith("home-codex-")) {
        continue;
      }
      if (activeCodexHomes.has(homeDir) || !this.isOlderThan(homeDir, now, STALE_RUNTIME_HOME_MS)) {
        continue;
      }
      this.removePath(homeDir, prunedPaths);
    }
  }

  private pruneSharedRuntimeTemp(runtimeRoot: string, now: Date, prunedPaths: string[]): void {
    for (const segments of SHARED_RUNTIME_TMP_DIRS) {
      const tempRoot = path.join(runtimeRoot, ...segments);
      for (const tempPath of this.listChildPaths(tempRoot)) {
        if (!this.isOlderThan(tempPath, now, STALE_RUNTIME_HOME_MS)) {
          continue;
        }
        this.removePath(tempPath, prunedPaths);
      }
    }
  }

  private listChildDirectories(targetPath: string): string[] {
    try {
      return fs.readdirSync(targetPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(targetPath, entry.name));
    } catch {
      return [];
    }
  }

  private listChildPaths(targetPath: string): string[] {
    try {
      return fs.readdirSync(targetPath, { withFileTypes: true })
        .map((entry) => path.join(targetPath, entry.name));
    } catch {
      return [];
    }
  }

  private isOlderThan(targetPath: string, now: Date, ageMs: number): boolean {
    try {
      const stats = fs.statSync(targetPath);
      return now.getTime() - stats.mtimeMs >= ageMs;
    } catch {
      return false;
    }
  }

  private removePath(targetPath: string, prunedPaths: string[]): void {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      prunedPaths.push(targetPath);
    } catch {
      // Ignore best-effort cleanup failures.
    }
  }
}
