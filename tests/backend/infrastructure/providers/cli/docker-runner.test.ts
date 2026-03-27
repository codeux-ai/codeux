import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { DockerRunner } from "../../../../../src/infrastructure/providers/cli/docker-runner.js";
import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";
import {
  getDockerUserSpec,
  mapPathPrefix,
  pickContainerEnv,
  resolveConfiguredPath,
  toDockerMountArg,
} from "../../../../../src/services/cli-docker-utils.js";
import { DockerBootstrapBuilder } from "../../../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js";
import { DockerCredentialMountBuilder } from "../../../../../src/infrastructure/providers/cli/docker-credential-mount-builder.js";
import { DockerSetupImageCache } from "../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js";
import { CliWorkflowSettings } from "../../../../../src/contracts/app-types.js";

vi.mock("fs/promises");
vi.mock("os");
vi.mock("crypto", () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => "mockhash1234"),
  })),
}));
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runStreamingCommand: vi.fn(),
}));
vi.mock("../../../../../src/services/cli-docker-utils.js", () => ({
  getDockerUserSpec: vi.fn(),
  mapPathPrefix: vi.fn((p) => p),
  pickContainerEnv: vi.fn(() => []),
  resolveConfiguredPath: vi.fn((repoPath, configured) => path.join(repoPath, configured)),
  toDockerMountArg: vi.fn((m) => `mount-arg-${m.source}`),
}));
vi.mock("../../../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js", () => {
  const mockBuilder = vi.fn();
  mockBuilder.prototype.build = vi.fn().mockReturnValue("mock-bootstrap-script");
  return { DockerBootstrapBuilder: mockBuilder };
});
vi.mock("../../../../../src/infrastructure/providers/cli/docker-credential-mount-builder.js", () => {
  const mockBuilder = vi.fn();
  mockBuilder.prototype.build = vi.fn().mockResolvedValue([]);
  return { DockerCredentialMountBuilder: mockBuilder };
});
vi.mock("../../../../../src/infrastructure/providers/cli/docker-setup-image-cache.js", () => {
  const mockBuilder = vi.fn();
  mockBuilder.prototype.resolveImage = vi.fn().mockResolvedValue({
    image: "node:20",
    runSetupScriptAtRuntime: false,
  });
  return { DockerSetupImageCache: mockBuilder };
});

describe("DockerRunner", () => {
  const bundledSetupScriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../.sprint-os/container/setup.sh",
  );
  let runner: DockerRunner;
  let defaultWorkflowSettings: CliWorkflowSettings;

  beforeEach(() => {
    vi.resetAllMocks();
    runner = new DockerRunner();

    // Reset prototype mocks to defaults so they are iterable
    DockerCredentialMountBuilder.prototype.build = vi.fn().mockResolvedValue([]);
    DockerBootstrapBuilder.prototype.build = vi.fn().mockReturnValue("mock-bootstrap-script");
    DockerSetupImageCache.prototype.resolveImage = vi.fn().mockResolvedValue({
      image: "node:20",
      runSetupScriptAtRuntime: false,
    });

    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockRejectedValue(new Error("not found"));
    vi.mocked(fs.stat).mockResolvedValue({ uid: 1000, gid: 1000 } as any);
    vi.mocked(os.homedir).mockReturnValue("/mock/home");

    vi.mocked(getDockerUserSpec).mockResolvedValue("1000:1000");
    vi.mocked(mapPathPrefix).mockImplementation((p) => p);
    vi.mocked(toDockerMountArg).mockImplementation((m) => `mount-arg-${m.source}`);
    vi.mocked(pickContainerEnv).mockReturnValue([{ key: "TEST_ENV", value: "test" }]);

    vi.mocked(runStreamingCommand).mockResolvedValue({
      ok: true,
      stdout: "mock stdout",
      stderr: "mock stderr",
      code: 0,
      signal: null,
    });

    defaultWorkflowSettings = {
      executionMode: "DOCKER",
      containerImage: "node:20",
      containerSetupScriptPath: "",
      containerCacheSetupScriptImage: false,
    } as CliWorkflowSettings;

    process.env = {}; // Clear process.env for predictability
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should format docker arguments correctly and call runStreamingCommand", async () => {
    const onActivity = vi.fn();

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: ["--arg1"],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "claude-code",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    expect(fs.mkdir).toHaveBeenCalled();
    expect(runStreamingCommand).toHaveBeenCalled();

    const [cmd, args, cwd, env, options] = vi.mocked(runStreamingCommand).mock.calls[0];
    expect(cmd).toBe("docker");
    expect(args).toContain("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--label");
    expect(args).toContain("sprint-os.session-id=session-123");
    expect(args).toContain("sprint-os.command=test-cmd");
    expect(args).toContain("sprint-os.args=--arg1");
    expect(args).toContain("/repo/path");
    expect(args).toContain("node:20");
    expect(args).toContain("test-cmd");
    expect(args).toContain("--arg1");
    expect(args).toContain("bash");
    expect(cwd).toBe("/repo/path");

    // Expecting to mount the workspace
    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({ source: "/repo/path", destination: "/repo/path", readonly: false }));

    // Expect user to be provided
    expect(args).toContain("--user");
    expect(args).toContain("1000:1000");

    // Expect env vars
    expect(args).toContain("-e");
    expect(args).toContain("TEST_ENV=test");
    expect(DockerBootstrapBuilder.prototype.build).toHaveBeenCalledWith(expect.objectContaining({
      runSetupScript: false,
    }));
  });

  it("should handle codex provider mapping home differently", async () => {
    const onActivity = vi.fn();

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "codex",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    const [cmd, args] = vi.mocked(runStreamingCommand).mock.calls[0];
    const homeArgIndex = args.findIndex((a: string) => a.startsWith("HOME="));
    expect(args[homeArgIndex]).toContain("home-codex-session-123");
  });

  it("should resolve and mount a setup script if available", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings.containerSetupScriptPath = "setup.sh";
    DockerSetupImageCache.prototype.resolveImage = vi.fn().mockResolvedValue({
      image: "node:20",
      runSetupScriptAtRuntime: true,
    });
    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (p.toString().includes("setup.sh")) return;
      if (p.toString() === "/.dockerenv") throw new Error();
      throw new Error("not found");
    });

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "gemini",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({
      destination: "/opt/jules/setup.sh",
      readonly: true,
    }));

    const [cmd, args] = vi.mocked(runStreamingCommand).mock.calls[0];
    expect(args).toContain("--mount");
  });

  it("should use the cached setup image when available", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings.containerSetupScriptPath = "setup.sh";
    defaultWorkflowSettings.containerCacheSetupScriptImage = true;
    DockerSetupImageCache.prototype.resolveImage = vi.fn().mockResolvedValue({
      image: "sprint-os-setup-cache:abc123",
      runSetupScriptAtRuntime: false,
    });
    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (p.toString().includes("setup.sh")) return;
      if (p.toString() === "/.dockerenv") throw new Error();
      throw new Error("not found");
    });

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "gemini",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    const [cmd, args] = vi.mocked(runStreamingCommand).mock.calls[0];
    expect(args).toContain("sprint-os-setup-cache:abc123");
    expect(toDockerMountArg).not.toHaveBeenCalledWith(expect.objectContaining({
      destination: "/opt/jules/setup.sh",
    }));
    expect(DockerBootstrapBuilder.prototype.build).toHaveBeenCalledWith(expect.objectContaining({
      runSetupScript: false,
    }));
  });

  it("should resolve the default repo setup script for cached images when no explicit path is configured", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings.containerCacheSetupScriptImage = true;
    DockerSetupImageCache.prototype.resolveImage = vi.fn().mockResolvedValue({
      image: "sprint-os-setup-cache:def456",
      runSetupScriptAtRuntime: false,
    });
    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (p.toString() === "/repo/path/.sprint-os/container/setup.sh") return;
      if (p.toString() === "/.dockerenv") throw new Error();
      throw new Error("not found");
    });

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "gemini",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    expect(DockerSetupImageCache.prototype.resolveImage).toHaveBeenCalledWith(expect.objectContaining({
      setupScriptPath: "/repo/path/.sprint-os/container/setup.sh",
      cacheEnabled: true,
    }));
    expect(onActivity).toHaveBeenCalledWith("Resolved default container setup script: /repo/path/.sprint-os/container/setup.sh");
  });

  it("should resolve the bundled default setup script for cached images when repo and home scripts are absent", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings.containerCacheSetupScriptImage = true;
    DockerSetupImageCache.prototype.resolveImage = vi.fn().mockResolvedValue({
      image: "sprint-os-setup-cache:ghi789",
      runSetupScriptAtRuntime: false,
    });
    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (p.toString() === bundledSetupScriptPath) return;
      if (p.toString() === "/.dockerenv") throw new Error();
      throw new Error("not found");
    });

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "gemini",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    expect(DockerSetupImageCache.prototype.resolveImage).toHaveBeenCalledWith(expect.objectContaining({
      setupScriptPath: bundledSetupScriptPath,
      cacheEnabled: true,
    }));
    expect(onActivity).toHaveBeenCalledWith(`Resolved default container setup script: ${bundledSetupScriptPath}`);
  });

  it("should add credentials via DockerCredentialMountBuilder", async () => {
    const onActivity = vi.fn();

    // Mock the builder to return a mount
    const mockBuild = vi.fn().mockResolvedValue([{
      source: "/mock/creds",
      destination: "/mock/dest",
      readonly: true
    }]);

    DockerCredentialMountBuilder.prototype.build = mockBuild;

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "gemini",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    expect(mockBuild).toHaveBeenCalled();
    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({
      source: "/mock/creds",
      destination: "/mock/dest",
      readonly: true
    }));
  });

  it("should mount worktree and .git read-write when cwd is inside repo", async () => {
    const onActivity = vi.fn();

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path/.sprint-os/worktrees/session-1",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "claude-code",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    // Repo should be mounted read-only
    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({
      source: "/repo/path",
      destination: "/repo/path",
      readonly: true,
    }));
    // Worktree directory should be mounted read-write
    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({
      source: "/repo/path/.sprint-os/worktrees/session-1",
      destination: "/repo/path/.sprint-os/worktrees/session-1",
      readonly: false,
    }));
    // .git dir should be mounted read-write
    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({
      source: "/repo/path/.git",
      destination: "/repo/path/.git",
      readonly: false,
    }));
  });

  it("should not add worktree mounts when cwd equals repo path", async () => {
    const onActivity = vi.fn();

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "claude-code",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    // Repo should be mounted read-write (not readonly since cwd === repoPath)
    expect(toDockerMountArg).toHaveBeenCalledWith(expect.objectContaining({
      source: "/repo/path",
      destination: "/repo/path",
      readonly: false,
    }));
    // .git should NOT have a separate mount
    expect(toDockerMountArg).not.toHaveBeenCalledWith(expect.objectContaining({
      destination: "/repo/path/.git",
    }));
  });

  it("should handle JULES_DOCKER_RUNTIME_ROOT and JULES_DOCKER_HOST_WORKSPACE_ROOT config", async () => {
    const onActivity = vi.fn();
    process.env.JULES_DOCKER_RUNTIME_ROOT = "/custom/runtime/root";
    process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT = "/host/workspace/root";

    vi.mocked(mapPathPrefix).mockImplementation((p, from, to) => {
      if (from === "/repo/path" && to === "/host/workspace/root") {
        return p.replace("/repo/path", "/host/workspace/root");
      }
      return p;
    });

    await runner.runProviderInDocker({
      command: "test-cmd",
      args: [],
      cwd: "/repo/path",
      providerEnv: {},
      sessionId: "session-123",
      providerLabel: "claude-code",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo/path",
      onActivity,
    });

    expect(mapPathPrefix).toHaveBeenCalledWith("/repo/path", "/repo/path", "/host/workspace/root");
  });
});
