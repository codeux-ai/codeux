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
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
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

  it("resolves current branch for a host workspace", async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "feature/task-1\n", stderr: "", code: 0, signal: null } as any);

    const result = await manager.resolveCurrentBranch("/repo/project/.worktrees/session-1");

    expect(result).toBe("feature/task-1");
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      "/repo/project/.worktrees/session-1",
      expect.anything(),
      expect.anything(),
    );
  });

  it("resolves current branch for a Docker workspace", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "", code: 0, signal: null } as any;
      }
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "", code: 0, signal: null } as any;
      }
      if (command === "docker" && args[0] === "run" && args.includes("git")) {
        return { ok: true, stdout: "feature/task-2\n", stderr: "", code: 0, signal: null } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    const result = await manager.resolveCurrentBranch("docker-volume://workspace-1");

    expect(result).toBe("feature/task-2");
    expect(runCommandStrict).toHaveBeenCalledWith("docker", expect.arrayContaining([
      "run",
      "--entrypoint",
      "git",
      "alpine/git",
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]), expect.any(String), expect.anything(), expect.anything());
  });

  it("returns null when current branch cannot be resolved", async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error("missing"));
    expect(await manager.resolveCurrentBranch("/repo/project/.worktrees/session-1")).toBeNull();

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "HEAD\n", stderr: "", code: 0, signal: null } as any);
    expect(await manager.resolveCurrentBranch("/repo/project/.worktrees/session-1")).toBeNull();
  });

  it("creates a fresh snapshot workspace volume", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
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
    const bootstrapCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker" && call[1].includes("--entrypoint") && call[1].includes("sh")
    );
    expect(bootstrapCall?.[1]).toEqual(expect.arrayContaining([
      "run",
      "--rm",
      "-i",
      "--entrypoint",
      "sh",
      "alpine/git",
      "-lc",
    ]));
    expect(bootstrapCall?.[4]).toEqual(expect.objectContaining({
      stdinFile: "/tmp/code-ux-bundle-123/repo.bundle",
    }));
    const bootstrapCommand = String(bootstrapCall?.[1]?.at(-1) || "");
    expect(bootstrapCommand).toContain("git init /workspace");
    expect(bootstrapCommand).toContain("git -C /workspace symbolic-ref HEAD refs/heads/code-ux-bootstrap-$$");
    expect(bootstrapCommand).toContain("git -C /workspace fetch origin");
    expect(bootstrapCommand).toContain("+refs/*:refs/*");
    expect(bootstrapCommand).toContain("git -C /workspace config user.name");
    expect(bootstrapCommand).toContain("git -C /workspace config user.email");
    expect(bootstrapCommand).not.toContain("git clone");
    expect(vi.mocked(runCommandStrict).mock.calls.some((call) => call[0] === "bash")).toBe(false);
    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(bootstrapCommand).toContain("chown -R");
      expect(bootstrapCommand).toContain(`${process.getuid()}:${process.getgid()}`);
    }
  });

  it("streams snapshot bundle files to Docker without shelling through Windows paths", async () => {
    vi.mocked(fs.mkdtemp).mockResolvedValue("C:\\Users\\pierr\\AppData\\Local\\Temp\\code-ux-bundle-k9Efgd");
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (args[0] === "docker" && args[1] === "volume" && args[2] === "inspect") {
        throw new Error("missing");
      }
      if (args[0] === "git" && args[1] === "remote") {
        return { ok: true, stdout: "https://github.com/numnx/test2.git\n", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await manager.createSnapshotWorkspace("/repo/project", "session-1");

    expect(vi.mocked(runCommandStrict).mock.calls.some((call) => call[0] === "bash")).toBe(false);
    const bootstrapCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker" && call[1].includes("--entrypoint") && call[1].includes("sh")
    );
    expect(bootstrapCall?.[4]).toEqual(expect.objectContaining({
      stdinFile: expect.stringContaining("C:\\Users\\pierr\\AppData\\Local\\Temp\\code-ux-bundle-k9Efgd"),
    }));
    expect(bootstrapCall?.[1].join(" ")).not.toContain("C:\\Users\\pierr\\AppData\\Local\\Temp");
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

    await manager.runWorkspaceCommand("docker-volume://workspace-1", "git", ["status", "--short"], {
      env: {
        ...process.env,
        GIT_INDEX_FILE: ".code-ux-export.index",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: "Authorization: Basic redacted",
        APP_SECRET_SHOULD_NOT_LEAK: "secret",
      },
    });

    const call = vi.mocked(runCommandStrict).mock.calls.find((candidate) =>
      candidate[0] === "docker" && candidate[1].includes("run")
    );
    expect(call?.[0]).toBe("docker");
    expect(call?.[1]).toEqual(expect.arrayContaining([
      "run",
      "--entrypoint",
      "git",
      "alpine/git",
      "status",
      "--short",
    ]));
    expect(call?.[1]).toEqual(expect.arrayContaining([
      "-e",
      "GIT_AUTHOR_NAME=Code UX",
      "-e",
      "GIT_AUTHOR_EMAIL=agents@codeux.ai",
      "-e",
      "GIT_COMMITTER_NAME=Code UX",
      "-e",
      "GIT_COMMITTER_EMAIL=agents@codeux.ai",
      "-e",
      "GIT_INDEX_FILE=.code-ux-export.index",
      "-e",
      "GIT_CONFIG_COUNT=1",
      "-e",
      "GIT_CONFIG_KEY_0=http.https://github.com/.extraheader",
      "-e",
      "GIT_CONFIG_VALUE_0=Authorization: Basic redacted",
    ]));
    expect(call?.[1]).not.toContain("APP_SECRET_SHOULD_NOT_LEAK=secret");
  });

  it("allows callers to override Docker workspace Git identity env", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "" } as any);

    await manager.runWorkspaceCommand("docker-volume://workspace-1", "git", ["merge", "--no-commit", "origin/main"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Custom Author",
        GIT_AUTHOR_EMAIL: "author@example.com",
        GIT_COMMITTER_NAME: "Custom Committer",
        GIT_COMMITTER_EMAIL: "committer@example.com",
      },
    });

    const call = vi.mocked(runCommandStrict).mock.calls.find((candidate) =>
      candidate[0] === "docker" && candidate[1].includes("run")
    );
    expect(call?.[1]).toEqual(expect.arrayContaining([
      "-e",
      "GIT_AUTHOR_NAME=Custom Author",
      "-e",
      "GIT_AUTHOR_EMAIL=author@example.com",
      "-e",
      "GIT_COMMITTER_NAME=Custom Committer",
      "-e",
      "GIT_COMMITTER_EMAIL=committer@example.com",
    ]));
    expect(call?.[1]).not.toContain("GIT_COMMITTER_EMAIL=agents@codeux.ai");

    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(call?.[1]).toEqual(expect.arrayContaining([
        "--user",
        `${process.getuid()}:${process.getgid()}`,
      ]));
    }
  });

  it("pulls the public workspace helper image with isolated Docker config when host credentials are broken", async () => {
    vi.mocked(fs.mkdtemp).mockResolvedValue("/tmp/code-ux-docker-config-123");
    vi.mocked(runCommandStrict).mockImplementation(async (command, args, _cwd, env) => {
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        throw new Error("docker image inspect alpine/git failed: missing");
      }
      if (command === "docker" && args[0] === "pull" && !env?.DOCKER_CONFIG) {
        throw new Error("docker pull alpine/git failed: error getting credentials - err: fork/exec /usr/bin/docker-credential-desktop.exe: exec format error");
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    await manager.runWorkspaceCommand("docker-volume://workspace-1", "git", ["status", "--short"]);

    const pullCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) =>
      call[0] === "docker" && call[1][0] === "pull"
    );
    expect(pullCalls).toHaveLength(2);
    expect(pullCalls[1]?.[3]?.DOCKER_CONFIG).toBe("/tmp/code-ux-docker-config-123");
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/tmp/code-ux-docker-config-123/config.json",
      "{}\n",
      "utf8",
    );
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["run", "alpine/git", "status", "--short"]),
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("rejects nested directories that resolve to a parent Git repository", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo\n", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    await expect(manager.createSnapshotWorkspace("/repo/project", "session-1"))
      .rejects
      .toThrow("Project repository path must be a Git checkout root");
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "create"]),
      expect.any(String),
    );
  });

  it("does not remove Docker volumes that are not Code UX-managed", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "" } as any;
      }
      throw new Error("unexpected");
    });

    await manager.removeWorktree("/repo/project", "docker-volume://external-workspace");

    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "rm", "-f", "external-workspace"]),
      expect.any(String),
    );
  });

  it("removes Code UX-managed Docker workspace volumes", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "inspect" && !args.includes("--format")) {
        return { ok: true, stdout: "[]", stderr: "" } as any;
      }
      if (args[0] === "volume" && args[1] === "inspect" && args.includes("--format")) {
        return { ok: true, stdout: "true\n", stderr: "" } as any;
      }
      if (args[0] === "volume" && args[1] === "rm") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await manager.removeWorktree("/repo/project", "docker-volume://code-ux-project-abcd1234ef56-session-1");

    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["volume", "rm", "-f", "code-ux-project-abcd1234ef56-session-1"],
      expect.any(String),
    );
  });
});
