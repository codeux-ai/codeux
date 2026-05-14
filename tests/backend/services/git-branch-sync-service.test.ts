import { describe, expect, it, vi } from "vitest";
import { syncRemoteBranchIfAvailable } from "../../../src/services/git-branch-sync-service.js";

describe("git branch sync service", () => {
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
      timeoutMs: 30000,
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
    expect(options.timeoutMs).toBe(30000);
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

  it("disables interactive prompts for HTTPS remotes even when no token is configured", async () => {
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
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_ASKPASS).toBe("true");
    expect(env.SSH_ASKPASS).toBe("true");
    expect(env.GCM_INTERACTIVE).toBe("never");
    expect(options.timeoutMs).toBe(5000);
  });

  it("creates a missing local branch from origin after fetching", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("missing local branch"))
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", "feature/sprint-1", runner)).resolves.toBe(true);

    expect(runner).toHaveBeenCalledWith("git", ["fetch", "origin", "--prune"], "/repo", undefined, {
      timeoutMs: 30000,
    });
    expect(runner).toHaveBeenCalledWith("git", ["branch", "--track", "feature/sprint-1", "origin/feature/sprint-1"], "/repo");
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
});
