import { describe, expect, it, vi } from "vitest";
import { syncRemoteBranchIfAvailable } from "../../../src/services/git-branch-sync-service.js";

describe("git branch sync service", () => {
  it("creates a missing local branch from origin after fetching", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "git@github.com:owner/repo.git\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("missing local branch"))
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(syncRemoteBranchIfAvailable("/repo", "feature/sprint-1", runner)).resolves.toBe(true);

    expect(runner).toHaveBeenCalledWith("git", ["fetch", "origin", "--prune"], "/repo");
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
