import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DockerAssetPruneService } from "../../../src/services/docker-asset-prune-service.js";

import * as fs from "fs/promises";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe("DockerAssetPruneService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prunes stale workspace volumes while preserving cached setup images on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => [
        { id: "cli-codex-active", state: "RUNNING", provider: "codex", repoPath: "/repo/a", updateTime: "" },
      ]),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls") {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-active",
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      return {
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
      } as any;
    });

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedWorkspaceVolumes).toEqual(["code-ux-repo-aaaaaaaaaaaa-cli-codex-stale"]);
    expect(result.prunedSetupImages).toEqual([]);
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["volume", "rm", "-f", "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale"], expect.any(String));
    expect(runCommandStrict).not.toHaveBeenCalledWith("docker", ["image", "rm", "-f", expect.any(String)], expect.any(String));
  });

  it("prunes orphaned login containers on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "ps" && args.includes("label=code-ux.login=true")) {
        return {
          ok: true,
          stdout: [
            "container-id-1",
            "container-id-2",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      if (args[0] === "rm" && args[1] === "-f") {
        return {
          ok: true,
          stdout: "container-deleted",
          stderr: "",
          code: 0,
        } as any;
      }
      return {
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
      } as any;
    });

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedLoginContainers).toEqual(["container-id-1", "container-id-2"]);
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "container-id-1"], expect.any(String));
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "container-id-2"], expect.any(String));
  });

  it("prunes temporary credentials directories on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;

    const mockReaddir = vi.fn().mockResolvedValue([
      { isDirectory: () => true, name: "gemini-temp-session123" },
      { isDirectory: () => true, name: "claude-code" },
      { isDirectory: () => false, name: "gemini-temp-other" },
    ]);
    const mockRm = vi.fn().mockResolvedValue(undefined);

    vi.mocked(fs.readdir).mockImplementation(mockReaddir);
    vi.mocked(fs.rm).mockImplementation(mockRm);

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedTempCredentialsDirs).toEqual(["gemini-temp-session123"]);
    expect(fs.readdir).toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining("gemini-temp-session123"),
      { recursive: true, force: true }
    );
  });
});
