import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ensureCodeUxGitignoreEntry } from "../../../../src/infrastructure/git/code-ux-gitignore.js";

const tempDirs: string[] = [];

async function mkTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ensureCodeUxGitignoreEntry", () => {
  it("appends the Code UX runtime entry to a repository .gitignore", async () => {
    const repoPath = await mkTempDir("code-ux-gitignore-");
    await fs.writeFile(path.join(repoPath, ".gitignore"), "dist\n", "utf8");

    await expect(ensureCodeUxGitignoreEntry(repoPath)).resolves.toBe(true);
    await expect(fs.readFile(path.join(repoPath, ".gitignore"), "utf8")).resolves.toBe("dist\n.code-ux/\n");
  });

  it("rejects a .gitignore symlink that resolves outside the repository", async () => {
    const repoPath = await mkTempDir("code-ux-gitignore-repo-");
    const outsideDir = await mkTempDir("code-ux-gitignore-outside-");
    const outsideGitignore = path.join(outsideDir, ".gitignore");
    await fs.writeFile(outsideGitignore, "secrets\n", "utf8");
    await fs.symlink(outsideGitignore, path.join(repoPath, ".gitignore"));

    await expect(ensureCodeUxGitignoreEntry(repoPath)).rejects.toThrow(".gitignore path must stay inside the repository");
    await expect(fs.readFile(outsideGitignore, "utf8")).resolves.toBe("secrets\n");
  });
});
