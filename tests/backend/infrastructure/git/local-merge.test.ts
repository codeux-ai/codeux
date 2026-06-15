import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommandStrict } from "../../../../src/services/cli-process-runner.js";
import {
  getCheckedOutRef,
  restoreCheckedOutRef,
  mergeBranchLocally,
  findRecoverableWorkerBranch,
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
    expect(result.conflict).toBe(true); // merge invocation failed
    // A failed merge still aborts cleanly, leaving no half-merged state.
    const status = (await git(repo, "status", "--porcelain")).stdout.trim();
    expect(status).toBe("");
  });

  it("returns a non-conflict error when the target branch cannot be checked out", async () => {
    const result = await mergeBranchLocally({
      repoPath: repo,
      targetBranch: "missing-target",
      sourceBranch: "feature",
      commitMessage: "Merge branch 'feature' into missing-target",
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.error).toBeTruthy();
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
});
