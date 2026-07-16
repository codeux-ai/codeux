import * as fs from "fs/promises";
import { setTimeout as delay } from "timers/promises";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DockerSetupImageCache, type DockerSetupImageCacheProgress } from "../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js";
import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";

vi.mock("fs/promises");
vi.mock("timers/promises", () => ({
  setTimeout: vi.fn(async () => undefined),
}));
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
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      if (String(filePath).includes("setup-image-cache")) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return "#!/usr/bin/env bash\necho ready\n";
    });
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

  it("reuses a process-verified image without another Docker inspect or cache-file write", async () => {
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockResolvedValue({ ok: true, code: 0, stdout: "exists", stderr: "" });
    const cache = new DockerSetupImageCache();
    const input = {
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath: string) => `/mapped${sourcePath}`,
    };

    const first = await cache.resolveImage(input);
    const second = await cache.resolveImage(input);

    expect(second).toEqual(first);
    expect(runStreamingCommand).toHaveBeenCalledTimes(1);
    expect(runStreamingCommand).toHaveBeenCalledWith(
      "docker",
      ["image", "inspect", first.image],
      "/repo",
      process.env,
      expect.any(Object),
    );
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("invalidates positive readiness so externally removed images are inspected again", async () => {
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockResolvedValue({ ok: true, code: 0, stdout: "exists", stderr: "" });
    const cache = new DockerSetupImageCache();
    const input = {
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath: string) => `/mapped${sourcePath}`,
    };

    const first = await cache.resolveImage(input);
    cache.invalidateImage(first.image);
    await cache.resolveImage(input);

    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
  });

  it("builds the cached image on a cache miss", async () => {
    const onActivity = vi.fn();
    const onProgress = vi.fn();
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockImplementationOnce(async (_command, _args, _cwd, _env, options: any) => {
        options.onStdoutLine?.("#1 [internal] load build definition from Dockerfile");
        options.onStderrLine?.("Step 2/4 : COPY setup.sh /tmp/code-ux-setup.sh");
        options.onStdoutLine?.("#3 [3/4] RUN bash /tmp/code-ux-setup.sh");
        return { ok: true, code: 0, stdout: "built", stderr: "" };
      });
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      onProgress,
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
    expect(dockerfileWrite?.[1]).not.toContain("ENV PLAYWRIGHT_BROWSERS_PATH");
    const progressEvents = onProgress.mock.calls.map(([event]) => event as DockerSetupImageCacheProgress);
    expect(progressEvents.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "cache_miss",
      "build_start",
      "build_step",
      "build_success",
    ]));
    expect(progressEvents.some((event) => event.stepText?.includes("COPY setup.sh"))).toBe(true);
    expect(progressEvents.map((event) => event.progressPercent)).toEqual(
      [...progressEvents.map((event) => event.progressPercent)].sort((a, b) => a - b),
    );
    expect(progressEvents.at(-1)?.progressPercent).toBe(100);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("first build may take a few minutes"));
  });

  it("does not rewrite unchanged setup build-context files on a rebuild", async () => {
    const fileContents = new Map<string, string>();
    const setupScript = "#!/usr/bin/env bash\necho ready\n";
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath === "/repo/.code-ux/container/setup.sh") {
        return setupScript;
      }
      const content = fileContents.get(normalizedPath);
      if (content === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return content;
    });
    vi.mocked(fs.writeFile).mockImplementation(async (filePath, content) => {
      fileContents.set(String(filePath), String(content));
    });
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockImplementation(async (_command, args) => (
      args[0] === "build"
        ? { ok: true, code: 0, stdout: "built", stderr: "" }
        : { ok: false, code: 1, stdout: "", stderr: "missing" }
    ));
    const cache = new DockerSetupImageCache();
    const input = {
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath: string) => `/mapped${sourcePath}`,
    };

    const first = await cache.resolveImage(input);
    cache.invalidateImage(first.image);
    await cache.resolveImage(input);

    expect(vi.mocked(runStreamingCommand).mock.calls.filter(([, args]) => args[0] === "build")).toHaveLength(2);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it("starts cross-process build-lock polling after 25ms instead of one second", async () => {
    let lockAttempts = 0;
    vi.mocked(fs.mkdir).mockImplementation(async (targetPath) => {
      if (String(targetPath).endsWith(".build-lock") && lockAttempts++ === 0) {
        throw Object.assign(new Error("locked"), { code: "EEXIST" });
      }
      return undefined;
    });
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockImplementation(async (_command, args) => (
      args[0] === "build"
        ? { ok: true, code: 0, stdout: "built", stderr: "" }
        : { ok: false, code: 1, stdout: "", stderr: "missing" }
    ));

    await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(25, undefined, { signal: undefined });
  });

  it("bakes Playwright browser location into cached images when enabled", async () => {
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      installPlaywrightBrowsers: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result.runSetupScriptAtRuntime).toBe(false);
    const dockerfileWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("Dockerfile"));
    expect(dockerfileWrite?.[1]).toContain("ENV CODE_UX_INSTALL_PLAYWRIGHT=1");
    expect(dockerfileWrite?.[1]).toContain("ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(dockerfileWrite?.[1]).toContain("npx -y playwright@latest install --with-deps chromium");
    expect(dockerfileWrite?.[1]).toContain("chmod -R a+rX \"$PLAYWRIGHT_BROWSERS_PATH\"");
    expect(dockerfileWrite?.[1]).toContain("rm -rf /var/lib/apt/lists/*");
  });

  it("changes the cache key when setup script or Dockerfile behavior changes", async () => {
    vi.mocked(runStreamingCommand).mockReset();
    vi.mocked(runStreamingCommand).mockResolvedValue({ ok: true, code: 0, stdout: "exists", stderr: "" });
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce("#!/usr/bin/env bash\necho setup-a\n")
      .mockResolvedValueOnce("#!/usr/bin/env bash\necho setup-b\n")
      .mockResolvedValueOnce("#!/usr/bin/env bash\necho setup-b\n");

    const cache = new DockerSetupImageCache();
    const commonInput = {
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      mapSourcePathForDaemon: (sourcePath: string) => `/mapped${sourcePath}`,
    };

    const first = await cache.resolveImage(commonInput);
    const scriptChanged = await cache.resolveImage(commonInput);
    const dockerfileChanged = await cache.resolveImage({
      ...commonInput,
      installPlaywrightBrowsers: true,
    });

    expect(first.image).not.toBe(scriptChanged.image);
    expect(scriptChanged.image).not.toBe(dockerfileChanged.image);
  });

  it("falls back to runtime setup when the build fails", async () => {
    vi.mocked(runStreamingCommand)
      .mockReset()
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "missing" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "build failed" });

    const onActivity = vi.fn();
    const onProgress = vi.fn();
    const result = await new DockerSetupImageCache().resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity,
      onProgress,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    expect(result).toEqual({
      image: "node:24-bookworm",
      runSetupScriptAtRuntime: true,
    });
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Falling back to runtime setup script"));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      kind: "build_failure_fallback",
      progressPercent: 100,
    }));
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
    vi.mocked(runStreamingCommand).mockImplementation(async (_command, args, _cwd, _env, options: any) => {
      if (args[0] === "image") {
        return { ok: false, code: 1, stdout: "", stderr: "missing" } as any;
      }
      return await new Promise((resolve) => {
        finishBuild = (value) => {
          options.onStdoutLine?.("Step 1/2 : FROM node:24-bookworm");
          options.onStdoutLine?.("Step 2/2 : RUN echo ready");
          resolve(value);
        };
      });
    });

    const cache = new DockerSetupImageCache();
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const first = cache.resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      onProgress: firstProgress,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });
    const second = cache.resolveImage({
      baseImage: "node:24-bookworm",
      setupScriptPath: "/repo/.code-ux/container/setup.sh",
      cacheEnabled: true,
      runtimeRoot: "/runtime",
      repoPath: "/repo",
      onActivity: vi.fn(),
      onProgress: secondProgress,
      mapSourcePathForDaemon: (sourcePath) => `/mapped${sourcePath}`,
    });

    await vi.waitFor(() => expect(finishBuild).toBeDefined());
    finishBuild?.({ ok: true, code: 0, stdout: "built", stderr: "" });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(vi.mocked(runStreamingCommand).mock.calls.filter(([, args]) => args[0] === "build")).toHaveLength(1);
    expect(firstProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "build_step", stepText: "RUN echo ready" }));
    expect(secondProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "lock_wait" }));
    expect(secondProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "build_step", stepText: "RUN echo ready" }));
    expect(secondProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: "build_success", progressPercent: 100 }));
  });
});
