import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommandStrict } from "../../../../src/services/cli-process-runner.js";
import {
  getCheckedOutRef,
  restoreCheckedOutRef,
  preserveDirtyCheckout,
  restorePreservedDirtyCheckout,
  createTemporaryWorktreeBranchMerger,
  mergeBranchLocally,
  mergeBranchLocallyInTemporaryWorktree,
  findRecoverableWorkerBranch,
  workerBranchHasMergeWork,
  deleteBranchLocally,
} from "../../../../src/infrastructure/git/local-merge.js";

async function git(repo: string, ...args: string[]) {
  return runCommandStrict("git", args, repo);
}

async function commitFile(repo: string, file: string, contents: string, message: string) {
  await writeFile(path.join(repo, file), contents, "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", message);
}

describe("local-merge helpers", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "local-merge-"));
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await commitFile(repo, "base.txt", "base\n", "Initial commit");
    await git(repo, "branch", "feature");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function currentBranch(): Promise<string> {
    return (await git(repo, "symbolic-ref", "--short", "HEAD")).stdout.trim();
  }

  it("merges a worker branch into the target and records a --no-ff merge commit", async () => {
    await git(repo, "checkout", "feature");
    await git(repo, "checkout", "-b", "worker");
    await commitFile(repo, "work.txt", "work\n", "feat: work");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    // feature now contains the worker file...
    const log = (await git(repo, "log", "feature", "--oneline")).stdout;
    expect(log).toContain("Merge branch 'worker' into feature");
    const files = (await git(repo, "ls-tree", "--name-only", "feature")).stdout;
    expect(files).toContain("work.txt");
  });

  it("merges a sprint feature branch into a local-only default branch without a remote", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "feature.txt", "feature\n", "feat: sprint work");
    await git(repo, "checkout", "feature");

    const original = await getCheckedOutRef(repo);
    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });
    await restoreCheckedOutRef(repo, original);

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    const files = (await git(repo, "ls-tree", "--name-only", "main")).stdout;
    expect(files).toContain("feature.txt");
    expect(await currentBranch()).toBe("feature");
  });

  it("updates a checked-out target branch through a temporary worktree merge", async () => {
    await git(repo, "checkout", "main");
    await git(repo, "checkout", "-b", "feature-work", "feature");
    await commitFile(repo, "work.txt", "work\n", "feat: work");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature-work",
      commitMessage: "Merge branch 'feature-work' into main",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect(await currentBranch()).toBe("main");
    const files = (await git(repo, "ls-tree", "--name-only", "main")).stdout;
    expect(files).toContain("work.txt");
  });

  it("reuses one temporary worktree for a batch of clean worker merges", async () => {
    await git(repo, "checkout", "feature");
    await git(repo, "checkout", "-b", "worker-one");
    await commitFile(repo, "one.txt", "one\n", "feat: one");
    await git(repo, "checkout", "feature");
    await git(repo, "checkout", "-b", "worker-two");
    await commitFile(repo, "two.txt", "two\n", "feat: two");
    await git(repo, "checkout", "main");

    const runner = vi.fn((command: string, args: string[], cwd: string) => runCommandStrict(command, args, cwd));
    const merger = createTemporaryWorktreeBranchMerger({
      repoPath: repo,
      targetBranch: "feature",
      runner,
    });
    try {
      await expect(merger.merge("worker-one", "Merge branch 'worker-one' into feature")).resolves.toMatchObject({ ok: true });
      await expect(merger.merge("worker-two", "Merge branch 'worker-two' into feature")).resolves.toMatchObject({ ok: true });
    } finally {
      await merger.close();
    }

    const files = (await git(repo, "ls-tree", "--name-only", "feature")).stdout;
    expect(files).toContain("one.txt");
    expect(files).toContain("two.txt");
    expect(runner.mock.calls.filter(([, args]) => args[0] === "worktree" && args[1] === "add")).toHaveLength(1);
    expect(runner.mock.calls.filter(([, args]) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(1);
  });

  it("retries a temporary merge when the target ref advances during publication", async () => {
    const featureBase = (await git(repo, "rev-parse", "feature")).stdout.trim();
    await git(repo, "checkout", "-b", "worker", "feature");
    await commitFile(repo, "worker.txt", "worker\n", "feat: worker output");
    await git(repo, "checkout", "-b", "concurrent-fix", "feature");
    await commitFile(repo, "ci-fix.txt", "ci fix\n", "fix: concurrent CI repair");
    const concurrentTip = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
    await git(repo, "checkout", "main");

    let injectedConcurrentUpdate = false;
    const runner = vi.fn(async (command: string, args: string[], cwd: string) => {
      if (
        command === "git"
        && args[0] === "update-ref"
        && args[1] === "refs/heads/feature"
        && args.length === 4
        && !injectedConcurrentUpdate
      ) {
        injectedConcurrentUpdate = true;
        await runCommandStrict(
          "git",
          ["update-ref", "refs/heads/feature", concurrentTip, featureBase],
          repo,
        );
      }
      return await runCommandStrict(command, args, cwd);
    });

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
      runner,
    });

    expect(result).toMatchObject({ ok: true, conflict: false });
    expect(runner.mock.calls.filter(([, args]) => args[0] === "update-ref" && args[1] === "refs/heads/feature"))
      .toHaveLength(2);
    expect(await git(repo, "merge-base", "--is-ancestor", concurrentTip, "feature")).toMatchObject({ code: 0 });
    expect(await git(repo, "show", "feature:ci-fix.txt")).toMatchObject({ stdout: "ci fix" });
    expect(await git(repo, "show", "feature:worker.txt")).toMatchObject({ stdout: "worker" });
  });

  it("runs temporary local merges through containerized git when enabled", async () => {
    const previousContainerizedGit = process.env.CODE_UX_CONTAINERIZED_GIT;
    const previousGitContainerMode = process.env.CODE_UX_GIT_CONTAINER_MODE;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    delete process.env.CODE_UX_GIT_CONTAINER_MODE;

    try {
      await git(repo, "checkout", "feature");
      await git(repo, "checkout", "-b", "worker");
      await commitFile(repo, "host-worktree.txt", "work\n", "feat: host worktree merge");
      await git(repo, "checkout", "feature");

      const result = await mergeBranchLocallyInTemporaryWorktree({
        repoPath: repo,
        targetBranch: "feature",
        sourceBranch: "worker",
        commitMessage: "Merge branch 'worker' into feature",
      });

      expect(result.ok).toBe(true);
      expect(result.conflict).toBe(false);
      const files = (await git(repo, "ls-tree", "--name-only", "feature")).stdout;
      expect(files).toContain("host-worktree.txt");
    } finally {
      if (previousContainerizedGit === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previousContainerizedGit;
      }
      if (previousGitContainerMode === undefined) {
        delete process.env.CODE_UX_GIT_CONTAINER_MODE;
      } else {
        process.env.CODE_UX_GIT_CONTAINER_MODE = previousGitContainerMode;
      }
    }
  });

  it("normalizes containerized temporary worktree gitdir metadata before follow-up git commands", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "local-merge-containerized-metadata-"));
    try {
      await mkdir(path.join(repoRoot, ".git", "worktrees"), { recursive: true });
      let worktreePath = "";

      const runner = vi.fn(async (_command: string, args: string[], cwd: string) => {
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          return { ok: true, code: 0, stdout: "source-sha\n", stderr: "", durationMs: 1 };
        }
        if (args[0] === "symbolic-ref") {
          return { ok: true, code: 0, stdout: "main\n", stderr: "", durationMs: 1 };
        }
        if (args[0] === "show-ref") {
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (args[0] === "worktree" && args[1] === "add") {
          worktreePath = args[3];
          const gitDirName = path.basename(worktreePath);
          await mkdir(worktreePath, { recursive: true });
          await mkdir(path.join(repoRoot, ".git", "worktrees", gitDirName), { recursive: true });
          await writeFile(path.join(worktreePath, ".git"), `gitdir: /workspace/.git/worktrees/${gitDirName}\n`, "utf8");
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (args.includes("merge")) {
          const dotGit = await readFile(path.join(cwd, ".git"), "utf8");
          expect(dotGit).not.toContain("/workspace/");
          expect(dotGit).toContain("../../.git/worktrees/");
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (args[0] === "update-ref" || args[0] === "reset" || (args[0] === "worktree" && ["remove", "prune"].includes(args[1]))) {
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        throw new Error(`Unexpected git command in ${cwd}: ${args.join(" ")}`);
      });

      const result = await mergeBranchLocallyInTemporaryWorktree({
        repoPath: repoRoot,
        targetBranch: "main",
        sourceBranch: "worker",
        commitMessage: "Merge branch 'worker' into main",
        runner,
      });

      expect(result.error).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(worktreePath).toContain("code-ux-local-merge-");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("leaves usable host worktree gitdir metadata unchanged", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "local-merge-host-metadata-"));
    try {
      await mkdir(path.join(repoRoot, ".git", "worktrees"), { recursive: true });
      let worktreePath = "";
      let hostGitDir = "";

      const runner = vi.fn(async (_command: string, args: string[], cwd: string) => {
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          return { ok: true, code: 0, stdout: "source-sha\n", stderr: "", durationMs: 1 };
        }
        if (args[0] === "symbolic-ref") {
          return { ok: true, code: 0, stdout: "main\n", stderr: "", durationMs: 1 };
        }
        if (args[0] === "show-ref") {
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (args[0] === "worktree" && args[1] === "add") {
          worktreePath = args[3];
          const gitDirName = path.basename(worktreePath);
          hostGitDir = path.join(repoRoot, ".git", "worktrees", gitDirName);
          await mkdir(worktreePath, { recursive: true });
          await mkdir(hostGitDir, { recursive: true });
          await writeFile(path.join(worktreePath, ".git"), `gitdir: ${hostGitDir}\n`, "utf8");
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (args.includes("merge")) {
          const dotGit = await readFile(path.join(cwd, ".git"), "utf8");
          expect(dotGit).toBe(`gitdir: ${hostGitDir}\n`);
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (args[0] === "update-ref" || args[0] === "reset" || (args[0] === "worktree" && ["remove", "prune"].includes(args[1]))) {
          return { ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        throw new Error(`Unexpected git command in ${cwd}: ${args.join(" ")}`);
      });

      const result = await mergeBranchLocallyInTemporaryWorktree({
        repoPath: repoRoot,
        targetBranch: "main",
        sourceBranch: "worker",
        commitMessage: "Merge branch 'worker' into main",
        runner,
      });

      expect(result.error).toBeUndefined();
      expect(result.ok).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates a missing unborn local default branch from the source branch", async () => {
    const unbornRepo = await mkdtemp(path.join(tmpdir(), "local-merge-unborn-"));
    try {
      await git(unbornRepo, "init", "-b", "main");
      await git(unbornRepo, "config", "user.email", "test@example.com");
      await git(unbornRepo, "config", "user.name", "Test");
      await git(unbornRepo, "checkout", "--orphan", "feature");
      await commitFile(unbornRepo, "first.txt", "first\n", "feat: first local work");

      const result = await mergeBranchLocally({
        repoPath: unbornRepo,
        targetBranch: "main",
        sourceBranch: "feature",
        commitMessage: "Merge branch 'feature' into main",
      });

      expect(result.ok).toBe(true);
      expect(result.conflict).toBe(false);
      const mainHead = (await git(unbornRepo, "rev-parse", "main")).stdout.trim();
      const featureHead = (await git(unbornRepo, "rev-parse", "feature")).stdout.trim();
      expect(mainHead).toBe(featureHead);
    } finally {
      await rm(unbornRepo, { recursive: true, force: true });
    }
  });

  it("treats already-merged source branches as a successful no-op", async () => {
    const mainBefore = (await git(repo, "rev-parse", "main")).stdout.trim();

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    const mainAfter = (await git(repo, "rev-parse", "main")).stdout.trim();
    expect(mainAfter).toBe(mainBefore);
  });

  it("restores the originally checked-out branch after a merge", async () => {
    await git(repo, "checkout", "feature");
    await git(repo, "checkout", "-b", "worker");
    await commitFile(repo, "work.txt", "work\n", "feat: work");
    await git(repo, "checkout", "main");

    const original = await getCheckedOutRef(repo);
    expect(original).toEqual({ ref: "main", detached: false });

    await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
    });
    // mergeBranchLocally itself leaves HEAD on the target branch...
    expect(await currentBranch()).toBe("feature");

    await restoreCheckedOutRef(repo, original);
    expect(await currentBranch()).toBe("main");
  });

  it("reports a conflict and aborts cleanly, leaving the target branch unchanged", async () => {
    // Both branches edit base.txt divergently to force a conflict.
    await git(repo, "checkout", "feature");
    await commitFile(repo, "base.txt", "feature change\n", "feat: feature edit");
    const featureHeadBefore = (await git(repo, "rev-parse", "feature")).stdout.trim();

    await git(repo, "checkout", "main");
    await git(repo, "checkout", "-b", "worker");
    await commitFile(repo, "base.txt", "worker change\n", "feat: worker edit");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    // The aborted merge must not advance or dirty the feature branch.
    const featureHeadAfter = (await git(repo, "rev-parse", "feature")).stdout.trim();
    expect(featureHeadAfter).toBe(featureHeadBefore);
    const status = (await git(repo, "status", "--porcelain")).stdout.trim();
    expect(status).toBe("");
  });

  it("auto-resolves Code UX runtime-only conflicts to the target side while merging task code", async () => {
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await commitFile(repo, ".code-ux/runtime.log", "base\n", "chore: track runtime artifact");

    await git(repo, "checkout", "feature");
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await commitFile(repo, ".code-ux/runtime.log", "feature runtime\n", "chore: feature runtime artifact");
    const featureHeadBefore = (await git(repo, "rev-parse", "feature")).stdout.trim();

    await git(repo, "checkout", "main");
    await git(repo, "checkout", "-b", "worker");
    await writeFile(path.join(repo, ".code-ux", "runtime.log"), "worker runtime\n", "utf8");
    await writeFile(path.join(repo, "work.txt"), "work\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "feat: worker code and runtime artifact");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect((await git(repo, "rev-parse", "feature")).stdout.trim()).not.toBe(featureHeadBefore);
    expect((await git(repo, "show", "feature:work.txt")).stdout).toBe("work");
    expect((await git(repo, "show", "feature:.code-ux/runtime.log")).stdout).toBe("feature runtime");
    expect((await git(repo, "status", "--porcelain")).stdout.trim()).toBe("");
  });

  it("still reports real conflicts when Code UX runtime files are not the only conflict", async () => {
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await commitFile(repo, ".code-ux/runtime.log", "base\n", "chore: track runtime artifact");

    await git(repo, "checkout", "feature");
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await writeFile(path.join(repo, ".code-ux", "runtime.log"), "feature runtime\n", "utf8");
    await writeFile(path.join(repo, "base.txt"), "feature change\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "feat: feature changes");
    const featureHeadBefore = (await git(repo, "rev-parse", "feature")).stdout.trim();

    await git(repo, "checkout", "main");
    await git(repo, "checkout", "-b", "worker");
    await writeFile(path.join(repo, ".code-ux", "runtime.log"), "worker runtime\n", "utf8");
    await writeFile(path.join(repo, "base.txt"), "worker change\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "feat: worker changes");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect((await git(repo, "rev-parse", "feature")).stdout.trim()).toBe(featureHeadBefore);
    expect((await git(repo, "status", "--porcelain")).stdout.trim()).toBe("");
  });

  it("flags a non-conflict setup failure (missing source branch) without claiming a conflict", async () => {
    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "does-not-exist",
      commitMessage: "Merge branch 'does-not-exist' into feature",
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.error).toContain("does-not-exist");
    // A failed merge still aborts cleanly, leaving no half-merged state.
    const status = (await git(repo, "status", "--porcelain")).stdout.trim();
    expect(status).toBe("");
  });

  it("returns a non-conflict error when the target branch cannot be checked out", async () => {
    const runner = vi.fn(async (_command: string, args: string[], _cwd: string) => {
      if (args[0] === "rev-parse") {
        return { ok: true, code: 0, stdout: "abc123\n", stderr: "" };
      }
      if (args[0] === "show-ref") {
        return { ok: true, code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "checkout") {
        throw new Error("checkout failed");
      }
      return { ok: true, code: 0, stdout: "", stderr: "" };
    });

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into missing-target",
      runner,
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.error).toContain("checkout failed");
  });

  it("merges in a temporary worktree without changing a dirty visible checkout", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "feature.txt", "feature\n", "feat: sprint work");
    await git(repo, "checkout", "-b", "operator/topic", "main");
    await writeFile(path.join(repo, "local-note.txt"), "uncommitted\n", "utf8");

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect(await currentBranch()).toBe("operator/topic");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? local-note.txt");
    const files = (await git(repo, "ls-tree", "--name-only", "main")).stdout;
    expect(files).toContain("feature.txt");
  });

  it("merges in a temporary worktree when untracked Code UX files would block checkout", async () => {
    await git(repo, "checkout", "feature");
    await mkdir(path.join(repo, ".code-ux", "agents"), { recursive: true });
    await commitFile(repo, ".code-ux/agents/worker.md", "tracked runtime template\n", "chore: track runtime template");
    await git(repo, "checkout", "-b", "worker", "feature");
    await commitFile(repo, "work.txt", "work\n", "feat: worker change");

    await git(repo, "checkout", "main");
    await mkdir(path.join(repo, ".code-ux", "agents"), { recursive: true });
    await writeFile(path.join(repo, ".code-ux", "agents", "worker.md"), "local runtime template\n", "utf8");

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "feature",
      sourceBranch: "worker",
      commitMessage: "Merge branch 'worker' into feature",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect(await currentBranch()).toBe("main");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? .code-ux/");
    expect((await git(repo, "show", "feature:work.txt")).stdout).toBe("work");
  });

  it("auto-resolves Code UX runtime-only conflicts in temporary worktree merges", async () => {
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await commitFile(repo, ".code-ux/runtime.log", "base\n", "chore: track runtime artifact");

    await git(repo, "checkout", "main");
    await writeFile(path.join(repo, ".code-ux", "runtime.log"), "main runtime\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "chore: main runtime artifact");

    await git(repo, "checkout", "feature");
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await writeFile(path.join(repo, ".code-ux", "runtime.log"), "feature runtime\n", "utf8");
    await writeFile(path.join(repo, "feature.txt"), "feature\n", "utf8");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "feat: feature work and runtime artifact");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect(await currentBranch()).toBe("main");
    expect((await git(repo, "show", "main:feature.txt")).stdout).toBe("feature");
    expect((await git(repo, "show", "main:.code-ux/runtime.log")).stdout).toBe("main runtime");
    expect((await git(repo, "status", "--porcelain")).stdout.trim()).toBe("");
  });

  it("reports temporary-worktree merge conflicts without dirtying the visible checkout", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "base.txt", "feature change\n", "feat: feature edit");
    const mainBefore = (await git(repo, "rev-parse", "main")).stdout.trim();

    await git(repo, "checkout", "main");
    await commitFile(repo, "base.txt", "main change\n", "feat: main edit");
    const mainAfterDivergence = (await git(repo, "rev-parse", "main")).stdout.trim();
    await git(repo, "checkout", "-b", "operator/topic");
    await writeFile(path.join(repo, "local-note.txt"), "operator draft\n", "utf8");

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect((await git(repo, "rev-parse", "main")).stdout.trim()).not.toBe(mainBefore);
    expect((await git(repo, "rev-parse", "main")).stdout.trim()).toBe(mainAfterDivergence);
    expect(await currentBranch()).toBe("operator/topic");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? local-note.txt");
  });

  it("preserves a dirty checkout on a backup branch and restores it uncommitted after the clean sprint merge", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "feature.txt", "feature\n", "feat: sprint work");
    await git(repo, "checkout", "main");
    await writeFile(path.join(repo, "dirty-note.txt"), "dirty work\n", "utf8");

    const preserved = await preserveDirtyCheckout(repo);
    expect(preserved).not.toBeNull();
    expect(preserved?.dirtyRefBranch).toMatch(/^dirty-ref-[0-9a-f-]+$/);
    expect(await currentBranch()).toBe("main");
    expect((await git(repo, "status", "--porcelain")).stdout.trim()).toBe("");

    const cleanMerge = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });
    expect(cleanMerge.ok).toBe(true);
    expect(cleanMerge.conflict).toBe(false);

    const dirtyRestore = await restorePreservedDirtyCheckout(repo, preserved!.dirtyRefBranch);
    expect(dirtyRestore.ok).toBe(true);
    expect(dirtyRestore.conflict).toBe(false);

    const files = (await git(repo, "ls-tree", "--name-only", "main")).stdout;
    expect(files).toContain("feature.txt");
    expect(files).not.toContain("dirty-note.txt");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? dirty-note.txt");
  });

  it("keeps the dirty branch and cleans the checkout when restored dirty work conflicts", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "shared.txt", "feature\n", "feat: sprint shared edit");
    await git(repo, "checkout", "main");
    await writeFile(path.join(repo, "shared.txt"), "dirty work\n", "utf8");

    const preserved = await preserveDirtyCheckout(repo);
    expect(preserved).not.toBeNull();
    expect((await git(repo, "status", "--porcelain")).stdout.trim()).toBe("");

    const cleanMerge = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "main",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into main",
    });
    expect(cleanMerge.ok).toBe(true);

    const dirtyRestore = await restorePreservedDirtyCheckout(repo, preserved!.dirtyRefBranch);
    expect(dirtyRestore.ok).toBe(false);
    expect(dirtyRestore.conflict).toBe(true);
    expect(dirtyRestore.dirtyRefBranch).toBe(preserved!.dirtyRefBranch);
    expect(dirtyRestore.restoredPaths).toContain("shared.txt");
    expect((await git(repo, "status", "--porcelain")).stdout.trim()).toBe("");
    expect((await git(repo, "show", `${preserved!.dirtyRefBranch}:shared.txt`)).stdout.trim()).toBe("dirty work");
    expect((await git(repo, "show", "main:shared.txt")).stdout.trim()).toBe("feature");
  });

  it("ignores dirty Code UX runtime files when deciding whether to preserve a checkout", async () => {
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await writeFile(path.join(repo, ".code-ux", "session.json"), "{}\n", "utf8");

    const preserved = await preserveDirtyCheckout(repo);

    expect(preserved).toBeNull();
    expect(await currentBranch()).toBe("main");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? .code-ux/");
  });

  it("preserves user dirty files without committing Code UX runtime files", async () => {
    await mkdir(path.join(repo, ".code-ux"), { recursive: true });
    await writeFile(path.join(repo, ".code-ux", "session.json"), "{}\n", "utf8");
    await writeFile(path.join(repo, "dirty-note.txt"), "dirty work\n", "utf8");

    const preserved = await preserveDirtyCheckout(repo);

    expect(preserved).not.toBeNull();
    const files = (await git(repo, "ls-tree", "--name-only", preserved!.dirtyRefBranch)).stdout;
    expect(files).toContain("dirty-note.txt");
    expect(files).not.toContain(".code-ux");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? .code-ux/");
  });

  it("preserves dirty user work with a Code UX git identity when repo identity is unset", async () => {
    await git(repo, "config", "--unset", "user.email");
    await git(repo, "config", "--unset", "user.name");
    await writeFile(path.join(repo, "dirty-note.txt"), "dirty work\n", "utf8");

    const preserved = await preserveDirtyCheckout(repo);

    expect(preserved).not.toBeNull();
    const author = (await git(repo, "log", "-1", "--format=%an <%ae>", preserved!.dirtyRefBranch)).stdout.trim();
    expect(author).toBe("Code UX <agents@codeux.ai>");
  });

  it("creates a missing temporary-worktree target from a fallback branch before merging", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "feature.txt", "feature\n", "feat: sprint work");
    await git(repo, "checkout", "-b", "operator/topic", "main");
    await writeFile(path.join(repo, "local-note.txt"), "operator draft\n", "utf8");

    const result = await mergeBranchLocallyInTemporaryWorktree({
      repoPath: repo,
      targetBranch: "dev",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into dev",
      fallbackTargetBranches: ["main"],
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect(await currentBranch()).toBe("operator/topic");
    expect((await git(repo, "status", "--porcelain")).stdout).toContain("?? local-note.txt");
    expect((await git(repo, "rev-parse", "--verify", "dev")).stdout.trim()).toBeTruthy();
    const files = (await git(repo, "ls-tree", "--name-only", "dev")).stdout;
    expect(files).toContain("base.txt");
    expect(files).toContain("feature.txt");
  });

  it("creates a missing configured target branch from a fallback branch before merging", async () => {
    await git(repo, "checkout", "feature");
    await commitFile(repo, "work.txt", "work\n", "feat: work");
    await git(repo, "checkout", "main");

    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "dev",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into dev",
      fallbackTargetBranches: ["main"],
    });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    expect((await git(repo, "rev-parse", "--verify", "dev")).stdout.trim()).toBeTruthy();
    expect((await git(repo, "ls-tree", "--name-only", "dev")).stdout).toContain("work.txt");
  });
});

describe("findRecoverableWorkerBranch", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "recover-wb-"));
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await commitFile(repo, "base.txt", "base\n", "Initial commit");
    await git(repo, "branch", "feature");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const prefix = "task/feature-t01-qwen-code-";

  async function makeWorkerBranch(name: string, withCommit: boolean) {
    await git(repo, "branch", name, "feature");
    if (withCommit) {
      await git(repo, "checkout", name);
      await commitFile(repo, `${name.split("-").pop()}.md`, "work\n", "feat: work");
      await git(repo, "checkout", "main");
    }
  }

  it("recovers the worker branch with commits ahead of the feature branch", async () => {
    await makeWorkerBranch(`${prefix}aaaa`, true);

    const found = await findRecoverableWorkerBranch({
      repoPath: repo,
      featureBranch: "feature",
      branchPrefix: prefix,
    });

    expect(found).toBe(`${prefix}aaaa`);
  });

  it("ignores a matching branch that has no commits ahead of the feature branch", async () => {
    await makeWorkerBranch(`${prefix}empty`, false);

    const found = await findRecoverableWorkerBranch({
      repoPath: repo,
      featureBranch: "feature",
      branchPrefix: prefix,
    });

    expect(found).toBeNull();
  });

  it("returns null when no branch matches the prefix", async () => {
    await makeWorkerBranch("task/feature-t02-qwen-code-zzzz", true);

    const found = await findRecoverableWorkerBranch({
      repoPath: repo,
      featureBranch: "feature",
      branchPrefix: prefix,
    });

    expect(found).toBeNull();
  });

  it("prefers the most recently committed matching branch", async () => {
    await makeWorkerBranch(`${prefix}old`, true);
    // A second attempt's branch, committed later, should win.
    await git(repo, "branch", `${prefix}new`, "feature");
    await git(repo, "checkout", `${prefix}new`);
    await commitFile(repo, "newer.md", "newer\n", "feat: newer work");
    await git(repo, "checkout", "main");

    const found = await findRecoverableWorkerBranch({
      repoPath: repo,
      featureBranch: "feature",
      branchPrefix: prefix,
    });

    expect(found).toBe(`${prefix}new`);
  });

  describe("deleteBranchLocally", () => {
    it("deletes an existing branch", async () => {
      await git(repo, "branch", "throwaway");
      const deleted = await deleteBranchLocally({ repoPath: repo, branch: "throwaway" });
      expect(deleted).toBe(true);
      const list = (await git(repo, "branch", "--format=%(refname:short)")).stdout;
      expect(list).not.toContain("throwaway");
    });

    it("refuses to delete the currently checked-out branch", async () => {
      const current = (await git(repo, "symbolic-ref", "--short", "HEAD")).stdout.trim();
      const deleted = await deleteBranchLocally({ repoPath: repo, branch: current });
      expect(deleted).toBe(false);
      const list = (await git(repo, "branch", "--format=%(refname:short)")).stdout;
      expect(list).toContain(current);
    });

    it("returns false for a non-existent branch without throwing", async () => {
      const deleted = await deleteBranchLocally({ repoPath: repo, branch: "does-not-exist" });
      expect(deleted).toBe(false);
    });
  });
});

describe("workerBranchHasMergeWork", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "worker-merge-work-"));
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await commitFile(repo, "base.txt", "base\n", "Initial commit");
    await git(repo, "branch", "feature");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns false when the recorded worker branch is missing", async () => {
    await expect(workerBranchHasMergeWork({
      repoPath: repo,
      featureBranch: "feature",
      workerBranch: "task/missing",
    })).resolves.toBe(false);
  });

  it("returns false when the worker branch exists but has no commits ahead", async () => {
    await git(repo, "branch", "task/noop", "feature");

    await expect(workerBranchHasMergeWork({
      repoPath: repo,
      featureBranch: "feature",
      workerBranch: "task/noop",
    })).resolves.toBe(false);
  });

  it("returns true when the worker branch has commits ahead of the feature branch", async () => {
    await git(repo, "checkout", "-b", "task/real-work", "feature");
    await commitFile(repo, "work.txt", "work\n", "feat: work");
    await git(repo, "checkout", "main");

    await expect(workerBranchHasMergeWork({
      repoPath: repo,
      featureBranch: "feature",
      workerBranch: "task/real-work",
    })).resolves.toBe(true);
  });

  it("compares resolved commit SHAs instead of full refs so Windows does not parse the range as a path", async () => {
    const revListRanges: string[] = [];
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "show-ref") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        const ref = args[2] || "";
        if (ref.includes("task/real-work")) {
          return { code: 0, stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", stderr: "" };
        }
        if (ref.includes("feature")) {
          return { code: 0, stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", stderr: "" };
        }
      }
      if (args[0] === "rev-list") {
        revListRanges.push(args[2] || "");
        if ((args[2] || "").includes("refs/heads/")) {
          throw new Error("fatal: failed to stat ref range as a Windows path");
        }
        return { code: 0, stdout: "1\n", stderr: "" };
      }
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    });

    await expect(workerBranchHasMergeWork({
      repoPath: repo,
      featureBranch: "feature",
      workerBranch: "task/real-work",
      runner,
    })).resolves.toBe(true);

    expect(revListRanges).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
  });
});
