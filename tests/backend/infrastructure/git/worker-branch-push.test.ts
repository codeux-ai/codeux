import { describe, expect, it, vi } from "vitest";
import {
  FreshWorkerBranchCollisionError,
  pushWorkerBranch,
  type WorkerBranchGitRunner,
} from "../../../../src/infrastructure/git/worker-branch-push.js";
import type { CommandResult } from "../../../../src/services/cli-process-runner.js";

const result = (stdout = ""): CommandResult => ({
  ok: true,
  code: 0,
  stdout,
  stderr: "",
});

describe("pushWorkerBranch", () => {
  const repoPath = "/repo";
  const workerBranch = "worker/task";
  const workerRef = "refs/heads/worker/task";
  const localTip = "1".repeat(40);

  it("accepts an ambiguous fresh push when the exact remote tip matches the local tip", async () => {
    const runner = vi.fn<WorkerBranchGitRunner>()
      .mockRejectedValueOnce(new Error("git push failed: exit code 137, no output captured"))
      .mockResolvedValueOnce(result(`${localTip}\n`))
      .mockResolvedValueOnce(result(`${localTip}\t${workerRef}\n`));

    await expect(pushWorkerBranch({
      runner,
      repoPath,
      workerBranch,
      allowExistingWorkerBranch: false,
    })).resolves.toBeUndefined();

    expect(runner).toHaveBeenCalledTimes(3);
    expect(runner).toHaveBeenNthCalledWith(
      3,
      "git",
      ["ls-remote", "--heads", "origin", workerRef],
      repoPath,
      process.env,
    );
    expect(runner.mock.calls.filter((call) => call[1][0] === "push")).toHaveLength(1);
  });

  it("retries the expected-absent push when the exact remote branch is still absent", async () => {
    const runner = vi.fn<WorkerBranchGitRunner>()
      .mockRejectedValueOnce(new Error("git push failed: remote end hung up unexpectedly"))
      .mockResolvedValueOnce(result(`${localTip}\n`))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result());

    await expect(pushWorkerBranch({
      runner,
      repoPath,
      workerBranch,
      allowExistingWorkerBranch: false,
    })).resolves.toBeUndefined();

    const pushCalls = runner.mock.calls.filter((call) => call[1][0] === "push");
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls[0]?.[1]).toContain(`--force-with-lease=${workerRef}:`);
    expect(pushCalls[1]?.[1]).toContain(`--force-with-lease=${workerRef}:`);
  });

  it("fails as a collision when an ambiguous fresh push finds a different remote tip", async () => {
    const remoteTip = "2".repeat(40);
    const runner = vi.fn<WorkerBranchGitRunner>()
      .mockRejectedValueOnce(new Error("git push failed: RPC failed; no output captured"))
      .mockResolvedValueOnce(result(`${localTip}\n`))
      .mockResolvedValueOnce(result(`${remoteTip}\t${workerRef}\n`));

    await expect(pushWorkerBranch({
      runner,
      repoPath,
      workerBranch,
      allowExistingWorkerBranch: false,
    })).rejects.toEqual(new FreshWorkerBranchCollisionError(workerBranch, localTip, remoteTip));

    expect(runner.mock.calls.filter((call) => call[1][0] === "push")).toHaveLength(1);
  });

  it("does not retry when the exact remote probe cannot establish absence", async () => {
    const probeError = new Error("git ls-remote failed: authentication unavailable");
    const runner = vi.fn<WorkerBranchGitRunner>()
      .mockRejectedValueOnce(new Error("git push failed: early EOF"))
      .mockResolvedValueOnce(result(`${localTip}\n`))
      .mockRejectedValueOnce(probeError);

    await expect(pushWorkerBranch({
      runner,
      repoPath,
      workerBranch,
      allowExistingWorkerBranch: false,
    })).rejects.toBe(probeError);

    expect(runner.mock.calls.filter((call) => call[1][0] === "push")).toHaveLength(1);
  });
});
