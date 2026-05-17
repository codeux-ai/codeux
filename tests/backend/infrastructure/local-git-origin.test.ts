import { describe, expect, it } from "vitest";
import { parseOriginUrlFromGitConfig } from "../../../src/infrastructure/git/local-git-origin.js";

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
});
