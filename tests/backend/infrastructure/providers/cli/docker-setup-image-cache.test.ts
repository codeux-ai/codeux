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
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue({ mtimeMs: Date.now() } as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue("#!/usr/bin/env bash\necho ready\n");
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "built", stderr: "" });
  });

  it("returns the base image when cache is disabled", async () => {
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
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
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result.runSetupScriptAtRuntime).toBe(false);
    expect(result.image).toMatch(/^code-ux-setup-cache-node-24-bookworm:/);
    expect(runStreamingCommand).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Using cached Docker setup image"));
  });

  it("builds the cached image on a cache miss", async () => {
    const onActivity = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result.runSetupScriptAtRuntime).toBe(false);
    expect(result.image).toMatch(/^code-ux-setup-cache-node-24-bookworm:/);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(runStreamingCommand).toHaveBeenNthCalledWith(
      3,
      "docker",
      expect.arrayContaining(["build", "-t", result.image, expect.stringMatching(/[\\/]mapped[\\/]runtime[\\/]setup-image-cache[\\/]/)]),
      "/repo",
      process.env,
      expect.objectContaining({
        onStdoutLine: expect.any(Function),
        onStderrLine: expect.any(Function),
      })
    );
    const dockerfileWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("Dockerfile"));
    expect(dockerfileWrite?.[1]).toContain('LABEL org.opencontainers.image.title="Code UX setup cache"');
    expect(dockerfileWrite?.[1]).toContain('LABEL ai.codeux.base-image="node:24-bookworm"');
  });

  it("falls back to runtime setup when the build fails", async () => {
    vi.mocked(runStreamingCommand)
      .mockReset()
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "build failed" });

    const onActivity = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
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

  it("falls back to runtime setup instead of building when buildIfMissing is false", async () => {
    vi.mocked(runStreamingCommand)
      .mockReset()
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" });

    const onActivity = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      buildIfMissing: false,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result).toEqual({
      image: "node:24-bookworm",
      runSetupScriptAtRuntime: true,
    });
    expect(runStreamingCommand).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Cached Docker setup image"));
  });

  it("deduplicates concurrent setup image builds in the same process", async () => {
    let finishBuild: ((value: { ok: true; code: 0; stdout: string; stderr: string }) => void) | undefined;
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockImplementation(async (_command, args) => {
      if (args[0] === "image") {
        return { ok: false, code: 1, stdout: "", stderr: "missing" } as any;
      }
      return await new Promise((resolve) => {
        finishBuild = resolve;
      });
    });

    const cache = new DockerSetupImageCache();
    const first = cache.resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });
    const second = cache.resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    await vi.waitFor(() => expect(finishBuild).toBeDefined());
    finishBuild?.({ ok: true, code: 0, stdout: "built", stderr: "" });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(vi.mocked(runStreamingCommand).mock.calls.filter(([, args]) => args[0] === "build")).toHaveLength(1);
  });
});
