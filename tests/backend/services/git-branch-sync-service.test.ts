import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRemoteBranchIfAvailable } from "../../../src/services/git-branch-sync-service.js";
import { setProviderTokenResolverForTests } from "../../../src/services/git-http-auth.js";

describe("git branch sync service", () => {
  const originalFetchTimeout = process.env.CODE_UX_GIT_FETCH_TIMEOUT_MS;

  beforeEach(() => {
    // Disable host CLI fallbacks so tests don't depend on a logged-in gh/glab.
    delete process.env.CODE_UX_GIT_FETCH_TIMEOUT_MS;
    setProviderTokenResolverForTests(async () => null);
  });
  afterEach(() => {
    if (originalFetchTimeout === undefined) {
      delete process.env.CODE_UX_GIT_FETCH_TIMEOUT_MS;
    } else {
      process.env.CODE_UX_GIT_FETCH_TIMEOUT_MS = originalFetchTimeout;
    }
    setProviderTokenResolverForTests(null);
  });

  it("fetches SSH remotes without injecting HTTPS auth", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", undefined, {
      runner,
      githubToken: "gh-token",
    })).resolves.toBe(true);

    expect(runner).toHaveBeenNthCalledWith(1, "git", ["remote", "get-url", "origin"], "/repo");
    expect(runner).toHaveBeenNthCalledWith(2, "git", ["fetch", "origin", "--prune"], "/repo", undefined, {
      timeoutMs: 120000,
    });
  });

  it("fetches HTTPS GitHub remotes with a temporary auth header and non-interactive prompts", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "https://github.com/owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", undefined, {
      runner,
      githubToken: "gh-token",
    })).resolves.toBe(true);

    expect(runner).toHaveBeenCalledTimes(2);
    const fetchCall = runner.mock.calls[1];
    const env = fetchCall?.[3] as NodeJS.ProcessEnv;
    const options = fetchCall?.[4] as { timeoutMs?: number };
    expect(fetchCall?.slice(0, 3)).toEqual(["git", ["fetch", "origin", "--prune"], "/repo"]);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from("x-access-token:gh-token").toString("base64")}`);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_ASKPASS).toBe("true");
    expect(env.SSH_ASKPASS).toBe("true");
    expect(env.GCM_INTERACTIVE).toBe("never");
    expect(options.timeoutMs).toBe(120000);
  });

  it("allows deployments to raise the mandatory fetch timeout through the environment", async () => {
    process.env.CODE_UX_GIT_FETCH_TIMEOUT_MS = "180000";
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", undefined, {
      runner,
    })).resolves.toBe(true);

    expect(runner).toHaveBeenNthCalledWith(2, "git", ["fetch", "origin", "--prune"], "/repo", undefined, {
      timeoutMs: 180000,
    });
  });

  it("fetches HTTPS GitLab remotes with a temporary auth header and non-interactive prompts", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "https://gitlab.com/group/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", undefined, {
      runner,
      gitlabToken: "gl-token",
    })).resolves.toBe(true);

    const env = runner.mock.calls[1]?.[3] as NodeJS.ProcessEnv;
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://gitlab.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from("oauth2:gl-token").toString("base64")}`);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GCM_INTERACTIVE).toBe("never");
  });

  it("forces non-interactive mode for HTTPS remotes when no token can be resolved (fail fast, do not hang on askpass)", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "https://github.com/owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", undefined, {
      runner,
      fetchTimeoutMs: 5000,
    })).resolves.toBe(true);

    const fetchCall = runner.mock.calls[1];
    const env = fetchCall?.[3] as NodeJS.ProcessEnv;
    const options = fetchCall?.[4] as { timeoutMs?: number };
    expect(env).toBeDefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_ASKPASS).toBe("true");
    expect(env.SSH_ASKPASS).toBe("true");
    expect(env.GCM_INTERACTIVE).toBe("never");
    expect(options.timeoutMs).toBe(5000);
  });

  it("resolves a github token from the gh CLI fallback when no token is in settings", async () => {
    setProviderTokenResolverForTests(async (provider) => provider === "github" ? "gh-cli-token" : null);
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "https://github.com/owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", undefined, {
      runner,
    })).resolves.toBe(true);

    const env = runner.mock.calls[1]?.[3] as NodeJS.ProcessEnv;
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from("x-access-token:gh-cli-token").toString("base64")}`);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("creates a missing local branch from origin after fetching", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("missing local branch"))
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", "feature/sprint-1", runner)).resolves.toBe(true);

    expect(runner).toHaveBeenCalledWith("git", [
      "fetch",
      "origin",
      "--prune",
      "+refs/heads/feature/sprint-1:refs/remotes/origin/feature/sprint-1",
    ], "/repo", undefined, {
      timeoutMs: 120000,
    });
    expect(runner).toHaveBeenCalledWith("git", ["branch", "--track", "feature/sprint-1", "origin/feature/sprint-1"], "/repo");
  });

  it("refreshes only the requested remote branch before branch-sensitive work", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("missing remote branch"));

    await expect(syncRemoteBranchIfAvailable("/repo", "feature/sprint-2", runner)).resolves.toBe(true);

    expect(runner).toHaveBeenNthCalledWith(2, "git", [
      "fetch",
      "origin",
      "--prune",
      "+refs/heads/feature/sprint-2:refs/remotes/origin/feature/sprint-2",
    ], "/repo", undefined, {
      timeoutMs: 120000,
    });
  });

  it("falls back to a whole-origin fetch when the branch name cannot be represented as a refspec", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("missing remote branch"));

    await expect(syncRemoteBranchIfAvailable("/repo", "feature/sprint 2", runner)).resolves.toBe(true);

    expect(runner).toHaveBeenNthCalledWith(2, "git", ["fetch", "origin", "--prune"], "/repo", undefined, {
      timeoutMs: 120000,
    });
  });

  it("falls back to a whole-origin fetch when the branch was never pushed (no file changes / no PR)", async () => {
    const runner = vi.fn()
      // remote get-url origin
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      // targeted fetch fails because the branch does not exist on the remote
      .mockRejectedValueOnce(new Error(
        "git fetch origin --prune +refs/heads/task/no-changes:refs/remotes/origin/task/no-changes failed: " +
        "fatal: couldn't find remote ref refs/heads/task/no-changes",
      ))
      // fallback prune fetch succeeds
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      // show-ref for the (still absent) remote branch fails -> returns early
      .mockRejectedValueOnce(new Error("missing remote branch"));

    await expect(syncRemoteBranchIfAvailable("/repo", "task/no-changes", runner)).resolves.toBe(true);

    expect(runner).toHaveBeenNthCalledWith(2, "git", [
      "fetch",
      "origin",
      "--prune",
      "+refs/heads/task/no-changes:refs/remotes/origin/task/no-changes",
    ], "/repo", undefined, {
      timeoutMs: 120000,
    });
    expect(runner).toHaveBeenNthCalledWith(3, "git", ["fetch", "origin", "--prune"], "/repo", undefined, {
      timeoutMs: 120000,
    });
  });

  it("rethrows fetch failures that are not a missing remote ref", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("fatal: unable to access remote: Connection timed out"));

    await expect(syncRemoteBranchIfAvailable("/repo", "task/no-changes", runner)).rejects.toThrow(
      /Connection timed out/,
    );
    // No fallback prune fetch is attempted for unrelated failures.
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("fast-forwards a non-current local branch to origin when possible", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "local-sha\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "remote-sha\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "dev\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await syncRemoteBranchIfAvailable("/repo", "feature/sprint-1", runner);

    expect(runner).toHaveBeenCalledWith("git", ["branch", "-f", "feature/sprint-1", "origin/feature/sprint-1"], "/repo");
  });

  it("does not rewrite a dirty checked-out branch", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "local-sha\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "remote-sha\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "feature/sprint-1\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: " M src/index.ts\n", stderr: "", exitCode: 0 });

    await syncRemoteBranchIfAvailable("/repo", "feature/sprint-1", runner);

    expect(runner).not.toHaveBeenCalledWith("git", ["merge", "--ff-only", "origin/feature/sprint-1"], "/repo");
    expect(runner).not.toHaveBeenCalledWith("git", ["branch", "-f", "feature/sprint-1", "origin/feature/sprint-1"], "/repo");
  });

  it("rewrites a checked-out branch that has only untracked files", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "local-sha\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "remote-sha\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "feature/sprint-1\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await syncRemoteBranchIfAvailable("/repo", "feature/sprint-1", runner);

    expect(runner).toHaveBeenCalledWith("git", ["status", "--porcelain", "-uno"], "/repo");
    expect(runner).toHaveBeenCalledWith("git", ["merge", "--ff-only", "origin/feature/sprint-1"], "/repo");
  });
});
