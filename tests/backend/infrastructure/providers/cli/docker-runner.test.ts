import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import { DockerRunner } from "../../../../../src/infrastructure/providers/cli/docker-runner.js";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runStreamingCommand: vi.fn(),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js", () => ({
  CLAUDE_CODE_MCP_CONFIG_MOUNT: "/opt/provider-config/claude-mcp.json",
  GEMINI_MCP_SETTINGS_MOUNT: "/opt/provider-config/gemini-settings.json",
  CODEX_MCP_CONFIG_MOUNT: "/opt/provider-config/codex-config.toml",
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

import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";

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

    expect(createSnapshotWorkspace).toHaveBeenCalledWith("/repo/project", "session-1");
    expect(result.cwd).toBe("docker-volume://snapshot-1");
    await result.cleanup();
    expect(removeWorktree).toHaveBeenCalledWith("/repo/project", "docker-volume://snapshot-1");
  });

  it("runs providers inside isolated Docker volumes", async () => {
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
    });

    expect(runStreamingCommand).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "run",
        "--rm",
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
    expect(dockerArgs).toContain("HOME=/workspace/.code-ux-home");
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
  });
});
