import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import { DockerRunner } from "../../../../../src/infrastructure/providers/cli/docker-runner.js";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
  runStreamingCommand: vi.fn(),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js", () => ({
  CLAUDE_CODE_MCP_CONFIG_MOUNT: "/opt/provider-config/claude-mcp.json",
  GEMINI_MCP_SETTINGS_MOUNT: "/opt/provider-config/gemini-settings.json",
  CODEX_MCP_CONFIG_MOUNT: "/opt/provider-config/codex-config.toml",
  QWEN_CODE_SETTINGS_MOUNT: "/opt/provider-config/qwen-settings.json",
  ANTIGRAVITY_MCP_CONFIG_MOUNT: "/opt/provider-config/antigravity-mcp.json",
  DockerBootstrapBuilder: vi.fn().mockImplementation(function DockerBootstrapBuilder() {
    return {
    build: vi.fn(() => "bootstrap"),
    };
  }),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-credential-mount-builder.js", () => ({
  DockerCredentialMountBuilder: vi.fn().mockImplementation(function DockerCredentialMountBuilder() {
    return {
    build: vi.fn(async () => []),
    };
  }),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js", () => ({
  DockerSetupImageCache: vi.fn().mockImplementation(function DockerSetupImageCache() {
    return {
      invalidateImage: vi.fn(),
      resolveImage: vi.fn(async () => ({ image: "node:24", runSetupScriptAtRuntime: false })),
    };
  }),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-runtime-paths.js", () => ({
  resolveDockerRuntimeRoot: vi.fn(() => "/runtime-root"),
}));

import { runCommandStrict, runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";
import { DockerSetupImageCache } from "../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js";
import { getRuntimeOwnerId, RUNTIME_OWNER_LABEL } from "../../../../../src/shared/config/runtime-owner.js";

const createRunner = (): DockerRunner => new DockerRunner(
  {
    resolveImage: vi.fn(async () => "node:24"),
    getCompatibilityKey: vi.fn(() => "test-runtime"),
    invalidateImage: vi.fn(),
  } as any,
  {
    invalidatePreparedVolume: vi.fn(),
    prepare: vi.fn(async (provider: string) => ({
      provider,
      volumeName: `code-ux-provider-tool-${provider}-test`,
      version: "1.0.0",
      binary: provider,
      mountPath: "/opt/code-ux/provider-tool",
    })),
  } as any,
  {
    invalidatePreparedVolume: vi.fn(),
    prepare: vi.fn(async () => ({
      volumeName: "code-ux-playwright-browser-test",
      version: "1.61.1",
      mountPath: "/ms-playwright",
    })),
  } as any,
);

describe("DockerRunner", () => {
  let runner: DockerRunner;

  beforeEach(() => {
    runner = createRunner();
    vi.clearAllMocks();
    vi.mocked(fs.mkdtemp).mockResolvedValue("/tmp/code-ux-docker-123");
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue({ uid: 1000, gid: 1000 } as any);
    vi.mocked(fs.access).mockRejectedValue(new Error("missing"));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.chmod).mockResolvedValue(undefined);
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0, signal: null } as any);
    vi.mocked(runStreamingCommand).mockResolvedValue({
      ok: true,
      stdout: "done",
      stderr: "",
      code: 0,
      signal: null,
    } as any);
  });

  it("keeps existing Docker volume workspaces unchanged", async () => {
    const result = await runner.ensureWorkspace({
      cwd: "docker-volume://existing",
      repoPath: "/repo/project",
      sessionId: "session-1",
    });

    expect(result.cwd).toBe("docker-volume://existing");
  });

  it("reuses one setup image cache instance across provider invocations", async () => {
    const sharedRunner = createRunner();
    expect(DockerSetupImageCache).toHaveBeenCalledTimes(1);

    for (const sessionId of ["session-1", "session-2"]) {
      await sharedRunner.runProviderInDocker({
        command: "codex",
        args: ["exec", "--help"],
        cwd: "docker-volume://workspace-1",
        providerEnv: {},
        sessionId,
        providerLabel: "codex",
        workflowSettings: {
          executionMode: "DOCKER",
          containerImage: "node:24",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
        } as any,
        repoPath: "/repo/project",
        onActivity: vi.fn(),
      });
    }

    expect(DockerSetupImageCache).toHaveBeenCalledTimes(1);
    expect((sharedRunner as any).setupImageCache.resolveImage).toHaveBeenCalledTimes(2);
  });

  it("reads only the requested latest transcript byte range and parses helper metadata", async () => {
    const payload = Buffer.from("appended record\n").toString("base64");
    const exec = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: `__CODEUX_CHUNK_V1__\t7:99\t120\t136\t200\t0\n${payload}\n`,
      stderr: "",
    });
    (runner as any).volumeHelperPool = { exec };

    const result = await runner.readLatestWorkspaceFileChunk(
      "docker-volume://workspace-one",
      "/code-ux-runtime-home/.codex/sessions/2026/07/14",
      "*.jsonl",
      { sourceId: "7:99", offset: 120 },
      1024,
    );

    expect(result).toEqual({
      sourceId: "7:99",
      startOffset: 120,
      nextOffset: 136,
      totalBytes: 200,
      contentBase64: payload,
      reset: false,
    });
    expect(exec).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["sh", "-c", expect.stringContaining("start=120")]),
      expect.any(String),
    );
    const helperScript = exec.mock.calls[0]?.[1]?.[2] as string;
    expect(helperScript).toContain("ibs=64k obs=64k");
    expect(helperScript).toContain("iflag=skip_bytes,count_bytes");
    expect(helperScript).not.toMatch(/\bbs=1\b/);
  });

  it("bounds Docker transcript tail reads at eight MiB", async () => {
    const exec = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "tail contents",
      stderr: "",
    });
    (runner as any).volumeHelperPool = { exec };

    await expect(runner.readWorkspaceFileTail(
      "docker-volume://workspace-one",
      "/code-ux-runtime-home/transcript.jsonl",
      64 * 1024 * 1024,
    )).resolves.toBe("tail contents");

    expect(exec).toHaveBeenCalledWith(
      "workspace-one",
      ["tail", "-c", String(8 * 1024 * 1024), "/code-ux-runtime-home/transcript.jsonl"],
      "workspace-one-runtime",
      { maxStdoutChars: 8 * 1024 * 1024 },
    );
  });

  it("creates and cleans up snapshot workspaces for repo paths", async () => {
    const createSnapshotWorkspace = vi.spyOn<any, any>(Object.getPrototypeOf((runner as any).workspaceManager), "createSnapshotWorkspace")
      .mockResolvedValue("docker-volume://snapshot-1");
    const removeWorktree = vi.spyOn<any, any>(Object.getPrototypeOf((runner as any).workspaceManager), "removeWorktree")
      .mockResolvedValue(undefined);

    const result = await runner.ensureWorkspace({
      cwd: "/repo/project",
      repoPath: "/repo/project",
      sessionId: "session-1",
    });

    expect(createSnapshotWorkspace).toHaveBeenCalledWith("/repo/project", "session-1", undefined, undefined);
    expect(result.cwd).toBe("docker-volume://snapshot-1");
    await result.cleanup();
    expect(removeWorktree).toHaveBeenCalledWith("/repo/project", "docker-volume://snapshot-1");
  });

  it("can reuse and preserve a Docker snapshot workspace for provider session state", async () => {
    const createOrReuseSnapshotWorkspace = vi.spyOn<any, any>(Object.getPrototypeOf((runner as any).workspaceManager), "createOrReuseSnapshotWorkspace")
      .mockResolvedValue("docker-volume://qwen-session-1");
    const removeWorktree = vi.spyOn<any, any>(Object.getPrototypeOf((runner as any).workspaceManager), "removeWorktree")
      .mockResolvedValue(undefined);

    const result = await runner.ensureWorkspace({
      cwd: "/repo/project",
      repoPath: "/repo/project",
      sessionId: "chat-thread-1",
      preserve: true,
      reuseExisting: true,
    });

    expect(createOrReuseSnapshotWorkspace).toHaveBeenCalledWith(
      "/repo/project",
      "chat-thread-1",
      undefined,
      expect.any(Function),
    );
    expect(result.cwd).toBe("docker-volume://qwen-session-1");
    await result.cleanup();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it("forwards snapshot checkout when preparing Docker workspaces", async () => {
    const createOrReuseSnapshotWorkspace = vi.spyOn<any, any>(Object.getPrototypeOf((runner as any).workspaceManager), "createOrReuseSnapshotWorkspace")
      .mockResolvedValue("docker-volume://default-branch");

    await runner.ensureWorkspace({
      cwd: "/repo/project",
      repoPath: "/repo/project",
      sessionId: "chat-thread-1",
      snapshotCheckout: { branch: "develop" },
      preserve: true,
      reuseExisting: true,
    });

    expect(createOrReuseSnapshotWorkspace).toHaveBeenCalledWith(
      "/repo/project",
      "chat-thread-1",
      { branch: "develop" },
      expect.any(Function),
    );
  });

  it("runs providers inside isolated Docker volumes", async () => {
    const onSetupImageProgress = vi.fn();
    const ensureRuntimeVolume = vi.spyOn<any, any>(
      Object.getPrototypeOf((runner as any).workspaceManager),
      "ensureRuntimeVolume",
    ).mockResolvedValue(undefined);
    try {
      await runner.runProviderInDocker({
        command: "gemini",
        args: ["--yolo", "--p", "hello"],
        cwd: "docker-volume://workspace-1",
        providerEnv: { GEMINI_MODEL: "gemini-2.5-pro" },
        sessionId: "session-1",
        providerLabel: "gemini",
        workflowSettings: {
          executionMode: "DOCKER",
          containerImage: "node:24",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
        } as any,
        repoPath: "/repo/project",
        onActivity: vi.fn(),
        onSetupImageProgress,
        persistentSkillStorageMounts: [{
          storageId: "skill-storage-1",
          storageName: "Runtime skills",
          hostPath: "/home/test/.code-ux/skill-storages/project-1/skill-storage-1/repo",
          containerPath: "/code-ux/persistent-skills/skill-storage-1",
          revision: "0123456789abcdef0123456789abcdef01234567",
        }],
        googleDriveMount: {
          source: "/home/test/Google Drive",
          destination: "/mnt/code-ux/google-drive",
          readonly: true,
        },
      });
      expect(ensureRuntimeVolume).toHaveBeenCalledWith("docker-volume://workspace-1", {
        initializeOwnership: true,
        ownerSpec: "1000:1000",
      });
      expect(ensureRuntimeVolume).toHaveBeenCalledTimes(1);
      const ownershipRepairOrder = ensureRuntimeVolume.mock.invocationCallOrder[0];
      const providerLaunchOrder = vi.mocked(runStreamingCommand).mock.invocationCallOrder[0];
      expect(ownershipRepairOrder).toBeLessThan(providerLaunchOrder);
    } finally {
      ensureRuntimeVolume.mockRestore();
    }

    expect(runStreamingCommand).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "run",
        "--rm",
        "--name",
        "code-ux-gemini-session-1",
        "--workdir",
        "/workspace",
        "--label",
        "code-ux.session-id=session-1",
      ]),
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    );
    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs.some((arg) => arg.includes("type=volume") && arg.includes("source=workspace-1"))).toBe(true);
    expect(dockerArgs.some((arg) => arg.includes("type=volume") && arg.includes("source=workspace-1-runtime") && arg.includes("target=/code-ux-runtime-home"))).toBe(true);
    expect(dockerArgs).toContain("HOME=/code-ux-runtime-home");
    expect(dockerArgs).toContain("--env-file");
    expect(dockerArgs[dockerArgs.indexOf("--env-file") + 1]).toBe("/tmp/code-ux-docker-123/provider.env");
    expect(dockerArgs).toContain("CODE_UX_INSTALL_PLAYWRIGHT=1");
    expect(dockerArgs).toContain("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(dockerArgs).toContain("type=volume,source=code-ux-playwright-browser-test,target=/ms-playwright,readonly");
    expect(dockerArgs).toContain("type=bind,source=/home/test/.code-ux/skill-storages/project-1/skill-storage-1/repo,target=/code-ux/persistent-skills/skill-storage-1,readonly");
    expect(dockerArgs).toContain("type=bind,source=/home/test/Google Drive,target=/mnt/code-ux/google-drive,readonly");
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--network",
      "bridge",
      "--security-opt",
      "no-new-privileges",
      "--label",
      "code-ux.managed=true",
      "--user",
      "1000:1000",
      "--pull",
      "never",
    ]));
    expect(dockerArgs).not.toEqual(expect.arrayContaining(["--network", "host"]));
    expect(dockerArgs).not.toContain("-p");
    expect(dockerArgs).not.toContain("--publish");
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--mount",
      expect.stringContaining("target=/etc/passwd"),
    ]));
    expect(dockerArgs).not.toContain("HOME=/workspace/.code-ux-home");
    const bootstrapScript = dockerArgs.at(-3) || "";
    expect(bootstrapScript).toContain("CODE_UX_LAUNCH_ARTIFACT_INVALID:runtime-volume");
    expect(bootstrapScript).toContain("stat -c '%u:%g'");
    expect(bootstrapScript).toContain("CODE_UX_LAUNCH_ARTIFACT_INVALID:provider-tool");
    expect(bootstrapScript).toContain("CODE_UX_LAUNCH_ARTIFACT_INVALID:playwright-browser");
    const cacheInstance = (runner as any).setupImageCache;
    expect(cacheInstance.resolveImage).toHaveBeenCalledWith(expect.objectContaining({
      installPlaywrightBrowsers: false,
      runtimeRoot: "/runtime-root",
      onProgress: onSetupImageProgress,
    }));
    expect((runner as any).runtimeService.resolveImage).toHaveBeenCalledTimes(1);
    expect((runner as any).toolManager.prepare).toHaveBeenCalledWith(
      "gemini",
      expect.any(Object),
      { resolvedImage: "node:24" },
    );
    expect((runner as any).browserManager.prepare).toHaveBeenCalledWith(
      expect.any(Object),
      { resolvedImage: "node:24" },
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "code-ux-gemini-session-1"],
      process.cwd(),
    );
  });

  it("keeps loopback MCP endpoints reachable from Linux Docker provider runs without host networking", async () => {
    const originalPlatform = process.platform;
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;

    try {
      await runner.runProviderInDocker({
        command: "claude",
        args: ["--print", "plan"],
        cwd: "docker-volume://workspace-1",
        providerEnv: {},
        sessionId: "session-1",
        providerLabel: "claude-code",
        workflowSettings: {
          executionMode: "DOCKER",
          containerImage: "node:24",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
        } as any,
        repoPath: "/repo/project",
        onActivity: vi.fn(),
        mcpConnection: {
          url: "http://127.0.0.1:4445/mcp",
          authToken: "secret",
        },
      });
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalRewrite === undefined) {
        delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
      } else {
        process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = originalRewrite;
      }
    }

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--network",
      "bridge",
      "--add-host",
      "host.docker.internal:host-gateway",
    ]));
    expect(dockerArgs).not.toEqual(expect.arrayContaining(["--network", "host"]));
    expect(dockerArgs).not.toContain("-p");
    expect(dockerArgs).not.toContain("--publish");

    const configWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("claude-mcp.json"));
    const config = JSON.parse(String(configWrite?.[1]));
    expect(config.mcpServers.code_ux.url).toBe("http://host.docker.internal:4445/mcp");
  });

  it("honors the Docker localhost rewrite opt-out for Linux MCP endpoints", async () => {
    const originalPlatform = process.platform;
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = "0";

    try {
      await runner.runProviderInDocker({
        command: "claude",
        args: ["--print", "plan"],
        cwd: "docker-volume://workspace-1",
        providerEnv: {},
        sessionId: "session-1",
        providerLabel: "claude-code",
        workflowSettings: {
          executionMode: "DOCKER",
          containerImage: "node:24",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
        } as any,
        repoPath: "/repo/project",
        onActivity: vi.fn(),
        mcpConnection: {
          url: "http://127.0.0.1:4445/mcp",
          authToken: "secret",
        },
      });
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalRewrite === undefined) {
        delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
      } else {
        process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = originalRewrite;
      }
    }

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).not.toEqual(expect.arrayContaining([
      "--add-host",
      "host.docker.internal:host-gateway",
    ]));

    const configWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("claude-mcp.json"));
    const config = JSON.parse(String(configWrite?.[1]));
    expect(config.mcpServers.code_ux.url).toBe("http://127.0.0.1:4445/mcp");
  });

  it("adds Linux host-gateway when generated provider environment targets the Docker host", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    try {
      await runner.runProviderInDocker({
        command: "qwen",
        args: ["--prompt", "plan"],
        cwd: "docker-volume://workspace-1",
        providerEnv: {
          OPENAI_BASE_URL: "http://host.docker.internal:11434/v1",
        },
        sessionId: "session-1",
        providerLabel: "qwen-code",
        workflowSettings: {
          executionMode: "DOCKER",
          containerImage: "node:24",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
        } as any,
        repoPath: "/repo/project",
        onActivity: vi.fn(),
      });
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--add-host",
      "host.docker.internal:host-gateway",
    ]));
    expect(dockerArgs).not.toEqual(expect.arrayContaining(["--network", "host"]));
    expect(dockerArgs).not.toContain("-p");
    expect(dockerArgs).not.toContain("--publish");
  });

  it("honors explicit root mode by omitting Docker user and passwd injection", async () => {
    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
        containerRunAsRoot: true,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).not.toContain("--user");
    expect(dockerArgs).not.toEqual(expect.arrayContaining([
      "--mount",
      expect.stringContaining("target=/etc/passwd"),
    ]));
    expect(dockerArgs).not.toEqual(expect.arrayContaining([
      "--mount",
      expect.stringContaining("target=/mnt/code-ux/google-drive"),
    ]));
    const passwdWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("/passwd"));
    expect(passwdWrite).toBeUndefined();
  });

  it("maps a read-write Google Drive source for the Docker daemon without adding readonly", async () => {
    const originalWorkspaceRoot = process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT;
    process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT = "/host/workspace";
    const onActivity = vi.fn();

    try {
      await runner.runProviderInDocker({
        command: "codex",
        args: ["exec", "--help"],
        cwd: "docker-volume://workspace-1",
        providerEnv: {},
        sessionId: "session-1",
        providerLabel: "codex",
        workflowSettings: {
          executionMode: "DOCKER",
          containerImage: "node:24",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
        } as any,
        repoPath: "/repo/project",
        onActivity,
        googleDriveMount: {
          source: "/repo/project/linked-drive",
          destination: "/mnt/code-ux/google-drive",
          readonly: false,
        },
      });
    } finally {
      if (originalWorkspaceRoot === undefined) {
        delete process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT;
      } else {
        process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT = originalWorkspaceRoot;
      }
    }

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain(
      "type=bind,source=/host/workspace/linked-drive,target=/mnt/code-ux/google-drive",
    );
    expect(dockerArgs).not.toContain(
      "type=bind,source=/host/workspace/linked-drive,target=/mnt/code-ux/google-drive,readonly",
    );
    expect(onActivity).toHaveBeenCalledWith(
      "Mapped Docker Google Drive mount source from /repo/project/linked-drive to /host/workspace/linked-drive.",
      undefined,
    );
  });

  it("supports mockup-cli Docker labels, names, env files, and argv files", async () => {
    const prompt = "mockup-cli:write fixture.txt :: hello";
    await runner.runProviderInDocker({
      command: "node",
      args: ["-e", "console.log('mock')", prompt],
      prompt,
      cwd: "docker-volume://workspace-1",
      providerEnv: {
        CODE_UX_MOCKUP_MODEL: "default",
        CODE_UX_MOCKUP_SESSION_ID: "mock-session-1",
      },
      sessionId: "mock-session-1",
      providerLabel: "mockup-cli",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--name",
      "code-ux-mockup-cli-mock-session-1",
      "--label",
      "code-ux.command=node",
      "--label",
      "code-ux.args-count=2",
    ]));
    expect(dockerArgs.slice(-2)).toEqual(["provider-runner", "node"]);
    expect(dockerArgs).toContain("CODE_UX_PROVIDER_ARGV_FILE=/opt/code-ux/provider-argv.sh");

    const envWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider.env"));
    expect(envWrite?.[1]).toContain("CODE_UX_MOCKUP_MODEL=default");
    expect(envWrite?.[1]).toContain("CODE_UX_MOCKUP_SESSION_ID=mock-session-1");

    const argvWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider-argv.sh"));
    expect(argvWrite?.[1]).not.toContain(prompt);
    const promptWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider-prompt.txt"));
    expect(promptWrite?.[1]).toBe(prompt);
    expect(promptWrite?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
    expect(vi.mocked(runStreamingCommand).mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      stdinFile: "/tmp/code-ux-docker-123/provider-prompt.txt",
    }));
  });

  it("keeps Docker and provider execution behind mocked command runners", async () => {
    expect(vi.isMockFunction(runCommandStrict)).toBe(true);
    expect(vi.isMockFunction(runStreamingCommand)).toBe(true);

    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect(runStreamingCommand).toHaveBeenCalledOnce();
    expect(runStreamingCommand).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    );
    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs.slice(-2)).toEqual(["provider-runner", "codex"]);
    expect(dockerArgs).not.toContain("codex exec --help");
  });

  it("kills the backing container directly when an aborted run is cancelled", async () => {
    let releaseRun: ((result: any) => void) | undefined;
    vi.mocked(runStreamingCommand).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = resolve;
        }),
    );

    const controller = new AbortController();

    const runPromise = runner.runProviderInDocker({
      command: "gemini",
      args: ["--yolo"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "gemini",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      signal: controller.signal,
      onActivity: vi.fn(),
    });

    controller.abort("test abort");

    await vi.waitFor(() => {
      expect(runCommandStrict).toHaveBeenCalledWith("docker", ["kill", "code-ux-gemini-session-1"], process.cwd());
    });

    releaseRun?.({ ok: false, code: null, stdout: "", stderr: "aborted" });
    await runPromise;
  });

  it("reclaims and retries a provider container when Docker reports a stale name conflict", async () => {
    const conflict = [
      "docker: Error response from daemon: Conflict.",
      'The container name "/code-ux-qwen-code-session-1" is already in use by container "abc123".',
    ].join(" ");
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({ ok: false, stdout: "", stderr: conflict, code: 125 } as any)
      .mockResolvedValueOnce({ ok: true, stdout: "done", stderr: "", code: 0 } as any);
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "inspect") {
        return {
          ok: true,
          stdout: JSON.stringify({
            Config: {
              Labels: {
                "code-ux.managed": "true",
                [RUNTIME_OWNER_LABEL]: getRuntimeOwnerId(),
                "code-ux.session-id": "session-1",
              },
            },
            State: { Running: false, Status: "created" },
          }),
          stderr: "",
          code: 0,
        } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });
    const onActivity = vi.fn();

    const result = await runner.runProviderInDocker({
      command: "qwen",
      args: ["--prompt", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "qwen-code",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity,
    });

    expect(result.ok).toBe(true);
    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "code-ux-qwen-code-session-1"],
      process.cwd(),
    );
    const removeCallIndex = vi.mocked(runCommandStrict).mock.calls.findIndex(([, args]) =>
      args[0] === "rm" && args.includes("code-ux-qwen-code-session-1")
    );
    const firstRunOrder = vi.mocked(runStreamingCommand).mock.invocationCallOrder[0];
    const removeOrder = vi.mocked(runCommandStrict).mock.invocationCallOrder[removeCallIndex];
    const secondRunOrder = vi.mocked(runStreamingCommand).mock.invocationCallOrder[1];
    expect(firstRunOrder).toBeLessThan(removeOrder);
    expect(removeOrder).toBeLessThan(secondRunOrder);
    expect(onActivity).toHaveBeenCalledWith(
      "Retrying qwen-code after reclaiming stale Docker container code-ux-qwen-code-session-1.",
      "provider",
    );
  });

  it("preserves an active owned same-session container after a duplicate launch conflict", async () => {
    const conflict = 'docker: Error response from daemon: Conflict. The container name "/code-ux-mockup-cli-session-1" is already in use.';
    vi.mocked(runStreamingCommand).mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: conflict,
      code: 125,
    } as any);
    vi.mocked(runCommandStrict).mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({
        Config: {
          Labels: {
            "code-ux.managed": "true",
            [RUNTIME_OWNER_LABEL]: getRuntimeOwnerId(),
            "code-ux.session-id": "session-1",
          },
        },
        State: { Running: true, Status: "running" },
      }),
      stderr: "",
      code: 0,
    } as any);
    const onActivity = vi.fn();

    const result = await runner.runProviderInDocker({
      command: "mockup-cli",
      args: [],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "mockup-cli",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity,
    });

    expect(result.ok).toBe(false);
    expect(runStreamingCommand).toHaveBeenCalledOnce();
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["inspect", "--format", "{{json .}}", "code-ux-mockup-cli-session-1"],
      process.cwd(),
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "code-ux-mockup-cli-session-1"],
      process.cwd(),
    );
    expect(onActivity).toHaveBeenCalledWith(
      "Preserving active Docker container code-ux-mockup-cli-session-1 after a duplicate same-session launch was rejected.",
      "provider",
    );
  });

  it("does not remove the existing same-session container when shutdown aborts on a name conflict", async () => {
    const conflict = 'docker: Error response from daemon: Conflict. The container name "/code-ux-mockup-cli-session-1" is already in use.';
    vi.mocked(runStreamingCommand).mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: conflict,
      code: 125,
    } as any);
    const controller = new AbortController();
    controller.abort("runtime shutdown");

    const result = await runner.runProviderInDocker({
      command: "mockup-cli",
      args: [],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "mockup-cli",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      signal: controller.signal,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(runStreamingCommand).toHaveBeenCalledOnce();
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["kill", "code-ux-mockup-cli-session-1"],
      process.cwd(),
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      ["inspect", "--format", "{{json .}}", "code-ux-mockup-cli-session-1"],
      process.cwd(),
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "code-ux-mockup-cli-session-1"],
      process.cwd(),
    );
  });

  it("does not reclaim a same-name container owned by another runtime", async () => {
    const conflict = 'docker: Error response from daemon: Conflict. The container name "/code-ux-codex-session-1" is already in use.';
    vi.mocked(runStreamingCommand).mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: conflict,
      code: 125,
    } as any);
    vi.mocked(runCommandStrict).mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({
        Config: {
          Labels: {
            "code-ux.managed": "true",
            [RUNTIME_OWNER_LABEL]: "different-runtime",
            "code-ux.session-id": "session-1",
          },
        },
        State: { Running: false, Status: "exited" },
      }),
      stderr: "",
      code: 0,
    } as any);

    const result = await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(runStreamingCommand).toHaveBeenCalledOnce();
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "code-ux-codex-session-1"],
      process.cwd(),
    );
  });

  it("invalidates and repairs a missing provider-tool volume after the first failed launch", async () => {
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({
        ok: false,
        stdout: "",
        stderr: "CODE_UX_LAUNCH_ARTIFACT_INVALID:provider-tool",
        code: 86,
      } as any)
      .mockResolvedValueOnce({ ok: true, stdout: "done", stderr: "", code: 0 } as any);

    const result = await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect((runner as any).toolManager.invalidatePreparedVolume)
      .toHaveBeenCalledWith("code-ux-provider-tool-codex-test");
    expect((runner as any).toolManager.prepare).toHaveBeenCalledTimes(2);
    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
  });

  it("invalidates and repairs a missing Playwright browser volume after the first failed launch", async () => {
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({
        ok: false,
        stdout: "",
        stderr: "CODE_UX_LAUNCH_ARTIFACT_INVALID:playwright-browser",
        code: 86,
      } as any)
      .mockResolvedValueOnce({ ok: true, stdout: "done", stderr: "", code: 0 } as any);

    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect((runner as any).browserManager.invalidatePreparedVolume)
      .toHaveBeenCalledWith("code-ux-playwright-browser-test");
    expect((runner as any).browserManager.prepare).toHaveBeenCalledTimes(2);
    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
  });

  it("repairs a missing or recreated runtime volume after bootstrap validation fails", async () => {
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({
        ok: false,
        stdout: "",
        stderr: "CODE_UX_LAUNCH_ARTIFACT_INVALID:runtime-volume",
        code: 86,
      } as any)
      .mockResolvedValueOnce({ ok: true, stdout: "done", stderr: "", code: 0 } as any);
    const repairRuntimeVolume = vi.spyOn<any, any>(
      Object.getPrototypeOf((runner as any).workspaceManager),
      "repairRuntimeVolume",
    ).mockResolvedValue(undefined);

    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect(repairRuntimeVolume).toHaveBeenCalledWith("docker-volume://workspace-1", {
      initializeOwnership: true,
      ownerSpec: "1000:1000",
    });
    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
  });

  it("invalidates and restores a missing managed runtime image after launch failure", async () => {
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({ ok: false, stdout: "", stderr: "docker: No such image: node:24", code: 125 } as any)
      .mockResolvedValueOnce({ ok: true, stdout: "done", stderr: "", code: 0 } as any);

    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImageMode: "managed",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect((runner as any).runtimeService.invalidateImage).toHaveBeenCalledWith("node:24");
    expect((runner as any).runtimeService.resolveImage).toHaveBeenCalledTimes(2);
    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
  });

  it("invalidates and rebuilds a missing derived setup image after launch failure", async () => {
    const setupImageCache = (runner as any).setupImageCache;
    setupImageCache.resolveImage.mockResolvedValue({
      image: "code-ux-setup-cache-node-24:abc123",
      runSetupScriptAtRuntime: false,
    });
    vi.mocked(runStreamingCommand)
      .mockResolvedValueOnce({
        ok: false,
        stdout: "",
        stderr: "docker: No such image: code-ux-setup-cache-node-24:abc123",
        code: 125,
      } as any)
      .mockResolvedValueOnce({ ok: true, stdout: "done", stderr: "", code: 0 } as any);

    const result = await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImageMode: "custom",
        containerImage: "node:24",
        containerSetupScriptPath: "/repo/.code-ux/container/setup.sh",
        containerCacheSetupScriptImage: true,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(setupImageCache.invalidateImage)
      .toHaveBeenCalledWith("code-ux-setup-cache-node-24:abc123");
    expect(setupImageCache.resolveImage).toHaveBeenCalledTimes(2);
    expect((runner as any).runtimeService.invalidateImage).not.toHaveBeenCalled();
    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
    const firstDockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(firstDockerArgs).toEqual(expect.arrayContaining(["--pull", "never"]));
  });

  it("mounts provider argv from a file so long prompts do not enter the host docker command line", async () => {
    const longPrompt = `plan ${"x".repeat(64_000)} with 'quotes'`;

    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--yolo", longPrompt],
      prompt: longPrompt,
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain("CODE_UX_PROVIDER_ARGV_FILE=/opt/code-ux/provider-argv.sh");
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--mount",
      expect.stringContaining("target=/opt/code-ux/provider-argv.sh"),
    ]));
    expect(dockerArgs).not.toContain(longPrompt);
    expect(dockerArgs.join(" ")).not.toContain("code-ux.args=exec --yolo");
    expect(dockerArgs.slice(-2)).toEqual(["provider-runner", "codex"]);

    const argvWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider-argv.sh"));
    expect(argvWrite?.[1]).not.toContain(`plan ${"x".repeat(1024)}`);
    expect(argvWrite?.[1]).toContain("'-'");
    expect(argvWrite?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
    const promptWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider-prompt.txt"));
    expect(promptWrite?.[1]).toBe(longPrompt);
    expect(promptWrite?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
    expect(vi.mocked(runStreamingCommand).mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      stdinFile: "/tmp/code-ux-docker-123/provider-prompt.txt",
    }));
  });

  it.each([
    { provider: "gemini" as const, command: "gemini", args: ["--yolo", "--p", "PROMPT"], expected: ["--yolo"] },
    { provider: "qwen-code" as const, command: "qwen", args: ["--yolo", "-p", "PROMPT"], expected: ["--yolo"] },
    { provider: "claude-code" as const, command: "claude", args: ["--print", "PROMPT"], expected: ["--print"] },
    { provider: "opencode" as const, command: "opencode", args: ["run", "--format", "json", "PROMPT"], expected: ["run", "--format", "json"] },
  ])("streams oversized $provider prompts instead of reconstructing a large container argument", async ({ provider, command, args, expected }) => {
    const prompt = "PROMPT".repeat(12_000);
    const providerArgs = args.map((arg) => arg === "PROMPT" ? prompt : arg);

    await runner.runProviderInDocker({
      command,
      args: providerArgs,
      prompt,
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: `large-${provider}`,
      providerLabel: provider,
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const argvWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider-argv.sh"));
    for (const expectedArg of expected) {
      expect(argvWrite?.[1]).toContain(`'${expectedArg}'`);
    }
    expect(argvWrite?.[1]).not.toContain(prompt.slice(0, 1024));
    expect(vi.mocked(runStreamingCommand).mock.calls[0]?.[4]).toEqual(expect.objectContaining({
      stdinFile: "/tmp/code-ux-docker-123/provider-prompt.txt",
    }));
  });

  it("preserves Antigravity's single prompt argument below the execve limit", () => {
    const prompt = `${"é".repeat(30_000)}\n${"z".repeat(30_000)}`;
    const launch = (runner as any).prepareProviderLaunch(
      "antigravity",
      ["--dangerously-skip-permissions", "-p", prompt],
      prompt,
    ) as { args: string[]; stdinPrompt: string | null };

    expect(launch.stdinPrompt).toBeNull();
    expect(launch.args).toEqual(["--dangerously-skip-permissions", "-p", prompt]);
  });

  it("rejects an unsafe Antigravity prompt before execve can fail opaquely", () => {
    const prompt = "é".repeat(70_000);

    expect(() => (runner as any).prepareProviderLaunch(
      "antigravity",
      ["--dangerously-skip-permissions", "-p", prompt],
      prompt,
    )).toThrow(/Antigravity cannot safely accept a 140000-byte prompt.*safe limit is 122880 bytes/);
  });

  it("applies configured memory limits to provider Docker runs", async () => {
    await runner.runProviderInDocker({
      command: "qwen",
      args: ["--prompt", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "qwen-code",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerMemoryLimitMb: 6144,
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--memory",
      "6144m",
      "--memory-swap",
      "6144m",
    ]));
  });

  it("uses a soft Docker CPU weight without imposing a hard CPU quota", async () => {
    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--help"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs.slice(dockerArgs.indexOf("--cpu-shares"), dockerArgs.indexOf("--cpu-shares") + 2))
      .toEqual(["--cpu-shares", "768"]);
    expect(dockerArgs).not.toContain("--cpus");
    expect(dockerArgs).not.toContain("--cpu-quota");
  });

  it("omits Docker memory flags when the configured limit is disabled", async () => {
    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--yolo"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerMemoryLimitMb: 0,
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).not.toContain("--memory");
    expect(dockerArgs).not.toContain("--memory-swap");
  });

  it("sanitizes streamed Docker provider output before activity callbacks", async () => {
    const rawSecret = "glpat-12345678901234567890";
    vi.mocked(runStreamingCommand).mockImplementationOnce(async (_command, _args, _cwd, _env, options: any) => {
      options.onStdoutLine?.(`stdout ${rawSecret}`);
      options.onStderrLine?.(`Authorization: Bearer ${rawSecret}`);
      return { ok: true, stdout: `stdout ${rawSecret}`, stderr: "", code: 0, signal: null } as any;
    });
    const onActivity = vi.fn();

    await runner.runProviderInDocker({
      command: "gemini",
      args: ["--prompt", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "gemini",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity,
    });

    const activityText = JSON.stringify(onActivity.mock.calls);
    expect(activityText).not.toContain(rawSecret);
    expect(activityText).toContain("[REDACTED]");
  });

  it("passes provider environment through an env-file so API keys do not enter docker argv", async () => {
    const onActivity = vi.fn();
    await runner.runProviderInDocker({
      command: "gemini",
      args: ["--prompt", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {
        GEMINI_API_KEY: "secret-key-value",
        GEMINI_MODEL: "gemini-2.5-pro",
        GITHUB_TOKEN: "ghp-secret-value",
      },
      sessionId: "session-1",
      providerLabel: "gemini",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity,
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain("--env-file");
    const dockerArgText = dockerArgs.join(" ");
    expect(dockerArgText).not.toContain("secret-key-value");
    expect(dockerArgText).not.toContain("ghp-secret-value");
    expect(dockerArgText).not.toContain("GEMINI_API_KEY=");
    expect(dockerArgText).not.toContain("GITHUB_TOKEN=");

    const envWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider.env"));
    expect(envWrite?.[1]).toContain("GEMINI_API_KEY=secret-key-value");
    expect(envWrite?.[1]).toContain("GITHUB_TOKEN=ghp-secret-value");
    expect(envWrite?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain("secret-key-value");
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain("ghp-secret-value");
  });

  it("keeps MCP authorization tokens out of Docker command labels while writing restrictive mounted config", async () => {
    const rawMcpToken = "fixtureMcpBearerToken1234567890";
    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--yolo", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "codex",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
      mcpConnection: {
        url: "https://example.invalid/mcp",
        authToken: rawMcpToken,
      },
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    const dockerArgText = dockerArgs.join(" ");
    expect(dockerArgText).not.toContain(rawMcpToken);
    expect(dockerArgText).not.toContain("Authorization");
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--label",
      "code-ux.args-count=3",
    ]));

    const configWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("codex-config.toml"));
    expect(configWrite?.[1]).toContain(rawMcpToken);
    expect(configWrite?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
  });

  it("stages generated Gemini MCP config outside runtime home and copies it during bootstrap", async () => {
    await runner.runProviderInDocker({
      command: "gemini",
      args: ["--prompt", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: {},
      sessionId: "session-1",
      providerLabel: "gemini",
      workflowSettings: {
        executionMode: "DOCKER",
        containerImage: "node:24",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
      } as any,
      repoPath: "/repo/project",
      onActivity: vi.fn(),
      mcpConnection: {
        url: "http://127.0.0.1:3000/mcp",
        authToken: "secret",
      },
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toEqual(expect.arrayContaining([
      "--mount",
      expect.stringContaining("target=/opt/provider-config/gemini-settings.json"),
    ]));
    expect(dockerArgs).not.toEqual(expect.arrayContaining([
      expect.stringContaining("target=/workspace/.code-ux-home/.gemini/settings.json"),
    ]));
    expect(dockerArgs).not.toEqual(expect.arrayContaining([
      expect.stringContaining("target=/code-ux-runtime-home/.gemini/settings.json"),
    ]));
  });
});

describe("DockerRunner custom MCP server injection", () => {
  let runner: DockerRunner;

  const writtenFor = (filename: string): string | undefined => {
    const call = vi.mocked(fs.writeFile).mock.calls.find(([target]) => String(target).endsWith(filename));
    return call ? String(call[1]) : undefined;
  };

  const build = (provider: any, conn: any, customServers: any[], env: Record<string, string> = {}) =>
    (runner as any).buildProviderConfigMounts(conn, provider, "/tmp/cfg", env, customServers);

  const buildDocker = (provider: any, conn: any, customServers: any[], env: Record<string, string> = {}) =>
    (runner as any).buildProviderConfigMounts(conn, provider, "/tmp/cfg", env, customServers, { executionMode: "DOCKER" });

  beforeEach(() => {
    runner = createRunner();
    vi.clearAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("injects custom servers alongside code_ux for claude-code", async () => {
    await build("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true, headers: { Authorization: "Bearer t" } },
    ]);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux).toMatchObject({ type: "http", url: "http://127.0.0.1:3000/mcp" });
    expect(json.mcpServers.code_ux.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(json.mcpServers.docs).toEqual({ type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } });
  });

  it("rewrites loopback MCP URLs in Docker-mounted Claude config", async () => {
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = "1";
    try {
      await buildDocker("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
        { id: "1", name: "localdocs", transport: "http", url: "http://localhost:8123/mcp", enabled: true },
      ]);
    } finally {
      if (originalRewrite === undefined) {
        delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
      } else {
        process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = originalRewrite;
      }
    }

    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux.url).toBe("http://host.docker.internal:3000/mcp");
    expect(json.mcpServers.code_ux.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(json.mcpServers.localdocs.url).toBe("http://host.docker.internal:8123/mcp");
  });

  it("rewrites loopback MCP URLs in Docker-mounted Codex TOML", async () => {
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = "1";
    try {
      await buildDocker("codex", { url: "http://0.0.0.0:3000/mcp", authToken: "secret" }, [
        { id: "1", name: "localdocs", transport: "http", url: "http://localhost:8123/mcp", enabled: true },
      ]);
    } finally {
      if (originalRewrite === undefined) {
        delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
      } else {
        process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = originalRewrite;
      }
    }

    const toml = writtenFor("codex-config.toml")!;
    expect(toml).toContain('url = "http://host.docker.internal:3000/mcp"');
    expect(toml).toContain('"Authorization" = "Bearer secret"');
    expect(toml).toContain('url = "http://host.docker.internal:8123/mcp"');
  });

  it("writes gemini config from custom servers even without a code_ux connection", async () => {
    const mounts = await build("gemini", null, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true },
    ]);
    expect(mounts).toHaveLength(1);
    const json = JSON.parse(writtenFor("gemini-settings.json")!);
    expect(json.mcpServers.code_ux).toBeUndefined();
    expect(json.mcpServers.docs).toEqual({ httpUrl: "https://docs.example/mcp" });
  });

  it("emits codex TOML tables for code_ux and custom servers with headers", async () => {
    await build("codex", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true, headers: { "X-Key": "abc" } },
    ]);
    const toml = writtenFor("codex-config.toml")!;
    expect(toml).toContain("[mcp_servers.code-ux]");
    expect(toml).toContain("[mcp_servers.docs]");
    expect(toml).toContain('url = "https://docs.example/mcp"');
    expect(toml).toContain('http_headers = { "X-Key" = "abc" }');
  });

  it("respects per-server provider restriction and enabled flag", async () => {
    const mounts = await build("claude-code", null, [
      { id: "1", name: "geminionly", transport: "http", url: "https://a/mcp", enabled: true, providers: ["gemini"] },
      { id: "2", name: "disabled", transport: "http", url: "https://b/mcp", enabled: false },
    ]);
    expect(mounts).toHaveLength(0);
    expect(writtenFor("claude-mcp.json")).toBeUndefined();
  });

  it("emits stdio command/args/env for claude-code", async () => {
    await build("claude-code", null, [
      { id: "p", name: "playwright", enabled: true, transport: "stdio", command: "npx", args: ["@playwright/mcp@latest"], env: { TOKEN: "x" } },
    ]);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.playwright).toEqual({ type: "stdio", command: "npx", args: ["@playwright/mcp@latest"], env: { TOKEN: "x" } });
  });

  it("emits stdio command/args/env as codex TOML", async () => {
    await build("codex", null, [
      { id: "p", name: "playwright", enabled: true, transport: "stdio", command: "npx", args: ["@playwright/mcp@latest"], env: { TOKEN: "x" } },
    ]);
    const toml = writtenFor("codex-config.toml")!;
    expect(toml).toContain("[mcp_servers.playwright]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["@playwright/mcp@latest"]');
    expect(toml).toContain('env = { "TOKEN" = "x" }');
  });

  it("advertises agent and thread ids to code_ux via headers (claude JSON)", async () => {
    await build("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret", agentId: "agent-9", threadId: "thread-7" }, []);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux.headers).toMatchObject({
      Authorization: "Bearer secret",
      "X-Code-Ux-Agent": "agent-9",
      "X-Code-Ux-Thread": "thread-7",
    });
  });

  it("advertises agent and thread ids to code_ux via http_headers (codex TOML)", async () => {
    await build("codex", { url: "http://127.0.0.1:3000/mcp", authToken: "secret", agentId: "agent-9", threadId: "thread-7" }, []);
    const toml = writtenFor("codex-config.toml")!;
    expect(toml).toContain('"X-Code-Ux-Agent" = "agent-9"');
    expect(toml).toContain('"X-Code-Ux-Thread" = "thread-7"');
    expect(toml).toContain('"Authorization" = "Bearer secret"');
  });


  it("injects custom servers alongside code_ux for qwen-code and merges with existing settings", async () => {
    await build("qwen-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true, headers: { Authorization: "Bearer t" } },
    ], { QWEN_SETTINGS_CONTENT: JSON.stringify({ enableOpenAILogging: true, someOtherSetting: "value" }) });
    const json = JSON.parse(writtenFor("qwen-settings.json")!);
    expect(json.enableOpenAILogging).toBeUndefined(); // It should strip this based on formatting logic
    expect(json.someOtherSetting).toBe("value");
    expect(json.mcpServers.code_ux).toMatchObject({ httpUrl: "http://127.0.0.1:3000/mcp" });
    expect(json.mcpServers.code_ux.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(json.mcpServers.docs).toEqual({ httpUrl: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } });
  });

  it("injects custom servers alongside code_ux for antigravity", async () => {
    await build("antigravity", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true, headers: { Authorization: "Bearer t" } },
      { id: "2", name: "localtool", transport: "stdio", command: "python", args: ["script.py"], enabled: true }
    ]);
    const json = JSON.parse(writtenFor("antigravity-mcp.json")!);
    expect(json.mcpServers.code_ux).toMatchObject({ serverUrl: "http://127.0.0.1:3000/mcp" });
    expect(json.mcpServers.code_ux.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(json.mcpServers.docs).toEqual({ serverUrl: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } });
    expect(json.mcpServers.localtool).toEqual({ command: "python", args: ["script.py"] });
  });

  it("omits internal identity headers when no agent or thread id is set", async () => {
    await build("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, []);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux.headers["X-Code-Ux-Agent"]).toBeUndefined();
    expect(json.mcpServers.code_ux.headers["X-Code-Ux-Thread"]).toBeUndefined();
  });
});
