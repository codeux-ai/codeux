import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { prepareGitProjectCreateInput } from "../../../src/services/project-git-clone-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

async function runGit(repoPath: string, args: string[]): Promise<string> {
  return (await runCommandStrict("git", args, repoPath)).stdout;
}

describe("project git clone service", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  it("clones Git URL projects into the selected clone root before project creation", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-git-clone-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const seedPath = path.join(tempRoot, "seed");
    const cloneRoot = path.join(tempRoot, "projects");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, seedPath], tempRoot);
    await runGit(seedPath, ["config", "user.name", "Code UX Test"]);
    await runGit(seedPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(seedPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(seedPath, "README.md"), "# Test\n", "utf8");
    await runGit(seedPath, ["add", "README.md"]);
    await runGit(seedPath, ["commit", "-m", "initial"]);
    await runGit(seedPath, ["push", "-u", "origin", "main"]);
    await runGit(originPath, ["symbolic-ref", "HEAD", "refs/heads/main"]);

    const prepared = await prepareGitProjectCreateInput({
      name: "Origin",
      sourceType: "git",
      sourceRef: originPath,
      cloneDir: cloneRoot,
    });

    expect(prepared.cloneDir).toBe(cloneRoot);
    expect(await runGit(path.join(cloneRoot, "origin"), ["rev-parse", "--show-toplevel"]))
      .toBe(path.join(cloneRoot, "origin"));
    expect(await fs.readFile(path.join(cloneRoot, "origin", "README.md"), "utf8"))
      .toBe("# Test\n");
  });

  it("rejects an existing non-empty target that is not an exact Git checkout root", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-git-clone-"));
    cleanupPaths.push(tempRoot);

    const cloneRoot = path.join(tempRoot, "projects");
    const target = path.join(cloneRoot, "repo");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "notes.txt"), "not a clone\n", "utf8");

    await expect(prepareGitProjectCreateInput({
      name: "Repo",
      sourceType: "git",
      sourceRef: "https://github.com/example/repo.git",
      cloneDir: cloneRoot,
    })).rejects.toThrow("not a repository root");
  });
});
