import * as fs from "fs/promises";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DockerSetupImageCache } from "../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js";
import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runStreamingCommand: vi.fn(),
}));

describe("DockerSetupImageCache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue("#!/usr/bin/env bash\necho ready\n");
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "built", stderr: "" });
  });

  it("returns the base image when cache is disabled", async () => {
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.sprint-os/container/setup.sh",
      cacheEnabled: false,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath) => sourcePath,
    });

    expect(result).toEqual({
      image: "node:24-bookworm",
      runSetupScriptAtRuntime: true,
    });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("reuses an existing cached image when present", async () => {
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockResolvedValueOnce({ ok: true, code: 0, stdout: "exists", stderr: "" });

    const onActivity = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.sprint-os/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result.runSetupScriptAtRuntime).toBe(false);
    expect(result.image).toMatch(/^sprint-os-setup-cache:/);
    expect(runStreamingCommand).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Using cached Docker setup image"));
  });

  it("builds the cached image on a cache miss", async () => {
    const onActivity = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.sprint-os/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result.runSetupScriptAtRuntime).toBe(false);
    expect(result.image).toMatch(/^sprint-os-setup-cache:/);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(runStreamingCommand).toHaveBeenNthCalledWith(
      2,
      "docker",
      expect.arrayContaining(["build", "-t", result.image, expect.stringContaining("/mapped/runtime/setup-image-cache/")]),
      "/repo",
      process.env,
      expect.objectContaining({
        onStdoutLine: expect.any(Function),
        onStderrLine: expect.any(Function),
      })
    );
  });

  it("falls back to runtime setup when the build fails", async () => {
    vi.mocked(runStreamingCommand)
      .mockReset()
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "build failed" });

    const onActivity = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.sprint-os/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result).toEqual({
      image: "node:24-bookworm",
      runSetupScriptAtRuntime: true,
    });
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Falling back to runtime setup script"));
  });
});
