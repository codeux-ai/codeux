import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommandStrict } from "../../../../src/services/cli-process-runner.js";
import {
  getCheckedOutRef,
  restoreCheckedOutRef,
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
});
