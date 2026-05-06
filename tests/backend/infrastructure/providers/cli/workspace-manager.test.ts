import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import { WorkspaceManager } from "../../../../../src/infrastructure/providers/cli/workspace-manager.js";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-workflow-text-utils.js", () => ({
  extractPathHints: vi.fn(() => ["src/index.ts", "../outside"]),
}));
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

import { runCommandStrict } from "../../../../../src/services/cli-process-runner.js";

describe("WorkspaceManager", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    manager = new WorkspaceManager();
    vi.clearAllMocks();
    vi.mocked(fs.mkdtemp).mockResolvedValue("/tmp/code-ux-bundle-123");
    vi.mocked(fs.rm).mockResolvedValue(undefined);
  });

  it("builds Docker volume handles for isolated workspaces", () => {
    const result = manager.buildWorktreePath("/repo/project", "session-1", "DOCKER");
    expect(result).toMatch(/^docker-volume:\/\/code-ux-project-[a-f0-9]{12}-session-1$/);
  });

  it("builds host worktree paths when host execution mode is selected", () => {
    const result = manager.buildWorktreePath("/repo/project", "session-1", "HOST");
    expect(result).toBe("/repo/project/.worktrees/session-1");
  });

  it("resolves a resumable workspace when the Docker volume exists", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "[]", stderr: "", code: 0, signal: null } as any);

    const result = await manager.resolveResumeWorktreePath("/repo/project", "session-1", "DOCKER");

    expect(result).toMatch(/^docker-volume:\/\/code-ux-project-[a-f0-9]{12}-session-1$/);
    expect(runCommandStrict).toHaveBeenCalledWith("docker", expect.arrayContaining(["volume", "inspect"]), expect.any(String));
  });

  it("resolves a resumable host workspace when the directory exists", async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const result = await manager.resolveResumeWorktreePath("/repo/project", "session-1", "HOST");

    expect(result).toBe("/repo/project/.worktrees/session-1");
  });

  it("creates a fresh snapshot workspace volume", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "docker" && args[1] === "volume" && args[2] === "inspect") {
        throw new Error("missing");
      }
      if (args[0] === "git" && args[1] === "remote") {
        return { ok: true, stdout: "git@github.com:example/repo.git\n", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    const workspace = await manager.createSnapshotWorkspace("/repo/project", "session-1");

    expect(workspace).toMatch(/^docker-volume:\/\/code-ux-project-[a-f0-9]{12}-session-1-snapshot$/);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "create", "--label", "code-ux.workspace=true"]),
      expect.any(String),
    );
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["bundle", "create", "/tmp/code-ux-bundle-123/repo.bundle", "--all"], "/repo/project");
    const bootstrapCall = vi.mocked(runCommandStrict).mock.calls.find((call) => call[0] === "bash");
    const bootstrapCommand = bootstrapCall?.[1]?.join(" ") || "";
    expect(bootstrapCommand).toContain("--entrypoint sh");
    expect(bootstrapCommand).toContain("git init /workspace");
    expect(bootstrapCommand).toContain("git -C /workspace symbolic-ref HEAD refs/heads/code-ux-bootstrap-$$");
    expect(bootstrapCommand).toContain("git -C /workspace fetch origin");
    expect(bootstrapCommand).toContain("+refs/*:refs/*");
    expect(bootstrapCommand).toContain("git -C /workspace config user.name");
    expect(bootstrapCommand).toContain("git -C /workspace config user.email");
    expect(bootstrapCommand).not.toContain("git clone");
    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(bootstrapCommand).toContain("chown -R");
      expect(bootstrapCommand).toContain(`${process.getuid()}:${process.getgid()}`);
    }
  });

  it("builds workspace guidance with in-volume path checks", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "exists\n", stderr: "" } as any);

    const guidance = await manager.buildWorkspaceGuidance("Check src/index.ts and ../outside", "docker-volume://workspace-1");

    expect(guidance).toContain("Repository root: /workspace");
    expect(guidance).toContain("- src/index.ts: exists");
    expect(guidance).toContain("- ../outside: outside-workspace");
  });

  it("runs workspace commands with an explicit container entrypoint", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "" } as any);

    await manager.runWorkspaceCommand("docker-volume://workspace-1", "git", ["status", "--short"]);

    const call = vi.mocked(runCommandStrict).mock.calls[0];
    expect(call?.[0]).toBe("docker");
    expect(call?.[1]).toEqual(expect.arrayContaining([
      "run",
      "--entrypoint",
      "git",
      "alpine/git",
      "status",
      "--short",
    ]));

    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(call?.[1]).toEqual(expect.arrayContaining([
        "--user",
        `${process.getuid()}:${process.getgid()}`,
      ]));
    }
  });
});
