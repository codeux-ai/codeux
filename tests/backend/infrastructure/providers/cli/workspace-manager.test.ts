import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceManager } from "../../../../../src/infrastructure/providers/cli/workspace-manager.js";
import * as fs from "fs/promises";
import * as path from "path";
import os from "os";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-workflow-text-utils.js", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod as any, extractPathHints: vi.fn() };
});
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "" })
}));

import { runCommandStrict } from "../../../../../src/services/cli-process-runner.js";
import { extractPathHints } from "../../../../../src/services/cli-workflow-text-utils.js";

describe("WorkspaceManager", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    manager = new WorkspaceManager();
    vi.clearAllMocks();
  });

  describe("buildWorktreePath", () => {
    it("should build path for DOCKER mode", () => {
      const p = manager.buildWorktreePath("/repo", "session-1", "DOCKER");
      expect(p).toBe(path.join("/repo", ".sprint-os", "worktrees", "session-1"));
    });

    it("should build path for HOST mode using homedir", () => {
      const p = manager.buildWorktreePath("/repo", "session-1", "HOST");
      expect(p).toContain(os.homedir());
      expect(p).toContain(".sprint-os");
      expect(p).toContain("session-1");
    });
  });


  describe("resolveResumeWorktreePath", () => {
    it("should return primary path if it exists", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const res = await manager.resolveResumeWorktreePath("/repo", "session-1", "DOCKER");
      expect(res).toBe(manager.buildWorktreePath("/repo", "session-1", "DOCKER"));
    });

    it("should return primary path if primary is missing and mode is HOST", async () => {
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("primary not found"));
      const res = await manager.resolveResumeWorktreePath("/repo", "session-1", "HOST");
      expect(res).toBe(manager.buildWorktreePath("/repo", "session-1", "HOST"));
    });

    it("should return undefined if primary fails and mode is DOCKER", async () => {
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("primary not found"));
      const res = await manager.resolveResumeWorktreePath("/repo", "session-1", "DOCKER");
      expect(res).toBeUndefined();
    });

    it("should return primary path if both fail and mode is HOST", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("not found"));
      const res = await manager.resolveResumeWorktreePath("/repo", "session-1", "HOST");
      expect(res).toBe(manager.buildWorktreePath("/repo", "session-1", "HOST"));
    });
  });

  describe("prepareWorktree", () => {
    it("should prepare fresh worktree", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("not found"));
      const result = await manager.prepareWorktree("/repo", "/final", "worker", "feature");
      expect(result).toEqual({ worktreePath: "/final", resumed: false });
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname("/final"), { recursive: true });
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["fetch", "origin"], "/repo");
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["worktree", "remove", "--force", "/final"], "/repo");
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["worktree", "prune"], "/repo");
      expect(runCommandStrict).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "--force", "-B", "worker", "/final", "origin/feature"],
        "/repo"
      );
    });

it("should retry fetch after repairing stale git state on first failure", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("not found"));
      vi.mocked(fs.readdir as any).mockResolvedValue([]); // no worktree entries to clean
      let fetchCallCount = 0;
      vi.mocked(runCommandStrict).mockImplementation(async (_cmd, args) => {
        if (args.includes("fetch") && args.includes("origin")) {
          fetchCallCount++;
          if (fetchCallCount === 1) throw new Error("fatal: bad object");
          return { ok: true, stdout: "", stderr: "" };
        }
        if (args.includes("list") && args.includes("--porcelain")) {
          return { ok: true, stdout: "", stderr: "" };
        }
        return { ok: true, stdout: "", stderr: "" };
      });

      const result = await manager.prepareWorktree("/repo", "/final", "worker", "feature");
      expect(result).toEqual({ worktreePath: "/final", resumed: false });
      expect(fetchCallCount).toBe(2); // first failed, second succeeded after repair
    });

    it("should resume session if resumable path is found", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(runCommandStrict).mockImplementation(async (cmd, args) => {
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n", stderr: "" };
        if (args.includes("HEAD")) return { ok: true, stdout: "worker\n", stderr: "" };
        return { ok: true, stdout: "", stderr: "" };
      });

      const result = await manager.prepareWorktree("/repo", "/final", "worker", "feature", "session-1");
      expect(result).toEqual({ worktreePath: "/final", resumed: true });

      const calls = vi.mocked(runCommandStrict).mock.calls;
      const addCalls = calls.filter(c => c[1][0] === "worktree" && c[1][1] === "add");
      expect(addCalls).toHaveLength(0);
    });
  });

  describe("pathExists", () => {
    it("should return true if fs.access succeeds", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      expect(await (manager as any).pathExists("/test")).toBe(true);
    });

    it("should return false if fs.access fails", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("fail"));
      expect(await (manager as any).pathExists("/test")).toBe(false);
    });
  });

  describe("removeWorktreeInternal", () => {
    it("should call git worktree remove and fs.rm", async () => {
      await (manager as any).removeWorktreeInternal("/repo", "/worktree");
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["worktree", "remove", "--force", "/worktree"], "/repo");
      expect(fs.rm).toHaveBeenCalledWith("/worktree", { recursive: true, force: true });
    });
  });

    describe("removeWorktree", () => {
    it("should acquire lock and call removeWorktreeInternal", async () => {
      // We know removeWorktree calls removeWorktreeInternal which calls git worktree remove and fs.rm
      await manager.removeWorktree("/repo", "/worktree");
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["worktree", "remove", "--force", "/worktree"], "/repo");
      expect(fs.rm).toHaveBeenCalledWith("/worktree", { recursive: true, force: true });
    });
  });

  describe("canResumeExistingWorktree", () => {
    it("should return false if path does not exist", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("not found"));
      const res = await (manager as any).canResumeExistingWorktree("/worktree", "expected-branch");
      expect(res).toBe(false);
    });

    it("should return false if not inside work tree", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(runCommandStrict).mockResolvedValueOnce({ ok: true, stdout: "false\n", stderr: "" });
      const res = await (manager as any).canResumeExistingWorktree("/worktree", "expected-branch");
      expect(res).toBe(false);
    });

    it("should return true and checkout if branch mismatch", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(runCommandStrict)
        .mockResolvedValueOnce({ ok: true, stdout: "true\n", stderr: "" })
        .mockResolvedValueOnce({ ok: true, stdout: "other-branch\n", stderr: "" })
        .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" }); // checkout

      const res = await (manager as any).canResumeExistingWorktree("/worktree", "expected-branch");
      expect(res).toBe(true);
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["checkout", "expected-branch"], "/worktree");
    });
  });

  describe("findWorktreePathForBranch", () => {
    it("should parse git worktree list --porcelain correctly", async () => {
      const gitOutput = `worktree /path/to/worktree
branch refs/heads/expected-branch

worktree /path/to/other
branch refs/heads/other-branch`;

      vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: gitOutput, stderr: "" });

      const res = await (manager as any).findWorktreePathForBranch("/repo", "expected-branch");
      expect(res).toBe("/path/to/worktree");
    });

    it("should return undefined if branch not found", async () => {
      const gitOutput = `worktree /path/to/other
branch refs/heads/other-branch`;

      vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: gitOutput, stderr: "" });

      const res = await (manager as any).findWorktreePathForBranch("/repo", "expected-branch");
      expect(res).toBeUndefined();
    });
  });

  describe("removeStaleWorktreeRegistration", () => {
    it("should swallow errors from git remove and prune", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("git failed"));
      await expect((manager as any).removeStaleWorktreeRegistration("/repo", "/worktree")).resolves.not.toThrow();
    });
  });

    describe("resolveResumableWorktreePath", () => {
    it("should return preferred path if can resume", async () => {
      manager.canResumeExistingWorktree = vi.fn().mockResolvedValue(true);
      const res = await (manager as any).resolveResumableWorktreePath("/repo", "branch", "/preferred");
      expect(res).toBe("/preferred");
    });

    it("should return branch path if preferred fails and branch can resume", async () => {
      manager.canResumeExistingWorktree = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      manager.findWorktreePathForBranch = vi.fn().mockResolvedValue("/branch-path");

      const res = await (manager as any).resolveResumableWorktreePath("/repo", "branch", "/preferred");
      expect(res).toBe("/branch-path");
    });

    it("should remove stale registration if neither can resume", async () => {
      manager.canResumeExistingWorktree = vi.fn().mockResolvedValue(false);
      manager.findWorktreePathForBranch = vi.fn().mockResolvedValue("/branch-path");
      manager.removeStaleWorktreeRegistration = vi.fn().mockResolvedValue(undefined);

      const res = await (manager as any).resolveResumableWorktreePath("/repo", "branch", "/preferred");
      expect(res).toBeUndefined();
      expect(manager.removeStaleWorktreeRegistration).toHaveBeenCalledWith("/repo", "/branch-path");
    });
  });

  describe("repairStaleGitState", () => {
    it("should remove stale worktree entries whose gitdir targets are missing", async () => {
      vi.mocked(fs.readdir as any).mockResolvedValueOnce(["stale-wt", "ok-wt"]);
      vi.mocked(fs.readFile as any)
        .mockResolvedValueOnce("/missing/path/.git\n")   // stale-wt/gitdir
        .mockResolvedValueOnce("/existing/path/.git\n"); // ok-wt/gitdir
      vi.mocked(fs.access)
        .mockRejectedValueOnce(new Error("missing"))  // stale-wt gitdir target missing
        .mockResolvedValueOnce(undefined);              // ok-wt gitdir target exists
      vi.mocked(fs.rm).mockResolvedValue(undefined);

      await (manager as any).repairStaleGitState("/repo");

      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/repo", ".git", "worktrees", "stale-wt"),
        { recursive: true, force: true },
      );
    });

    it("should survive if .git/worktrees dir does not exist", async () => {
      vi.mocked(fs.readdir as any).mockRejectedValueOnce(new Error("ENOENT"));
      await expect((manager as any).repairStaleGitState("/repo")).resolves.not.toThrow();
    });
  });

  describe("removeCorruptRefsInDir", () => {
    it("should remove empty ref files", async () => {
      vi.mocked(fs.readdir as any).mockResolvedValueOnce([
        { name: "good-ref", isDirectory: () => false },
        { name: "empty-ref", isDirectory: () => false },
      ]);
      vi.mocked(fs.readFile as any)
        .mockResolvedValueOnce("abcdef1234567890abcdef1234567890abcdef12")  // good-ref: valid sha
        .mockResolvedValueOnce("");  // empty-ref
      vi.mocked(fs.rm).mockResolvedValue(undefined);
      vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "commit\n", stderr: "" });

      await (manager as any).removeCorruptRefsInDir("/repo", "/repo/.git/refs/heads");

      // empty-ref should be removed
      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/repo/.git/refs/heads", "empty-ref"),
        { force: true },
      );
    });

    it("should remove refs pointing to bad objects", async () => {
      vi.mocked(fs.readdir as any).mockResolvedValueOnce([
        { name: "bad-ref", isDirectory: () => false },
      ]);
      vi.mocked(fs.readFile as any)
        .mockResolvedValueOnce("abcdef1234567890abcdef1234567890abcdef12");
      vi.mocked(runCommandStrict).mockRejectedValueOnce(new Error("bad object"));
      vi.mocked(fs.rm).mockResolvedValue(undefined);

      await (manager as any).removeCorruptRefsInDir("/repo", "/repo/.git/refs/heads");

      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/repo/.git/refs/heads", "bad-ref"),
        { force: true },
      );
    });

    it("should recurse into subdirectories", async () => {
      vi.mocked(fs.readdir as any)
        .mockResolvedValueOnce([
          { name: "subdir", isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]); // subdir contents

      await (manager as any).removeCorruptRefsInDir("/repo", "/repo/.git/refs/heads");

      expect(fs.readdir).toHaveBeenCalledWith(
        path.join("/repo/.git/refs/heads", "subdir"),
        { withFileTypes: true },
      );
    });

    it("should handle readdir failure gracefully", async () => {
      vi.mocked(fs.readdir as any).mockRejectedValueOnce(new Error("ENOENT"));
      await expect(
        (manager as any).removeCorruptRefsInDir("/repo", "/repo/.git/refs/heads"),
      ).resolves.not.toThrow();
    });
  });

    describe("withRepoLock", () => {
    it("should execute sequentially", async () => {
      let active = 0;
      let maxActive = 0;

      const fn = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, 10));
        active--;
      };

      await Promise.all([
        (manager as any).withRepoLock("/repo", fn),
        (manager as any).withRepoLock("/repo", fn),
        (manager as any).withRepoLock("/repo", fn)
      ]);

      expect(maxActive).toBe(1);
    });

    it("should recover if error thrown", async () => {
      let executed = false;
      const fnThrow = async () => { throw new Error("test"); };
      const fnOk = async () => { executed = true; };

      await expect((manager as any).withRepoLock("/repo", fnThrow)).rejects.toThrow("test");
      await (manager as any).withRepoLock("/repo", fnOk);
      expect(executed).toBe(true);
    });
  });

  describe("buildWorkspaceGuidance", () => {
    it("should handle mixed hint states (exists, not-found, outside)", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "/repo-root\n", stderr: "" });

      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // exists
        .mockRejectedValueOnce(new Error("not found")); // not-found

      vi.mocked(extractPathHints).mockReturnValue(["src/index.ts", "missing.ts", "../../../outside/path.ts"]);
      const guidance = await manager.buildWorkspaceGuidance(
        "Check src/index.ts and missing.ts and ../../../outside/path.ts",
        "/repo/worktree"
      );

      expect(guidance).toContain("## Workspace Context");
      expect(guidance).toContain("Repository root: /repo-root");
      expect(guidance).toContain("Current working directory: /repo/worktree");

      expect(guidance).toContain("- src/index.ts: exists");
      expect(guidance).toContain("- missing.ts: not-found");
      expect(guidance).toContain("- ../../../outside/path.ts: outside-workspace");
    });

    it("should render correctly with no hints", async () => {
      vi.mocked(extractPathHints).mockReturnValue([]);
      vi.mocked(runCommandStrict).mockResolvedValue({ ok: true, stdout: "/repo-root\n", stderr: "" });

      const guidance = await manager.buildWorkspaceGuidance("No file paths here", "/repo/worktree");
      expect(guidance).toContain("Task path hints (from prompt): none detected.");
    });
  });
});
