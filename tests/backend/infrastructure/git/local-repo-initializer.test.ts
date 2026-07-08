import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initLocalRepo } from "../../../../src/infrastructure/git/local-repo-initializer.js";
import { runCommandStrict } from "../../../../src/services/cli-process-runner.js";

describe("initLocalRepo", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "code-ux-init-local-"));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("seeds .gitignore with Code UX runtime artifacts in the initial commit", async () => {
    await initLocalRepo(repo, "main", "Seeded Project");

    const gitignore = await readFile(path.join(repo, ".gitignore"), "utf8");
    expect(gitignore).toContain(".code-ux/\n");
    const committedFiles = (await runCommandStrict("git", ["ls-tree", "--name-only", "HEAD"], repo)).stdout;
    expect(committedFiles).toContain(".gitignore");
    expect(committedFiles).toContain("README.md");
  });
});
