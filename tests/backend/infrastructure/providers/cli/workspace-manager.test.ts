import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  buildPersistentSkillStorageContainerPath,
  buildPersistentSkillStorageHostPath,
  CONTAINER_PERSISTENT_SKILL_STORAGE_ROOT,
  RuntimeVolumeRegistry,
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
vi.mock("../../../../../src/infrastructure/providers/cli/workspace-volume-helper.js", () => ({
  workspaceVolumeHelperPool: {
    exec: vi.fn(),
    reserve: vi.fn(() => vi.fn()),
    releaseVolume: vi.fn(),
  },
}));

import { runCommandStrict } from "../../../../../src/services/cli-process-runner.js";
import { workspaceVolumeHelperPool } from "../../../../../src/infrastructure/providers/cli/workspace-volume-helper.js";

const commandOk = (stdout = "") => ({ ok: true, stdout, stderr: "", code: 0, signal: null });

describe("WorkspaceManager", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    manager = new WorkspaceManager(new RuntimeVolumeRegistry());
    vi.clearAllMocks();
    vi.mocked(fs.mkdtemp).mockResolvedValue("/tmp/code-ux-bundle-123");
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.realpath).mockImplementation(async (candidate) => String(candidate));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(workspaceVolumeHelperPool.exec).mockResolvedValue(commandOk());
    vi.mocked(workspaceVolumeHelperPool.releaseVolume).mockResolvedValue(undefined);
  });

  it("builds Docker volume handles for isolated workspaces", () => {
    const result = manager.buildWorktreePath("/repo/project", "session-1", "DOCKER");
    expect(result).toMatch(/^docker-volume:\/\/code-ux-project-[a-f0-9]{12}-session-1$/);
  });

  it("hashes long workspace keys so distinct sprint identifiers cannot truncate to one volume", () => {
    const sharedPrefix = `planning-${"a".repeat(60)}`;
    const first = manager.buildWorktreePath("/repo/project", `${sharedPrefix}-sprint-one`, "DOCKER");
    const second = manager.buildWorktreePath("/repo/project", `${sharedPrefix}-sprint-two`, "DOCKER");

    expect(first).not.toBe(second);
    expect(first).toMatch(/-[a-f0-9]{8}$/);
    expect(second).toMatch(/-[a-f0-9]{8}$/);
    expect(first.slice("docker-volume://".length).length).toBeLessThanOrEqual(83);
  });

  it("uses a strong digest for networked workspace container names", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/infrastructure/providers/cli/workspace-manager.ts"),
      "utf8",
    );

    expect(source).toContain('const containerName = `code-ux-net-git-${createHash("sha256")');
    expect(source).not.toContain('const containerName = `code-ux-net-git-${createHash("sha1")');
  });

  it("labels hashed snapshot volumes with the original logical session id", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue(commandOk());
    const sessionId = `planning-${"a".repeat(60)}`;
    const workspace = manager.buildWorktreePath("/repo/project", `${sessionId}-snapshot`, "DOCKER");

    await (manager as unknown as {
      createVolume: (workspaceRef: string, workspaceSessionId: string) => Promise<void>;
    }).createVolume(workspace, sessionId);

    const volumeCreateCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "docker" && call[1][0] === "volume" && call[1][1] === "create"
    ));
    expect(workspace).toMatch(/-[a-f0-9]{8}$/);
    expect(volumeCreateCalls).toHaveLength(2);
    expect(volumeCreateCalls.every((call) => (
      call[1].includes(`code-ux.workspace-session=${sessionId}`)
    ))).toBe(true);
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
    vi.mocked(workspaceVolumeHelperPool.exec).mockResolvedValue(commandOk("feature/task-2\n"));
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "", code: 0, signal: null } as any;
      }
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "", code: 0, signal: null } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    const result = await manager.resolveCurrentBranch("docker-volume://workspace-1");

    expect(result).toBe("feature/task-2");
    expect(workspaceVolumeHelperPool.exec).toHaveBeenCalledWith(
      "workspace-1",
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      "workspace-1-runtime",
      expect.objectContaining({ workdir: "/workspace" }),
    );
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
      expect.arrayContaining([
        "volume",
        "create",
        "--label",
        "code-ux.workspace=true",
        "--label",
        "code-ux.workspace-session=session-1",
      ]),
      expect.any(String),
    );
    const bundlePath = path.join("/tmp/code-ux-bundle-123", "repo.bundle");
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["bundle", "create", bundlePath, "--all"], "/repo/project");
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "volume",
        "create",
        "--label",
        "code-ux.workspace-runtime=true",
        "--label",
        "code-ux.workspace-session=session-1",
      ]),
      expect.any(String),
    );
    const bootstrapCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
      && call[3]
      && "stdinFile" in call[3]
    );
    expect(bootstrapCall?.slice(0, 3)).toEqual([
      expect.stringMatching(/^code-ux-project-[a-f0-9]{12}-session-1-snapshot$/),
      ["sh", "-lc", expect.any(String)],
      expect.stringMatching(/^code-ux-project-[a-f0-9]{12}-session-1-snapshot-runtime$/),
    ]);
    expect(bootstrapCall?.[3]).toEqual(expect.objectContaining({
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
    expect(bootstrapCommand).toContain("(rm -rf /workspace/");
    expect(bootstrapCommand).toContain("(git -C /workspace remote remove origin");
    expect(bootstrapCommand).not.toContain("git clone");
    expect(vi.mocked(runCommandStrict).mock.calls.some((call) => call[0] === "bash")).toBe(false);
    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(bootstrapCommand).toContain("chown -R");
      expect(bootstrapCommand).toContain(`${process.getuid()}:${process.getgid()}`);
    }
  });

  it("creates Git bundles under the repository metadata so the warm helper can write them", async () => {
    vi.mocked(fs.mkdtemp).mockImplementation(async (prefix) => `${String(prefix)}fixture`);
    vi.mocked(runCommandStrict).mockResolvedValue(commandOk());

    const result = await (manager as unknown as {
      createGitBundle: (
        repoPath: string,
        bundleRefArgs: string[],
      ) => Promise<{ bundlePath: string; tempDir: string }>;
    }).createGitBundle("/repo/project", ["refs/remotes/origin/dev"]);

    const bundleRoot = path.join("/repo/project", ".git", "code-ux-bundles");
    expect(fs.mkdir).toHaveBeenCalledWith(bundleRoot, { recursive: true, mode: 0o700 });
    expect(result.bundlePath).toBe(path.join(bundleRoot, "bundle-fixture", "repo.bundle"));
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["bundle", "create", result.bundlePath, "refs/remotes/origin/dev"],
      "/repo/project",
    );
  });

  it("reuses a snapshot workspace only when it has a valid Git HEAD", async () => {
    vi.mocked(workspaceVolumeHelperPool.exec).mockResolvedValue(commandOk("existing-head\n"));
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "" } as any;
      }
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "" } as any;
      }
      return { ok: true, stdout: "existing-head\n", stderr: "" } as any;
    });

    const beforeCreate = vi.fn(async () => undefined);
    const workspace = await manager.createOrReuseSnapshotWorkspace(
      "/repo/project",
      "session-1",
      { branch: "feature/task-1" },
      beforeCreate,
    );

    expect(workspace).toMatch(/^docker-volume:\/\/code-ux-project-[a-f0-9]{12}-session-1-snapshot$/);
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(workspaceVolumeHelperPool.exec).toHaveBeenCalledWith(
      expect.stringMatching(/^code-ux-project-[a-f0-9]{12}-session-1-snapshot$/),
      ["git", "rev-parse", "--verify", "HEAD"],
      expect.stringMatching(/^code-ux-project-[a-f0-9]{12}-session-1-snapshot-runtime$/),
      expect.any(Object),
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "create", "--label", "code-ux.workspace=true"]),
      expect.any(String),
    );
  });

  it("rebuilds an interrupted snapshot volume that has no Git HEAD", async () => {
    vi.mocked(workspaceVolumeHelperPool.exec).mockImplementation(async (_volumeName, commandArgs) => {
      if (commandArgs[0] === "git" && commandArgs.includes("--verify") && commandArgs.includes("HEAD")) {
        return { ok: false, stdout: "", stderr: "fatal: Needed a single revision", code: 128, signal: null };
      }
      return commandOk();
    });
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        if (args.includes("--format")) {
          return { ok: true, stdout: "true\n", stderr: "" } as any;
        }
        return { ok: true, stdout: "[]", stderr: "" } as any;
      }
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "remote") {
        return { ok: true, stdout: "git@github.com:example/repo.git\n", stderr: "" } as any;
      }
      return { ok: true, stdout: "", stderr: "" } as any;
    });

    const beforeCreate = vi.fn(async () => undefined);
    const workspace = await manager.createOrReuseSnapshotWorkspace(
      "/repo/project",
      "session-1",
      undefined,
      beforeCreate,
    );
    const volumeName = workspace.replace("docker-volume://", "");

    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["volume", "rm", "-f", volumeName],
      process.cwd(),
    );
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "create", "--label", "code-ux.workspace=true"]),
      expect.any(String),
    );
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["bundle", "create", path.join("/tmp/code-ux-bundle-123", "repo.bundle"), "--all"],
      "/repo/project",
    );
  });

  it("runs reusable snapshot refresh once inside the workspace creation lock", async () => {
    let volumePresent = false;
    let seeded = false;
    let refreshStarted!: () => void;
    const refreshStartedPromise = new Promise<void>((resolve) => { refreshStarted = resolve; });
    let releaseRefresh!: () => void;
    const releaseRefreshPromise = new Promise<void>((resolve) => { releaseRefresh = resolve; });

    vi.mocked(workspaceVolumeHelperPool.exec).mockImplementation(async (_volumeName, commandArgs, _runtime, options) => {
      if (commandArgs[0] === "git" && commandArgs.includes("--verify") && commandArgs.includes("HEAD")) {
        return seeded
          ? commandOk(`${"a".repeat(40)}\n`)
          : { ok: false, stdout: "", stderr: "missing HEAD", code: 128, signal: null };
      }
      if (options?.stdinFile) {
        seeded = true;
      }
      return commandOk();
    });
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return commandOk("/repo/project\n");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        if (!volumePresent) throw new Error("missing");
        return commandOk("[]");
      }
      if (command === "docker" && args[0] === "volume" && args[1] === "create") {
        if (args.includes("code-ux.workspace=true")) volumePresent = true;
        return commandOk();
      }
      if (command === "git" && args[0] === "show-ref") {
        return commandOk();
      }
      if (command === "git" && args[0] === "remote") {
        return commandOk("https://github.com/example/project.git\n");
      }
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
        return commandOk(`${"a".repeat(40)}\n`);
      }
      return commandOk();
    });

    const firstBeforeCreate = vi.fn(async () => {
      refreshStarted();
      await releaseRefreshPromise;
    });
    const secondBeforeCreate = vi.fn(async () => undefined);
    const first = manager.createOrReuseSnapshotWorkspace(
      "/repo/project",
      "session-1",
      { branch: "feature/task-1" },
      firstBeforeCreate,
    );
    await refreshStartedPromise;
    const second = manager.createOrReuseSnapshotWorkspace(
      "/repo/project",
      "session-1",
      { branch: "feature/task-1" },
      secondBeforeCreate,
    );

    expect(firstBeforeCreate).toHaveBeenCalledOnce();
    expect(secondBeforeCreate).not.toHaveBeenCalled();
    releaseRefresh();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.stringContaining("session-1-snapshot"),
      expect.stringContaining("session-1-snapshot"),
    ]);
    expect(firstBeforeCreate).toHaveBeenCalledOnce();
    expect(secondBeforeCreate).not.toHaveBeenCalled();
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

  it("shares runtime-volume readiness across workspace manager instances", async () => {
    const registry = new RuntimeVolumeRegistry();
    const prepareManager = new WorkspaceManager(registry);
    const providerManager = new WorkspaceManager(registry);
    vi.mocked(runCommandStrict).mockResolvedValue(commandOk());

    await prepareManager.ensureRuntimeVolume("docker-volume://workspace-shared", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });
    vi.clearAllMocks();
    await providerManager.ensureRuntimeVolume("docker-volume://workspace-shared", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });

    expect(runCommandStrict).not.toHaveBeenCalled();
  });

  it("coalesces concurrent runtime-volume initialization across manager instances", async () => {
    const registry = new RuntimeVolumeRegistry();
    const firstManager = new WorkspaceManager(registry);
    const secondManager = new WorkspaceManager(registry);
    let releaseCreate!: () => void;
    const createBlocked = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "docker" && args[0] === "volume" && args[1] === "create") {
        markCreateStarted();
        await createBlocked;
      }
      return commandOk();
    });

    const first = firstManager.ensureRuntimeVolume("docker-volume://workspace-shared", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });
    await createStarted;
    const second = secondManager.ensureRuntimeVolume("docker-volume://workspace-shared", {
      initializeOwnership: true,
      ownerSpec: "1001:1002",
    });
    releaseCreate();
    await Promise.all([first, second]);

    const volumeCreates = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "docker" && call[1][0] === "volume" && call[1][1] === "create"
    ));
    const ownershipInitializations = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "docker" && call[1][0] === "run" && String(call[1].at(-1)).includes("chown -R")
    ));
    expect(volumeCreates).toHaveLength(1);
    expect(ownershipInitializations).toHaveLength(1);
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

    const checkoutCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
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
    vi.mocked(workspaceVolumeHelperPool.exec).mockImplementation(async (_volumeName, commandArgs) => {
      if (commandArgs.includes("checkout") || String(commandArgs.at(-1)).includes("git -C /workspace checkout")) {
        checkoutAttempts += 1;
        if (checkoutAttempts <= 2) {
          return { ok: false, stdout: "", stderr: "checkout failed: missing object", code: 1, signal: null };
        }
      }
      return commandOk();
    });
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

    const checkoutCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
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
    const bootstrapCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
      && call[3]
      && "stdinFile" in call[3]
    );
    expect(bootstrapCall?.[3]).toEqual(expect.objectContaining({
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
      undefined,
      undefined,
      { allowExistingWorkerBranch: true },
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
    const seedCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
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

  it("skips remote fetches when local Git refs are authoritative", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/heads/feature/sprint-1")) {
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
      "docker-volume://code-ux-project-abcd1234ef56-session-local",
      "feature/task-local",
      "feature/sprint-1",
      undefined,
      undefined,
      { refreshRemote: false },
    );

    expect(vi.mocked(runCommandStrict).mock.calls.some((call) => (
      call[0] === "git" && call[1][0] === "fetch"
    ))).toBe(false);
  });

  it("refreshes only the feature branch for fresh remote worktrees", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
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
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-remote",
      "feature/task-remote",
      "feature/sprint-1",
      undefined,
      undefined,
      { remoteOnly: true, refreshRemote: true },
    );

    const fetchCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "git" && call[1][0] === "fetch"
    ));
    expect(fetchCalls.map((call) => call[1])).toEqual([[
      "fetch",
      "origin",
      "+refs/heads/feature/sprint-1:refs/remotes/origin/feature/sprint-1",
    ]]);
  });

  it("refreshes worker and feature branches for resumed remote worktrees", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
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
      if (command === "docker" && args[0] === "volume" && args[1] === "inspect") {
        throw new Error("missing");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    await manager.prepareWorktree(
      "/repo/project",
      "docker-volume://code-ux-project-abcd1234ef56-session-resume",
      "feature/task-resume",
      "feature/sprint-1",
      "resume-session",
      undefined,
      { remoteOnly: true, refreshRemote: true },
    );

    const fetchCalls = vi.mocked(runCommandStrict).mock.calls.filter((call) => (
      call[0] === "git" && call[1][0] === "fetch"
    ));
    expect(fetchCalls.map((call) => call[1])).toEqual([
      [
        "fetch",
        "origin",
        "+refs/heads/feature/task-resume:refs/remotes/origin/feature/task-resume",
      ],
      [
        "fetch",
        "origin",
        "+refs/heads/feature/sprint-1:refs/remotes/origin/feature/sprint-1",
      ],
    ]);
  });

  it("reseeds a Docker prepare worktree when the prepared volume has no HEAD", async () => {
    let headChecks = 0;
    vi.mocked(workspaceVolumeHelperPool.exec).mockImplementation(async (_volumeName, commandArgs) => {
      if (
        commandArgs[0] === "git"
        && commandArgs.includes("rev-parse")
        && commandArgs.includes("--verify")
        && commandArgs.includes("HEAD")
      ) {
        headChecks += 1;
        if (headChecks === 1) {
          return { ok: false, stdout: "", stderr: "not a git repository", code: 128, signal: null };
        }
        return commandOk("abc123\n");
      }
      return commandOk();
    });
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
      undefined,
      undefined,
      { allowExistingWorkerBranch: true },
    );

    expect(headChecks).toBe(2);
    const seedCalls = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.filter((call) =>
      call[1][0] === "sh"
      && call[3]
      && "stdinFile" in call[3]
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
    let secondSeedDidStart = false;

    vi.mocked(workspaceVolumeHelperPool.exec).mockImplementation(async (volumeName, commandArgs) => {
      if (commandArgs[0] !== "sh" || !String(commandArgs.at(-1)).includes("git init /workspace")) {
        return commandOk();
      }
      if (volumeName.includes("session-1")) {
        firstSeedStarted();
        await releaseFirstSeedPromise;
      }
      if (volumeName.includes("session-2")) {
        secondSeedDidStart = true;
        secondSeedStarted();
      }
      return commandOk();
    });

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

    try {
      await vi.waitFor(() => expect(secondSeedDidStart).toBe(true), { timeout: 5_000 });
      await secondSeedStartedPromise;
    } finally {
      releaseFirstSeed();
      await Promise.allSettled([firstPrepare, secondPrepare]);
    }
  });

  it("dedupes concurrent Docker seed bundles for identical feature-branch snapshots", async () => {
    let bundleStarted!: () => void;
    const bundleStartedPromise = new Promise<void>((resolve) => { bundleStarted = resolve; });
    let releaseBundle!: () => void;
    const releaseBundlePromise = new Promise<void>((resolve) => { releaseBundle = resolve; });
    let bundleCreates = 0;
    let bundleKeyResolutions = 0;

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
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
        bundleKeyResolutions += 1;
        return { ok: true, stdout: `${"a".repeat(40)}\n`, stderr: "" } as any;
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

    try {
      await vi.waitFor(() => expect(bundleKeyResolutions).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
      expect(bundleCreates).toBe(1);
    } finally {
      releaseBundle();
      await Promise.allSettled([firstPrepare, secondPrepare]);
    }

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

    const seedCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
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
      undefined,
      undefined,
      { allowExistingWorkerBranch: true },
    );

    const seedCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
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

    const seedCall = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.find((call) =>
      call[1][0] === "sh"
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
      undefined,
      undefined,
      { allowExistingWorkerBranch: true },
    );

    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "--force", "-B", "feature/task-1", "/repo/project/.worktrees/session-1", "feature/task-1"],
      "/repo/project",
    );
  });

  it("atomically creates a fresh host worker branch without resetting an existing ref", async () => {
    vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { ok: true, stdout: "/repo/project\n", stderr: "" } as any;
      }
      if (command === "git" && args[0] === "show-ref") {
        if (args.includes("refs/heads/feature/sprint-1")) {
          return { ok: true, stdout: "", stderr: "" } as any;
        }
        throw new Error("missing ref");
      }
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null } as any;
    });

    const result = await manager.prepareWorktree(
      "/repo/project",
      "/repo/project/.worktrees/session-fresh",
      "feature/task-fresh",
      "feature/sprint-1",
      undefined,
      undefined,
      { refreshRemote: false, allowExistingWorkerBranch: false },
    );

    expect(result).toEqual({
      worktreePath: "/repo/project/.worktrees/session-fresh",
      resumed: false,
      createdFreshWorkerBranch: true,
    });
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      [
        "worktree",
        "add",
        "--force",
        "-b",
        "feature/task-fresh",
        "/repo/project/.worktrees/session-fresh",
        "feature/sprint-1",
      ],
      "/repo/project",
    );
    expect(vi.mocked(runCommandStrict).mock.calls.some((call) => (
      call[0] === "git"
      && call[1][0] === "worktree"
      && call[1].includes("-B")
    ))).toBe(false);
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
    vi.mocked(workspaceVolumeHelperPool.exec).mockResolvedValue(commandOk("exists\n"));

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

  it("runs ordinary workspace commands through the reusable sidecar with filtered environment", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "", stderr: "" } as any);

    await manager.runWorkspaceCommand("docker-volume://workspace-1", "git", ["status", "--short"], {
      env: {
        ...process.env,
        GIT_INDEX_FILE: ".code-ux-export.index",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: "Authorization: Basic redacted",
        GIT_PROVIDER_API_KEY: "git-prefixed-provider-secret",
        OPENAI_API_KEY: "provider-secret",
        APP_SECRET_SHOULD_NOT_LEAK: "secret",
      },
    });

    expect(workspaceVolumeHelperPool.exec).toHaveBeenCalledWith(
      "workspace-1",
      ["git", "status", "--short"],
      "workspace-1-runtime",
      expect.objectContaining({
        environment: expect.objectContaining({
          HOME: "/tmp/code-ux-home",
          GIT_AUTHOR_NAME: "Code UX",
          GIT_AUTHOR_EMAIL: "agents@codeux.ai",
          GIT_COMMITTER_NAME: "Code UX",
          GIT_COMMITTER_EMAIL: "agents@codeux.ai",
          GIT_INDEX_FILE: ".code-ux-export.index",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: "Authorization: Basic redacted",
        }),
        workdir: "/workspace",
      }),
    );
    const environment = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls[0]?.[3]?.environment;
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("GIT_PROVIDER_API_KEY");
    expect(environment).not.toHaveProperty("APP_SECRET_SHOULD_NOT_LEAK");
  });

  it("throws when a reusable sidecar command fails", async () => {
    vi.mocked(runCommandStrict).mockResolvedValue(commandOk());
    vi.mocked(workspaceVolumeHelperPool.exec).mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: "fatal: invalid workspace",
      code: 128,
      signal: null,
    });

    await expect(manager.runWorkspaceCommand(
      "docker-volume://workspace-1",
      "git",
      ["status", "--short"],
    )).rejects.toThrow("git status --short failed: fatal: invalid workspace");
  });

  it.each(["fetch", "push", "pull", "ls-remote", "submodule"])(
    "keeps networked git %s commands on a one-shot container",
    async (gitCommand) => {
      vi.mocked(runCommandStrict).mockResolvedValue(commandOk());

      await manager.runWorkspaceCommand(
        "docker-volume://workspace-1",
        "git",
        [gitCommand, "origin"],
        { env: { ...process.env, OPENAI_API_KEY: "provider-secret" } },
      );

      expect(workspaceVolumeHelperPool.exec).not.toHaveBeenCalled();
      const runCall = vi.mocked(runCommandStrict).mock.calls.find((call) => (
        call[0] === "docker" && call[1][0] === "run"
      ));
      expect(runCall?.[1]).toEqual(expect.arrayContaining([
        "--label",
        "code-ux.managed=true",
        "--label",
        "code-ux.helper=network-git",
        "--security-opt",
        "no-new-privileges",
        "--pull",
        "never",
        "--mount",
        "type=tmpfs,target=/git",
        "--entrypoint",
        "git",
        "alpine/git",
        gitCommand,
        "origin",
      ]));
      const nameIndex = runCall?.[1].indexOf("--name") ?? -1;
      expect(nameIndex).toBeGreaterThanOrEqual(0);
      expect(runCall?.[1][nameIndex + 1]).toMatch(/^code-ux-net-git-[a-f0-9]{24}$/);
      expect(runCall?.[1].some((arg) => /^code-ux\.runtime-owner=/.test(arg))).toBe(true);
      expect(runCall?.[1].join(" ")).not.toContain("provider-secret");
    },
  );

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
    expect(inspectCalls).toHaveLength(1);
    expect(workspaceVolumeHelperPool.exec).toHaveBeenCalledTimes(3);
    expect(vi.mocked(workspaceVolumeHelperPool.exec).mock.calls.map((call) => call[0])).toEqual([
      "workspace-1",
      "workspace-2",
      "workspace-3",
    ]);
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

    const options = vi.mocked(workspaceVolumeHelperPool.exec).mock.calls[0]?.[3];
    expect(options?.environment).toEqual(expect.objectContaining({
      GIT_AUTHOR_NAME: "Custom Author",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Custom Committer",
      GIT_COMMITTER_EMAIL: "committer@example.com",
    }));

    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(options?.user).toBe(`${process.getuid()}:${process.getgid()}`);
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
    expect(workspaceVolumeHelperPool.exec).toHaveBeenCalledWith(
      "workspace-1",
      ["git", "status", "--short"],
      "workspace-1-runtime",
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

    expect(workspaceVolumeHelperPool.releaseVolume).toHaveBeenCalledWith(
      "code-ux-project-abcd1234ef56-session-1",
    );

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

  it("releases a preserved Docker workspace helper without deleting its volumes", async () => {
    await manager.releaseWorkspaceHelper("docker-volume://workspace-1");
    await manager.releaseWorkspaceHelper("/repo/project/.worktrees/session-1");

    expect(workspaceVolumeHelperPool.releaseVolume).toHaveBeenCalledTimes(1);
    expect(workspaceVolumeHelperPool.releaseVolume).toHaveBeenCalledWith("workspace-1");
    expect(runCommandStrict).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["volume", "rm"]),
      expect.anything(),
    );
  });

  it("reserves the exact workspace and runtime-volume helper generation", () => {
    const releaseReservation = vi.fn();
    vi.mocked(workspaceVolumeHelperPool.reserve).mockReturnValueOnce(releaseReservation);

    const release = manager.reserveWorkspaceHelper("docker-volume://workspace-1");

    expect(workspaceVolumeHelperPool.reserve).toHaveBeenCalledWith(
      "workspace-1",
      "workspace-1-runtime",
    );
    release();
    expect(releaseReservation).toHaveBeenCalledOnce();

    const releaseHost = manager.reserveWorkspaceHelper("/repo/project/.worktrees/session-1");
    releaseHost();
    expect(workspaceVolumeHelperPool.reserve).toHaveBeenCalledTimes(1);
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
