import { describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { parseOriginUrlFromGitConfig, readLocalGitOriginUrl } from "../../../src/infrastructure/git/local-git-origin.js";

describe("local git origin", () => {
  it("parses the origin URL from git config", () => {
    expect(parseOriginUrlFromGitConfig(`
[core]
  repositoryformatversion = 0
[remote "upstream"]
  url = https://github.com/example/upstream.git
[remote "origin"]
  url = git@github.com:acme/widgets.git
  fetch = +refs/heads/*:refs/remotes/origin/*
`)).toBe("git@github.com:acme/widgets.git");
  });

  it("reads origin from a local fixture without invoking Git or remote services", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-git-origin-"));
    const gitDir = path.join(fixtureRoot, ".git");

    try {
      await fs.mkdir(gitDir);
      await fs.writeFile(path.join(gitDir, "config"), `
[core]
  repositoryformatversion = 0
[remote "origin"]
  url = https://github.com/example/local-fixture.git
`, "utf8");

      expect(readLocalGitOriginUrl(fixtureRoot)).toBe("https://github.com/example/local-fixture.git");
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
