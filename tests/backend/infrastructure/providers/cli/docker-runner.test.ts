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
    resolveImage: vi.fn(async () => ({ image: "node:24", runSetupScriptAtRuntime: false })),
    };
  }),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-runtime-paths.js", () => ({
  resolveDockerRuntimeRoot: vi.fn(() => "/runtime-root"),
}));

import { runCommandStrict, runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";
import { DockerSetupImageCache } from "../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js";

describe("DockerRunner", () => {
  let runner: DockerRunner;

  beforeEach(() => {
    runner = new DockerRunner();
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

    expect(createSnapshotWorkspace).toHaveBeenCalledWith("/repo/project", "session-1", undefined);
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

    expect(createOrReuseSnapshotWorkspace).toHaveBeenCalledWith("/repo/project", "chat-thread-1", undefined);
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
    );
  });

  it("runs providers inside isolated Docker volumes", async () => {
    const onSetupImageProgress = vi.fn();
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
    });

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
    expect(dockerArgs).not.toContain("HOME=/workspace/.code-ux-home");
    const cacheInstance = vi.mocked(DockerSetupImageCache).mock.results[0]?.value as any;
    expect(cacheInstance.resolveImage).toHaveBeenCalledWith(expect.objectContaining({
      installPlaywrightBrowsers: true,
      runtimeRoot: "/runtime-root",
      onProgress: onSetupImageProgress,
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
    vi.spyOn(runner as any, "sleep").mockResolvedValue(undefined);
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
    expect(onActivity).toHaveBeenCalledWith(
      "Retrying qwen-code after reclaiming stale Docker container code-ux-qwen-code-session-1.",
      "provider",
    );
  });

  it("mounts provider argv from a file so long prompts do not enter the host docker command line", async () => {
    const longPrompt = `plan ${"x".repeat(64_000)} with 'quotes'`;

    await runner.runProviderInDocker({
      command: "codex",
      args: ["exec", "--yolo", longPrompt],
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
    expect(argvWrite?.[1]).toContain(`plan ${"x".repeat(1024)}`);
    expect(argvWrite?.[1]).toContain(" with ");
    expect(argvWrite?.[1]).toContain("'\"'\"'quotes'\"'\"'");
  });

  it("passes provider environment through an env-file so API keys do not enter docker argv", async () => {
    await runner.runProviderInDocker({
      command: "gemini",
      args: ["--prompt", "plan"],
      cwd: "docker-volume://workspace-1",
      providerEnv: { GEMINI_API_KEY: "secret-key-value", GEMINI_MODEL: "gemini-2.5-pro" },
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
    });

    const dockerArgs = vi.mocked(runStreamingCommand).mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain("--env-file");
    expect(dockerArgs.join(" ")).not.toContain("secret-key-value");
    expect(dockerArgs.join(" ")).not.toContain("GEMINI_API_KEY=");

    const envWrite = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("provider.env"));
    expect(envWrite?.[1]).toContain("GEMINI_API_KEY=secret-key-value");
    expect(envWrite?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
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
    runner = new DockerRunner();
    vi.clearAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("injects custom servers alongside code_ux for claude-code", async () => {
    await build("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true, headers: { Authorization: "Bearer t" } },
    ]);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux).toMatchObject({ type: "http", url: "http://127.0.0.1:3000/mcp" });
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
    expect(json.mcpServers.localdocs.url).toBe("http://host.docker.internal:8123/mcp");
  });

  it("rewrites loopback MCP URLs in Docker-mounted Codex TOML", async () => {
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = "1";
    try {
      await buildDocker("codex", { url: "http://0.0.0.0:3000/mcp", authToken: null }, [
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

  it("advertises the agent id to code_ux via the X-Code-Ux-Agent header (claude JSON)", async () => {
    await build("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret", agentId: "agent-9" }, []);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux.headers).toMatchObject({
      Authorization: "Bearer secret",
      "X-Code-Ux-Agent": "agent-9",
    });
  });

  it("advertises the agent id to code_ux via http_headers (codex TOML)", async () => {
    await build("codex", { url: "http://127.0.0.1:3000/mcp", authToken: "secret", agentId: "agent-9" }, []);
    const toml = writtenFor("codex-config.toml")!;
    expect(toml).toContain('"X-Code-Ux-Agent" = "agent-9"');
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
    expect(json.mcpServers.docs).toEqual({ httpUrl: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } });
  });

  it("injects custom servers alongside code_ux for antigravity", async () => {
    await build("antigravity", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, [
      { id: "1", name: "docs", url: "https://docs.example/mcp", enabled: true, headers: { Authorization: "Bearer t" } },
      { id: "2", name: "localtool", transport: "stdio", command: "python", args: ["script.py"], enabled: true }
    ]);
    const json = JSON.parse(writtenFor("antigravity-mcp.json")!);
    expect(json.mcpServers.code_ux).toMatchObject({ serverUrl: "http://127.0.0.1:3000/mcp" });
    expect(json.mcpServers.docs).toEqual({ serverUrl: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } });
    expect(json.mcpServers.localtool).toEqual({ command: "python", args: ["script.py"] });
  });

  it("omits the agent header when no agent id is set", async () => {
    await build("claude-code", { url: "http://127.0.0.1:3000/mcp", authToken: "secret" }, []);
    const json = JSON.parse(writtenFor("claude-mcp.json")!);
    expect(json.mcpServers.code_ux.headers["X-Code-Ux-Agent"]).toBeUndefined();
  });
});
