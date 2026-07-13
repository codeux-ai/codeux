import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateSafeRepoName = vi.fn((name: string) => name);
const validateSafeClonePath = vi.fn((dir: string) => dir);
const validateNonEmptyDir = vi.fn((dir: string) => dir);
const runCommandStrict = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
const buildGitHttpAuthEnvWithFallbacks = vi.fn(async () => ({ GIT_TOKEN: "x" }));
const resolveGitHostTokenWithFallbacks = vi.fn(async (_provider: string, token?: string | null) => token?.trim() || null);
const mkdirSync = vi.fn();
const openSync = vi.fn(() => 17);
const writeFileSync = vi.fn();
const closeSync = vi.fn();
const ensureCodeUxGitignoreEntry = vi.fn(async () => true);
const fsConstants = {
  O_CREAT: 0x40,
  O_TRUNC: 0x200,
  O_WRONLY: 0x1,
  O_NOFOLLOW: 0x20000,
};

vi.mock("../../../../src/utils/path-validator.js", () => ({
  isPathInside: () => true,
  validateSafeRepoName: (...a: unknown[]) => validateSafeRepoName(...a),
  validateSafeClonePath: (...a: unknown[]) => validateSafeClonePath(...(a as [string])),
  validateNonEmptyDir: (...a: unknown[]) => validateNonEmptyDir(...a),
}));

vi.mock("../../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: (...a: unknown[]) => runCommandStrict(...a),
}));

vi.mock("../../../../src/services/git-http-auth.js", () => ({
  buildGitHttpAuthEnvWithFallbacks: (...a: unknown[]) => buildGitHttpAuthEnvWithFallbacks(...a),
  resolveGitHostTokenWithFallbacks: (...a: unknown[]) => resolveGitHostTokenWithFallbacks(...(a as [string, string?])),
}));

vi.mock("fs", () => ({
  constants: {
    O_CREAT: 0x40,
    O_TRUNC: 0x200,
    O_WRONLY: 0x1,
    O_NOFOLLOW: 0x20000,
  },
  mkdirSync: (...a: unknown[]) => mkdirSync(...a),
  openSync: (...a: unknown[]) => openSync(...a),
  writeFileSync: (...a: unknown[]) => writeFileSync(...a),
  closeSync: (...a: unknown[]) => closeSync(...a),
}));

vi.mock("../../../../src/infrastructure/git/code-ux-gitignore.js", () => ({
  ensureCodeUxGitignoreEntry: (...a: unknown[]) => ensureCodeUxGitignoreEntry(...a),
}));

import { createGitHubRepo, createGitLabRepo } from "../../../../src/infrastructure/git/remote-repo-creator.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  validateSafeRepoName.mockImplementation((name: string) => name);
  validateSafeClonePath.mockImplementation((dir: string) => dir);
  validateNonEmptyDir.mockImplementation((dir: string) => dir);
  openSync.mockImplementation(() => 17);
  buildGitHttpAuthEnvWithFallbacks.mockResolvedValue({ GIT_TOKEN: "x" });
  resolveGitHostTokenWithFallbacks.mockImplementation(async (_provider: string, token?: string | null) => token?.trim() || null);
});

describe("createGitHubRepo", () => {
  it("creates the repo, clones it, and returns the local path + remote url", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.github.com/user/repos");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ name: "my-repo", private: true, auto_init: false });
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
    expect(ensureCodeUxGitignoreEntry).toHaveBeenCalledWith("/tmp/parent/my-repo");
    expect(openSync).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/tmp/parent/my-repo/README.md" }),
      fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o666,
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      17,
      "# my-repo\n\nInitialized with Code UX.\n",
      "utf8",
    );
    expect(closeSync).toHaveBeenCalledWith(17);
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["checkout", "-B", "main"], "/tmp/parent/my-repo");
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["add", "README.md", ".gitignore"], "/tmp/parent/my-repo");
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["commit", "-m", "Initial commit"], "/tmp/parent/my-repo");
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["push", "-u", "origin", "HEAD"], "/tmp/parent/my-repo", { GIT_TOKEN: "x" });
  });

  it("rejects when no host token is provided", async () => {
    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "  " }),
    ).rejects.toThrow(/GitHub token is required/);
  });

  it("preserves environment and local CLI authentication when no broker token is provided", async () => {
    resolveGitHostTokenWithFallbacks.mockResolvedValue("ambient-github-token");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ambient-github-token");
      return new Response(JSON.stringify({ clone_url: "https://github.com/me/r.git" }), { status: 201 });
    }));

    await expect(createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p" }))
      .resolves.toMatchObject({ remoteUrl: "https://github.com/me/r.git" });
  });

  it("redacts exact resolved credentials from remote operation errors", async () => {
    const secret = "short-unpatterned-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ message: `upstream echoed ${secret}` }),
      { status: 401 },
    )));

    const error = await createGitHubRepo({
      repoName: "r",
      isPrivate: false,
      cloneParentDir: "/tmp/p",
      hostToken: secret,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[REDACTED]");
    expect((error as Error).message).not.toContain(secret);
  });

  it("re-resolves broker credentials for the API, clone, and push boundaries", async () => {
    const values = ["rotation-api", "rotation-clone", "rotation-push"];
    const operations: string[] = [];
    const withHostCredential = vi.fn(async (operation, consumer) => {
      operations.push(operation);
      return await consumer(values.shift());
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer rotation-api");
      return new Response(JSON.stringify({ clone_url: "https://github.com/me/r.git" }), { status: 201 });
    }));

    await createGitHubRepo({
      repoName: "r",
      isPrivate: false,
      cloneParentDir: "/tmp/p",
      withHostCredential,
    });

    expect(operations).toEqual(["api", "clone", "push"]);
    expect(buildGitHttpAuthEnvWithFallbacks).toHaveBeenNthCalledWith(
      1,
      "https://github.com/me/r.git",
      { githubToken: "rotation-clone", gitlabToken: "rotation-clone" },
    );
    expect(buildGitHttpAuthEnvWithFallbacks).toHaveBeenNthCalledWith(
      2,
      "https://github.com/me/r.git",
      { githubToken: "rotation-push", gitlabToken: "rotation-push" },
    );
  });

  it("surfaces the GitHub API message on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "name already exists" }), { status: 422 })),
    );

    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "test-host-token-long" }),
    ).rejects.toThrow(/name already exists/);
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 500 })),
    );

    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "test-host-token-long" }),
    ).rejects.toThrow(/upstream down/);
  });

  it("throws when the response lacks a clone_url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 })),
    );

    await expect(
      createGitHubRepo({ repoName: "r", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "test-host-token-long" }),
    ).rejects.toThrow(/did not include clone_url/);
  });

  it("wraps validation failures with the failure prefix", async () => {
    validateSafeRepoName.mockImplementationOnce(() => {
      throw new Error("bad repo name");
    });

    await expect(
      createGitHubRepo({ repoName: "../evil", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "test-host-token-long" }),
    ).rejects.toThrow(/Failed to create GitHub repository: bad repo name/);
  });

  it("fails closed when the seed README resolves through a symlink", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ clone_url: "https://github.com/me/my-repo.git" }), { status: 201 })),
    );
    openSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("symlink refused"), { code: "ELOOP" });
    });

    await expect(createGitHubRepo({
      repoName: "my-repo",
      isPrivate: false,
      cloneParentDir: "/tmp/parent",
      hostToken: "token",
    })).rejects.toThrow(/README path must stay inside the repository/);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(closeSync).not.toHaveBeenCalled();
  });
});

describe("createGitLabRepo", () => {
  it("creates an empty project and seeds the requested default branch locally", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gitlab.com/api/v4/projects");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        name: "proj",
        path: "proj",
        visibility: "private",
        initialize_with_readme: false,
      });
      expect(body).not.toHaveProperty("default_branch");
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
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["checkout", "-B", "trunk"], "/tmp/parent/proj");
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
      createGitLabRepo({ repoName: "proj", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "test-host-token-long" }),
    ).rejects.toThrow(/limit reached/);
  });

  it("throws when the response lacks http_url_to_repo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: 7 }), { status: 201 })),
    );

    await expect(
      createGitLabRepo({ repoName: "proj", isPrivate: false, cloneParentDir: "/tmp/p", hostToken: "test-host-token-long" }),
    ).rejects.toThrow(/did not include http_url_to_repo/);
  });
});
