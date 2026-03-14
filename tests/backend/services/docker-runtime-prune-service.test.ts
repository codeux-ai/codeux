import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DockerRuntimePruneService } from "../../../src/services/docker-runtime-prune-service.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-docker-runtime-prune-"));
  tempDirs.push(dir);
  return dir;
};

const setOldTimestamp = async (targetPath: string, iso: string): Promise<void> => {
  const when = new Date(iso);
  await fs.utimes(targetPath, when, when);
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("DockerRuntimePruneService", () => {
  it("prunes stale codex runtime homes while keeping active session homes", async () => {
    const root = await makeTempDir();
    const runtimeBase = path.join(root, "runtime");
    const repoRuntime = path.join(runtimeBase, "repo-a");
    const staleHome = path.join(repoRuntime, "home-codex-cli-codex-stale");
    const activeHome = path.join(repoRuntime, "home-codex-cli-codex-active");
    await fs.mkdir(staleHome, { recursive: true });
    await fs.mkdir(activeHome, { recursive: true });
    await setOldTimestamp(staleHome, "2026-03-14T00:00:00.000Z");
    await setOldTimestamp(activeHome, "2026-03-14T00:00:00.000Z");

    const sessionRepo = new SessionTrackingRepository(path.join(root, "session-tracking.db"));
    sessionRepo.createSession({
      id: "cli-codex-stale",
      provider: "codex",
      state: "FAILED",
      repoPath: "/repo/a",
    });
    sessionRepo.createSession({
      id: "cli-codex-active",
      provider: "codex",
      state: "RUNNING",
      repoPath: "/repo/a",
    });

    const service = new DockerRuntimePruneService(sessionRepo, undefined, {
      runtimeBaseRoots: [runtimeBase],
      resolveRuntimeRoot: () => repoRuntime,
    });

    const result = service.cleanup(new Date("2026-03-14T01:00:00.000Z"));

    expect(result.prunedPaths).toContain(staleHome);
    await expect(fs.access(staleHome)).rejects.toThrow();
    await expect(fs.access(activeHome)).resolves.toBeUndefined();
  });

  it("prunes stale shared gemini tmp when the runtime root is not active", async () => {
    const root = await makeTempDir();
    const runtimeBase = path.join(root, "runtime");
    const repoRuntime = path.join(runtimeBase, "repo-b");
    const staleTempDir = path.join(repoRuntime, "home", ".gemini", "tmp", "stale-task");
    await fs.mkdir(staleTempDir, { recursive: true });
    await setOldTimestamp(staleTempDir, "2026-03-14T00:00:00.000Z");

    const sessionRepo = new SessionTrackingRepository(path.join(root, "session-tracking.db"));
    sessionRepo.createSession({
      id: "cli-gemini-finished",
      provider: "gemini",
      state: "COMPLETED",
      repoPath: "/repo/b",
    });

    const service = new DockerRuntimePruneService(sessionRepo, undefined, {
      runtimeBaseRoots: [runtimeBase],
      resolveRuntimeRoot: () => repoRuntime,
    });

    const result = service.cleanup(new Date("2026-03-14T01:00:00.000Z"));

    expect(result.prunedPaths).toContain(staleTempDir);
    await expect(fs.access(staleTempDir)).rejects.toThrow();
  });

  it("keeps shared gemini tmp when the runtime root still has an active session", async () => {
    const root = await makeTempDir();
    const runtimeBase = path.join(root, "runtime");
    const repoRuntime = path.join(runtimeBase, "repo-c");
    const staleTempDir = path.join(repoRuntime, "home", ".gemini", "tmp", "active-task");
    await fs.mkdir(staleTempDir, { recursive: true });
    await setOldTimestamp(staleTempDir, "2026-03-14T00:00:00.000Z");

    const sessionRepo = new SessionTrackingRepository(path.join(root, "session-tracking.db"));
    sessionRepo.createSession({
      id: "cli-gemini-running",
      provider: "gemini",
      state: "RUNNING",
      repoPath: "/repo/c",
    });

    const service = new DockerRuntimePruneService(sessionRepo, undefined, {
      runtimeBaseRoots: [runtimeBase],
      resolveRuntimeRoot: () => repoRuntime,
    });

    const result = service.cleanup(new Date("2026-03-14T01:00:00.000Z"));

    expect(result.prunedPaths).not.toContain(staleTempDir);
    await expect(fs.access(staleTempDir)).resolves.toBeUndefined();
  });
});
