import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";
import { BranchReaperService, type ReaperProjectGit } from "../../../src/services/branch-reaper-service.js";

async function git(repo: string, ...args: string[]) {
  return runCommandStrict("git", args, repo);
}

async function commitFile(repo: string, file: string, contents: string, message: string) {
  await writeFile(path.join(repo, file), contents, "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", message);
}

async function branches(repo: string): Promise<string[]> {
  const out = await git(repo, "branch", "--format=%(refname:short)");
  return out.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

describe("BranchReaperService", () => {
  let repo: string;
  const gitConfig: ReaperProjectGit = { deleteMergedBranches: true, defaultBranch: "main", featureBranchPrefix: "feature/" };

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "branch-reaper-"));
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await commitFile(repo, "base.txt", "base\n", "Initial commit");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  function service(git: ReaperProjectGit) {
    return new BranchReaperService({
      listProjects: () => [{ id: "p1", baseDir: repo }],
      resolveProjectGit: () => git,
    });
  }

  it("deletes managed branches fully merged into the default branch", async () => {
    // A merged worker branch and a merged feature branch.
    await git(repo, "branch", "task/feature-x-1-abc");
    await git(repo, "branch", "feature/sprint1");
    // Both point at main's commit, so they are merged.

    const result = await service(gitConfig).reapOnStartup();

    expect(result.reapedCount).toBe(2);
    expect(await branches(repo)).toEqual(["main"]);
  });

  it("never deletes unmerged managed branches", async () => {
    await git(repo, "checkout", "-b", "task/feature-x-2-def");
    await commitFile(repo, "work.txt", "work\n", "unmerged work");
    await git(repo, "checkout", "main");

    const result = await service(gitConfig).reapOnStartup();

    expect(result.reapedCount).toBe(0);
    expect(await branches(repo)).toContain("task/feature-x-2-def");
  });

  it("leaves non-managed and default branches alone", async () => {
    await git(repo, "branch", "dev");          // user branch, merged but not managed
    await git(repo, "branch", "task/feature-y-1"); // managed, merged

    await service(gitConfig).reapOnStartup();

    const remaining = await branches(repo);
    expect(remaining).toContain("dev");
    expect(remaining).toContain("main");
    expect(remaining).not.toContain("task/feature-y-1");
  });

  it("does nothing when deleteMergedBranches is disabled", async () => {
    await git(repo, "branch", "task/feature-z-1");
    const result = await service({ ...gitConfig, deleteMergedBranches: false }).reapOnStartup();
    expect(result.reapedCount).toBe(0);
    expect(await branches(repo)).toContain("task/feature-z-1");
  });

  it("never deletes the currently checked-out managed branch", async () => {
    await git(repo, "checkout", "-b", "feature/sprint-current");
    // merged (no new commits) but checked out
    const result = await service({ ...gitConfig }).reapOnStartup();
    expect(result.reapedCount).toBe(0);
    expect(await branches(repo)).toContain("feature/sprint-current");
  });
});
