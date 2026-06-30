import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateSafeRepoName = vi.fn();
const validateSafeClonePath = vi.fn((dir: string) => dir);
const validateNonEmptyDir = vi.fn();
const runCommandStrict = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
const buildGitHttpAuthEnvWithFallbacks = vi.fn(async () => ({ GIT_TOKEN: "x" }));
const mkdirSync = vi.fn();

vi.mock("../../../../src/utils/path-validator.js", () => ({
  validateSafeRepoName: (...a: unknown[]) => validateSafeRepoName(...a),
  validateSafeClonePath: (...a: unknown[]) => validateSafeClonePath(...(a as [string])),
  validateNonEmptyDir: (...a: unknown[]) => validateNonEmptyDir(...a),
}));

vi.mock("../../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: (...a: unknown[]) => runCommandStrict(...a),
}));

vi.mock("../../../../src/services/git-http-auth.js", () => ({
  buildGitHttpAuthEnvWithFallbacks: (...a: unknown[]) => buildGitHttpAuthEnvWithFallbacks(...a),
}));

vi.mock("fs", () => ({
  mkdirSync: (...a: unknown[]) => mkdirSync(...a),
}));

import { createGitHubRepo, createGitLabRepo } from "../../../../src/infrastructure/git/remote-repo-creator.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  validateSafeClonePath.mockImplementation((dir: string) => dir);
  buildGitHttpAuthEnvWithFallbacks.mockResolvedValue({ GIT_TOKEN: "x" });
});

describe("createGitHubRepo", () => {
  it("creates the repo, clones it, and returns the local path + remote url", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.github.com/user/repos");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ name: "my-repo", private: true, auto_init: true });
      return new Response(JSON.stringify({ clone_url: "https://github.com/me/my-repo.git" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createGitHubRepo({
      repoName: "my-repo",
      isPrivate: true,
      cloneParentDir: "/tmp/parent",
      hostToken: "ghp_token",
    });

    expect(result).toEqual({
      localPath: "/tmp/parent/my-repo",
      remoteUrl: "https://github.com/me/my-repo.git",
    });
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/parent", { recursive: true });
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["clone", "https://github.com/me/my-repo.git", "my-repo"],
      "/tmp/parent",
      { GIT_TOKEN: "x" },
    );
  });

  it("rejects when no host token is provided", async () => {
    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "  " }),
    ).rejects.toThrow(/GitHub token is required/);
  });

  it("surfaces the GitHub API message on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "name already exists" }), { status: 422 })),
    );

    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "t" }),
    ).rejects.toThrow(/name already exists/);
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 500 })),
    );

    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "t" }),
    ).rejects.toThrow(/upstream down/);
  });

  it("throws when the response lacks a clone_url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 })),
    );

    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "t" }),
    ).rejects.toThrow(/did not include clone_url/);
  });

  it("wraps validation failures with the failure prefix", async () => {
    validateSafeRepoName.mockImplementationOnce(() => {
      throw new Error("bad repo name");
    });

    await expect(
      createGitHubRepo({ repoName: "../evil", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "t" }),
    ).rejects.toThrow(/Failed to create GitHub repository: bad repo name/);
  });
});

describe("createGitLabRepo", () => {
  it("creates the project with the readme + optional default branch and clones it", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gitlab.com/api/v4/projects");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        name: "proj",
        path: "proj",
        visibility: "private",
        initialize_with_readme: true,
        default_branch: "trunk",
      });
      return new Response(JSON.stringify({ http_url_to_repo: "https://gitlab.com/me/proj.git" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createGitLabRepo({
      repoName: "proj",
      isPrivate: true,
      cloneParentDir: "/tmp/parent",
      hostToken: "glpat",
      defaultBranch: " trunk ",
    });

    expect(result.remoteUrl).toBe("https://gitlab.com/me/proj.git");
    expect(result.localPath).toBe("/tmp/parent/proj");
  });

  it("omits default_branch when not provided and defaults to public visibility", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.visibility).toBe("public");
      expect(body).not.toHaveProperty("default_branch");
      return new Response(JSON.stringify({ http_url_to_repo: "https://gitlab.com/me/proj.git" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createGitLabRepo({ repoName: "proj", isPrivate: false, cloneParentDir: "/tmp/parent", hostToken: "glpat" }),
    ).resolves.toMatchObject({ remoteUrl: "https://gitlab.com/me/proj.git" });
  });

  it("requires a host token", async () => {
    await expect(
      createGitLabRepo({ repoName: "proj", isPrivate: false, cloneParentDir: "/tmp/p" }),
    ).rejects.toThrow(/GitLab token is required/);
  });

  it("surfaces GitLab API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "limit reached" }), { status: 400 })),
    );

    await expect(
      createGitLabRepo({ repoName: "proj", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "t" }),
    ).rejects.toThrow(/limit reached/);
  });

  it("throws when the response lacks http_url_to_repo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: 7 }), { status: 201 })),
    );

    await expect(
      createGitLabRepo({ repoName: "proj", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "t" }),
    ).rejects.toThrow(/did not include http_url_to_repo/);
  });
});
