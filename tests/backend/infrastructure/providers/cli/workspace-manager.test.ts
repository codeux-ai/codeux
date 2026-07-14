import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  buildPersistentSkillStorageContainerPath,
  buildPersistentSkillStorageHostPath,
  CONTAINER_PERSISTENT_SKILL_STORAGE_ROOT,
  WorkspaceManager,
} from "../../../../../src/infrastructure/providers/cli/workspace-manager.js";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-workflow-text-utils.js", () => ({
  extractPathHints: vi.fn(() => ["src/index.ts", "../outside"]),
  normalizePathHint: vi.fn((value: string) => value.replace(/\\/g, "/")),
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
    vi.mocked(fs.realpath).mockImplementation(async (candidate) => String(candidate));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("builds Docker volume handles for isolated workspaces", () => {
    const result = manager.buildWorktreePath("/repo/project", "session-1", "DOCKER");
    expect(result).toMatch(/^docker-volume:\/\/code-ux-project-[a-f0-9]{12}-session-1$/);
  });

  it("builds host worktree paths when host execution mode is selected", () => {
    const result = manager.buildWorktreePath("/repo/project", "session-1", "HOST");
    expect(result).toBe(path.join(path.resolve("/repo/project"), ".worktrees", "session-1"));
  });

  it("creates host QA snapshots under the short OS temp root", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
        return { ok: true, stdout: "/repo/project\n", stderr: "", code: 0, signal: null } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    const workspace = await manager.createHostSnapshotWorkspace("/repo/project", "qa-review-long-session-id", {
      branch: "task/feature-task-1",
      fallbackBranch: "feature/sprint-1",
    });

    expect(workspace).toMatch(new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(workspace).toMatch(/code-ux-qa-[a-f0-9]{16}$/);
    expect(workspace).not.toContain(`${path.sep}repo${path.sep}project${path.sep}.worktrees`);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "--detach", workspace, "refs/heads/task/feature-task-1"],
      "/repo/project",
    );
  });

  it("derives persistent skill storage roots outside project workspaces with safe path segments", () => {
    const hostPath = buildPersistentSkillStorageHostPath("Project One", "Agent/One", "../Storage One");
    const containerPath = buildPersistentSkillStorageContainerPath("../Storage One");

    expect(hostPath).toBe(path.join(os.homedir(), ".code-ux", "persistent-skill-storages", "project-one", "agent-one", "storage-one"));
    expect(hostPath).not.toContain(`${path.sep}workspace${path.sep}`);
    expect(hostPath).not.toContain(`${path.sep}.worktrees${path.sep}`);
    expect(containerPath).toBe(`${CONTAINER_PERSISTENT_SKILL_STORAGE_ROOT}/storage-one`);
    expect(containerPath.startsWith("/workspace")).toBe(false);
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

    expect(result).toBe(path.join(path.resolve("/repo/project"), ".worktrees", "session-1"));
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
    const bundlePath = path.join("/tmp/code-ux-bundle-123", "repo.bundle");
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["bundle", "create", bundlePath, "--all"], "/repo/project");
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "create", "--label", "code-ux.workspace-runtime=true"]),
      expect.any(String),
    );
    const bootstrapCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[4]
      && typeof call[4] === "object"
      && "stdinFile" in call[4]
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
      stdinFile: bundlePath,
    }));
    const bootstrapCommand = String(bootstrapCall?.[1]?.at(-1) || "");
    expect(bootstrapCommand).toContain("git config --global --add safe.directory /workspace");
    expect(bootstrapCommand.indexOf("git config --global --add safe.directory /workspace"))
      .toBeLessThan(bootstrapCommand.indexOf("git -C /workspace symbolic-ref"));
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

  it("uses a durable owner marker and skips repeated runtime-volume ownership helpers", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0, signal: null } as any);

    await manager.ensureRuntimeVolume("docker-volume://workspace-1", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });
    await manager.ensureRuntimeVolume("docker-volume://workspace-1", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });

    const ownershipCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "docker"
      && call[1].some((arg) => String(arg).includes("workspace-1-runtime"))
      && String(call[1].at(-1)).includes("chown -R")
    ));
    expect(ownershipCalls).toHaveLength(1);
    expect(ownershipCalls[0]?.[1].at(-1)).toContain("1001:1002");
    expect(ownershipCalls[0]?.[1].at(-1)).toContain("/code-ux-runtime-home");
    expect(ownershipCalls[0]?.[1].at(-1)).toContain(".codeux-owner");
    const volumeCreateCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "docker" && call[1][0] === "volume" && call[1][1] === "create"
    ));
    expect(volumeCreateCalls).toHaveLength(1);
  });

  it("recreates and relabels an externally removed runtime volume before repairing ownership", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "", code: 0, signal: null } as any);
    await manager.ensureRuntimeVolume("docker-volume://workspace-1", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });
    vi.clearAllMocks();
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        return { ok: true, stdout: "\n", stderr: "", code: 0, signal: null } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.repairRuntimeVolume("docker-volume://workspace-1", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });

    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["volume", "rm", "-f", "workspace-1-runtime"],
      process.cwd(),
    );
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "create", "--label", "code-ux.workspace-runtime=true", "workspace-1-runtime"]),
      process.cwd(),
    );
    const ownershipRepair = vi.mocked(runCommandStrict).mock.calls.find((call) => (
      call[0] === "docker" && String(call[1].at(-1)).includes(".codeux-owner")
    ));
    expect(ownershipRepair?.[1].at(-1)).toContain("chown -R");
  });

  it("checks out the requested branch in a snapshot workspace", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (args[0] === "docker" && args[1] === "volume" && args[2] === "inspect") {
        throw new Error("missing");
      }
      if (args[0] === "git" && args[1] === "remote") {
        return { ok: true, stdout: "git@github.com:example/repo.git\n", stderr: "" } as any;
      }
      // The requested worker branch exists on origin.
      if (args[0] === "show-ref" && args.includes("refs/remotes/origin/feature/task-1")) {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (args[0] === "show-ref") {
        throw new Error("missing ref");
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await manager.createSnapshotWorkspace("/repo/project", "session-1", {
      branch: "feature/task-1",
      fallbackBranch: "main",
    });

    const checkoutCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && String(call[1].at(-1)).includes("git -C /workspace checkout")
    );
    expect(String(checkoutCall?.[1].at(-1))).toContain(
      "git -C /workspace checkout -B 'feature/task-1' 'refs/remotes/origin/feature/task-1'",
    );
  });

  it("seeds only the requested branch refs instead of every ref", async () => {
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
      if (args[0] === "show-ref" && args.includes("refs/remotes/origin/feature/task-1")) {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (args[0] === "show-ref") {
        throw new Error("missing ref");
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await manager.createSnapshotWorkspace("/repo/project", "session-1", { branch: "feature/task-1" });

    const bundlePath = path.join("/tmp/code-ux-bundle-123", "repo.bundle");
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["bundle", "create", bundlePath, "refs/remotes/origin/feature/task-1"],
      "/repo/project",
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "git",
      ["bundle", "create", bundlePath, "--all"],
      "/repo/project",
    );
  });

  it("falls back to a full seed when the targeted checkout fails", async () => {
    let checkoutAttempts = 0;
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (args[0] === "git" && args[1] === "remote") {
        return { ok: true, stdout: "git@github.com:example/repo.git\n", stderr: "" } as any;
      }
      if (args[0] === "show-ref" && args.includes("refs/heads/feature/task-1")) {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (args[0] === "show-ref") {
        throw new Error("missing ref");
      }
      // The in-volume checkout (docker run --entrypoint git ... checkout) fails the first time,
      // which should trigger a full re-seed + retry.
      if (
        command === "docker"
        && args.includes("--entrypoint")
        && (args.includes("checkout") || String(args.at(-1)).includes("git -C /workspace checkout"))
      ) {
        checkoutAttempts += 1;
        if (checkoutAttempts <= 2) {
          throw new Error("checkout failed: missing object");
        }
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await manager.createSnapshotWorkspace("/repo/project", "session-1", { branch: "feature/task-1" });

    const bundlePath = path.join("/tmp/code-ux-bundle-123", "repo.bundle");
    // First a targeted seed, then a full (--all) re-seed after the checkout failure.
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["bundle", "create", bundlePath, "refs/heads/feature/task-1"],
      "/repo/project",
    );
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["bundle", "create", bundlePath, "--all"],
      "/repo/project",
    );
    expect(checkoutAttempts).toBe(3);
  });

  it("falls back to the repository HEAD branch when no snapshot branch is requested", async () => {
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
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return { ok: true, stdout: "main\n", stderr: "" } as any;
      }
      if (args[0] === "show-ref" && args.includes("refs/heads/main")) {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (args[0] === "show-ref") {
        throw new Error("missing ref");
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await manager.createSnapshotWorkspace("/repo/project", "session-1");

    const checkoutCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && String(call[1].at(-1)).includes("git -C /workspace checkout")
    );
    expect(String(checkoutCall?.[1].at(-1))).toContain(
      "git -C /workspace checkout -B 'main' 'refs/heads/main'",
    );
  });

  it("does not fall back to a local branch for remote-only snapshot checkouts", async () => {
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
      if (args[0] === "show-ref" && args.includes("refs/heads/feature/task-1")) {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (args[0] === "show-ref") {
        throw new Error("missing ref");
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    await expect(manager.createSnapshotWorkspace("/repo/project", "session-1", {
      branch: "feature/task-1",
      remoteOnly: true,
    })).rejects.toThrow("remote-only snapshot workspace");

    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "git",
      ["bundle", "create", path.join("/tmp/code-ux-bundle-123", "repo.bundle"), "refs/heads/feature/task-1"],
      "/repo/project",
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      "/repo/project",
    );
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
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[4]
      && typeof call[4] === "object"
      && "stdinFile" in call[4]
    );
    expect(bootstrapCall?.[4]).toEqual(expect.objectContaining({
      stdinFile: expect.stringContaining("C:\\Users\\pierr\\AppData\\Local\\Temp\\code-ux-bundle-k9Efgd"),
    }));
    expect(bootstrapCall?.[1].join(" ")).not.toContain("C:\\Users\\pierr\\AppData\\Local\\Temp");
  });

  it("seeds Docker prepare worktrees with origin-tracking refs for worker and feature branches", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/task-1")
          || args.includes("refs/remotes/origin/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
    );

    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", "+refs/heads/feature/task-1:refs/remotes/origin/feature/task-1"],
      "/repo/project",
      expect.anything(),
    );
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", "+refs/heads/feature/sprint-1:refs/remotes/origin/feature/sprint-1"],
      "/repo/project",
      expect.anything(),
    );
    const bundlePath = path.join("/tmp/code-ux-bundle-123", "repo.bundle");
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      [
        "bundle",
        "create",
        bundlePath,
        "refs/remotes/origin/feature/task-1",
        "refs/remotes/origin/feature/sprint-1",
      ],
      "/repo/project",
    );
    const seedCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[1].some((arg) => typeof arg === "string" && arg.includes("git -C /workspace checkout -B 'feature/task-1' 'origin/feature/task-1'"))
    );
    expect(seedCall).toBeDefined();
    expect(vi.mocked(runCommandStrict).mock.calls).not.toContainEqual([
      "git",
      expect.arrayContaining(["branch"]),
      expect.anything(),
      expect.anything(),
    ]);
    expect(vi.mocked(runCommandStrict).mock.calls).not.toContainEqual([
      "git",
      expect.arrayContaining(["for-each-ref"]),
      expect.anything(),
      expect.anything(),
    ]);

    const showRefCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) =>
      call[0] === "git" && call[1][0] === "show-ref"
    );
    expect(showRefCalls.map((call) => call[1].at(-1))).toEqual([
      "refs/remotes/origin/feature/task-1",
      "refs/heads/feature/task-1",
      "refs/remotes/origin/feature/sprint-1",
      "refs/heads/feature/sprint-1",
    ]);
  });

  it("reseeds a Docker prepare worktree when the prepared volume has no HEAD", async () => {
    let headChecks = 0;
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/task-1")
          || args.includes("refs/remotes/origin/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      if (
        command === "docker"
        && args.includes("--entrypoint")
        && args.includes("git")
        && args.includes("rev-parse")
        && args.includes("--verify")
        && args.includes("HEAD")
      ) {
        headChecks += 1;
        if (headChecks === 1) {
          throw new Error("not a git repository");
        }
        return { ok: true, stdout: "abc123\n", stderr: "", code: 0, signal: null } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
    );

    expect(headChecks).toBe(2);
    const seedCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[4]
      && typeof call[4] === "object"
      && "stdinFile" in call[4]
    );
    expect(seedCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("prepares different Docker workspaces concurrently instead of serializing the whole repo", async () => {
    let firstSeedStarted!: () => void;
    const firstSeedStartedPromise = new Promise<void>((resolve) => { firstSeedStarted = resolve; });
    let releaseFirstSeed!: () => void;
    const releaseFirstSeedPromise = new Promise<void>((resolve) => { releaseFirstSeed = resolve; });
    let secondSeedStarted!: () => void;
    const secondSeedStartedPromise = new Promise<void>((resolve) => { secondSeedStarted = resolve; });

    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/task-1")
          || args.includes("refs/remotes/origin/feature/task-2")
          || args.includes("refs/remotes/origin/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      if (command === "docker" && args.includes("--entrypoint") && args.includes("sh")) {
        const mount = args.find((arg) => typeof arg === "string" && arg.startsWith("type=volume,source=")) || "";
        if (!String(mount).includes("target=/workspace")) {
          return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
        }
        if (String(mount).includes("session-1")) {
          firstSeedStarted();
          await releaseFirstSeedPromise;
        }
        if (String(mount).includes("session-2")) {
          secondSeedStarted();
        }
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    const firstPrepare = manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
    );
    await firstSeedStartedPromise;

    const secondPrepare = manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-2",
      "feature/task-2",
      "feature/sprint-1",
    );

    await expect(Promise.race([
      secondSeedStartedPromise.then(() => "started"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 1000)),
    ])).resolves.toBe("started");

    releaseFirstSeed();
    await Promise.all([firstPrepare, secondPrepare]);
  });

  it("dedupes concurrent Docker seed bundles for identical feature-branch snapshots", async () => {
    let bundleStarted!: () => void;
    const bundleStartedPromise = new Promise<void>((resolve) => { bundleStarted = resolve; });
    let releaseBundle!: () => void;
    const releaseBundlePromise = new Promise<void>((resolve) => { releaseBundle = resolve; });
    let bundleCreates = 0;

    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "git" && args[0] === "bundle" && args[1] === "create") {
        bundleCreates += 1;
        bundleStarted();
        await releaseBundlePromise;
        return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    const firstPrepare = manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
    );
    await bundleStartedPromise;

    const secondPrepare = manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-2",
      "feature/task-2",
      "feature/sprint-1",
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bundleCreates).toBe(1);

    releaseBundle();
    await Promise.all([firstPrepare, secondPrepare]);

    const bundleCreateCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) =>
      call[0] === "git" && call[1][0] === "bundle" && call[1][1] === "create"
    );
    expect(bundleCreateCalls).toHaveLength(1);
    expect(bundleCreateCalls[0][1]).toEqual([
      "bundle",
      "create",
      path.join("/tmp/code-ux-bundle-123", "repo.bundle"),
      "refs/remotes/origin/feature/sprint-1",
    ]);
  });

  it("does not reuse a targeted bundle after its branch tip moves", async () => {
    let branchTip = "a".repeat(40);
    let bundleCreates = 0;
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/sprint-1")) return { ok: true, stdout: "", stderr: "" } as any;
        throw new Error("missing ref");
      }
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
        return { ok: true, stdout: `${branchTip}\n`, stderr: "" } as any;
      }
      if (command === "git" && args[0] === "bundle" && args[1] === "create") {
        bundleCreates += 1;
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.createSnapshotWorkspace("/repo/project", "session-1", {
      branch: "feature/sprint-1",
      remoteOnly: true,
    });
    branchTip = "b".repeat(40);
    await manager.createSnapshotWorkspace("/repo/project", "session-2", {
      branch: "feature/sprint-1",
      remoteOnly: true,
    });

    expect(bundleCreates).toBe(2);
  });

  it("creates local branch aliases in Docker prepare worktrees for requested remote-only refs", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/sprint-1") || args.includes("refs/remotes/origin/dev")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/sprint-1",
      "dev",
    );

    const seedCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[1].some((arg) => typeof arg === "string" && arg.includes("update-ref 'refs/heads/dev' 'refs/remotes/origin/dev'"))
    );
    expect(seedCall).toBeDefined();
  });

  it("prefers the exact remote worker ref over a local worker ref", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/remotes/origin/feature/task-1")
          || args.includes("refs/heads/feature/task-1")
          || args.includes("refs/remotes/origin/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
    );

    const seedCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[1].some((arg) => typeof arg === "string" && arg.includes("git -C /workspace checkout -B 'feature/task-1' 'origin/feature/task-1'"))
    );
    expect(seedCall).toBeDefined();
  });

  it("uses the remote feature ref instead of a local worker ref for remote-only worktrees", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/heads/feature/task-1")
          || args.includes("refs/remotes/origin/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
      undefined,
      undefined,
      { remoteOnly: true },
    );

    const seedCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
      call[0] === "docker"
      && call[1].includes("--entrypoint")
      && call[1].includes("sh")
      && call[1].some((arg) => typeof arg === "string" && arg.includes("git -C /workspace checkout -B 'feature/task-1' 'origin/feature/sprint-1'"))
    );
    expect(seedCall).toBeDefined();
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "git",
      ["bundle", "create", path.join("/tmp/code-ux-bundle-123", "repo.bundle"), "refs/heads/feature/task-1"],
      "/repo/project",
    );
  });

  it("fails remote-only worktrees when only local worker and feature refs exist", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "https://github.com/example/project.git\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/heads/feature/task-1")
          || args.includes("refs/heads/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await expect(manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-1",
      "feature/task-1",
      "feature/sprint-1",
      undefined,
      undefined,
      { remoteOnly: true },
    )).rejects.toThrow("remote-only isolated workspace");
  });

  it("falls back to local worker refs when the remote worker ref is missing", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        throw new Error("remote branch missing");
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/heads/feature/task-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "/repo/project/.worktrees/session-1",
      "feature/task-1",
      "feature/sprint-1",
    );

    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "--force", "-B", "feature/task-1", "/repo/project/.worktrees/session-1", "feature/task-1"],
      "/repo/project",
    );
  });

  it("reports missing worker and feature refs without broad branch enumeration", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { ok: true, stdout: "", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "fetch") {
        throw new Error("remote unavailable");
      }
      if (command === "git" && args[0] === "show-ref") {
        throw new Error("missing ref");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await expect(manager.prepareWorktree(
      "/repo/project",
      "/repo/project/.worktrees/session-1",
      "feature/task-1",
      "feature/sprint-1",
    )).rejects.toThrow("neither worker branch feature/task-1 nor feature branch feature/sprint-1 exists");

    const gitCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) => call[0] === "git");
    expect(gitCalls.some((call) => call[1].includes("branch"))).toBe(false);
    expect(gitCalls.some((call) => call[1].includes("for-each-ref"))).toBe(false);
    expect(gitCalls.some((call) => call[1][0] === "show-ref" && !call[1].includes("--verify"))).toBe(false);
  });

  it("builds workspace guidance with in-volume path checks", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "exists\n", stderr: "" } as any);

    const guidance = await manager.buildWorkspaceGuidance("Check src/index.ts and ../outside", "docker-volume://workspace-1");

    expect(guidance).toContain("Repository root: /workspace");
    expect(guidance).toContain("- src/index.ts: exists");
    expect(guidance).toContain("- ../outside: outside-workspace");
  });

  it("normalizes Windows-relative paths before reading from a host workspace", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("workspace content");

    const result = await manager.readWorkspaceFile("/repo/project", "src\\nested\\file.ts");

    expect(result).toBe("workspace content");
    expect(fs.readFile).toHaveBeenCalledWith("/repo/project/src/nested/file.ts", "utf8");
  });

  it("rejects absolute Windows paths when reading workspace files", async () => {
    const result = await manager.readWorkspaceFile("/repo/project", "C:\\outside\\file.ts");

    expect(result).toBeNull();
    expect(fs.readFile).not.toHaveBeenCalled();
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

  it("reuses successful public helper image checks across Docker workspace commands", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "" } as any);

    await Promise.all([
      manager.runWorkspaceCommand("docker-volume://workspace-1", "git", ["status", "--short"]),
      manager.runWorkspaceCommand("docker-volume://workspace-2", "git", ["status", "--short"]),
      manager.runWorkspaceCommand("docker-volume://workspace-3", "git", ["status", "--short"]),
    ]);

    const inspectCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) =>
      call[0] === "docker" && call[1][0] === "image" && call[1][1] === "inspect"
    );
    const runCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) =>
      call[0] === "docker" && call[1][0] === "run"
    );
    expect(inspectCalls).toHaveLength(1);
    expect(runCalls).toHaveLength(3);
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
    const dockerConfigDir = "/tmp/code-ux-docker-config-123";
    expect(pullCalls).toHaveLength(2);
    expect(pullCalls[1]?.[3]?.DOCKER_CONFIG).toBe(dockerConfigDir);
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(dockerConfigDir, "config.json"),
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

  it("accepts exact Git roots when configured and reported paths canonicalize to the same checkout", async () => {
    vi.mocked(fs.realpath).mockImplementation(async (candidate) => {
      const value = String(candidate);
      return value.replace(/^\/var\//, "/private/var/");
    });
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/private/var/folders/code-ux-project\n", stderr: "" } as any;
      }
      if (args[0] === "docker" && args[1] === "volume" && args[2] === "inspect") {
        throw new Error("missing");
      }
      if (args[0] === "git" && args[1] === "remote") {
        return { ok: true, stdout: "git@github.com:example/repo.git\n", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    await expect(manager.createSnapshotWorkspace("/var/folders/code-ux-project", "session-1"))
      .resolves
      .toMatch(/^docker-volume:\/\/code-ux-code-ux-project-[a-f0-9]{12}-session-1-snapshot$/);
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
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["volume", "rm", "-f", "code-ux-project-abcd1234ef56-session-1-runtime"],
      expect.any(String),
    );
  });

  describe("fastForwardResumedWorkspace", () => {
    const WORKTREE = "/repo/project/.worktrees/session-1";
    const ok = (stdout = "") => ({ ok: true, stdout, stderr: "", code: 0, signal: null } as any);

    const mockGit = (overrides: { head: string; tip: string | null; ancestor: boolean }) => {
      vi.mocked(runCommandStrict).mockImplementation(async (command: string, args: string[]) => {
        if (command === "git" && args[0] === "remote") return ok(""); // no origin url → no auth env
        if (command === "git" && args[0] === "fetch") return ok();
        if (command === "git" && args[0] === "rev-parse") {
          const ref = args[args.length - 1];
          if (ref === "HEAD") return ok(`${overrides.head}\n`);
          if (overrides.tip) return ok(`${overrides.tip}\n`);
          throw new Error("unknown revision"); // missing ref
        }
        if (command === "git" && args[0] === "merge-base") {
          if (overrides.ancestor) return ok();
          throw new Error("not an ancestor");
        }
        if (command === "git" && args[0] === "reset") return ok();
        return ok();
      });
    };

    it("fast-forwards onto the pushed worker-branch tip when the base is an ancestor", async () => {
      mockGit({ head: "stale-base", tip: "pushed-tip", ancestor: true });

      const advanced = await manager.fastForwardResumedWorkspace(WORKTREE, "feature/task-1", "/repo/project");

      expect(advanced).toBe(true);
      expect(runCommandStrict).toHaveBeenCalledWith(
        "git",
        ["reset", "--hard", "pushed-tip"],
        WORKTREE,
        expect.anything(),
        expect.anything(),
      );
    });

    it("does not reset when the workspace is already at the tip", async () => {
      mockGit({ head: "same-tip", tip: "same-tip", ancestor: true });

      const advanced = await manager.fastForwardResumedWorkspace(WORKTREE, "feature/task-1", "/repo/project");

      expect(advanced).toBe(false);
      expect(runCommandStrict).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["reset"]),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it("never discards unpushed local work when the base is not an ancestor of the tip", async () => {
      mockGit({ head: "local-only", tip: "diverged-tip", ancestor: false });

      const advanced = await manager.fastForwardResumedWorkspace(WORKTREE, "feature/task-1", "/repo/project");

      expect(advanced).toBe(false);
      expect(runCommandStrict).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["reset"]),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
