import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createRepositoryGitTempDirectory } from "../../../../src/infrastructure/git/repository-git-temp.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("createRepositoryGitTempDirectory", () => {
  it("keeps transient files under the repository Git directory", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-git-temp-"));
    roots.push(repoPath);
    await fs.mkdir(path.join(repoPath, ".git"));

    const tempDirectory = await createRepositoryGitTempDirectory(repoPath, "archive-");

    expect(tempDirectory).toMatch(new RegExp(`${escapeRegExp(path.join(repoPath, ".git", "code-ux-runtime", "archive-"))}`));
  });

  it("uses the shared common directory for linked worktrees", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-linked-git-temp-"));
    roots.push(root);
    const repoPath = path.join(root, "worktree");
    const gitDirectory = path.join(root, "main", ".git", "worktrees", "qa");
    const commonDirectory = path.join(root, "main", ".git");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(gitDirectory, { recursive: true });
    await fs.writeFile(path.join(repoPath, ".git"), `gitdir: ${gitDirectory}\n`, "utf8");
    await fs.writeFile(path.join(gitDirectory, "commondir"), "../..\n", "utf8");

    const tempDirectory = await createRepositoryGitTempDirectory(repoPath, "patch-");

    expect(tempDirectory?.startsWith(path.join(commonDirectory, "code-ux-runtime", "patch-"))).toBe(true);
  });

  it("returns null outside a Git checkout", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-no-git-temp-"));
    roots.push(directory);

    await expect(createRepositoryGitTempDirectory(directory, "archive-")).resolves.toBeNull();
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
