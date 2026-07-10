import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveReviewBranch } from "../../../../src/domain/qa-review/qa-review-branch-resolution.js";
import { findRecoverableWorkerBranch } from "../../../../src/infrastructure/git/local-merge.js";
import { buildWorkerBranchPrefix } from "../../../../src/services/cli-workflow-utils.js";

vi.mock("../../../../src/infrastructure/git/local-merge.js", () => ({
  findRecoverableWorkerBranch: vi.fn(),
}));

describe("qa-review-branch-resolution", () => {
  beforeEach(() => {
    vi.mocked(findRecoverableWorkerBranch).mockReset();
  });

  it("prefers the recorded worker branch on the task without recovering", async () => {
    const deps = { findRecoverableWorkerBranch: vi.mocked(findRecoverableWorkerBranch) };
    const { reviewBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: "task/feature-t01-claude" } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "LOCAL",
    }, deps);
    expect(reviewBranch).toBe("task/feature-t01-claude");
    expect(deps.findRecoverableWorkerBranch).not.toHaveBeenCalled();
  });

  it("falls back to the latest run's worker branch when the task has none", async () => {
    const deps = { findRecoverableWorkerBranch: vi.mocked(findRecoverableWorkerBranch) };
    const { reviewBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: "task/feature-x-t01-claude" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "LOCAL",
    }, deps);
    expect(reviewBranch).toBe("task/feature-x-t01-claude");
  });

  it("recovers the worker branch from local refs in LOCAL mode when metadata was lost", async () => {
    const mockFind = vi.mocked(findRecoverableWorkerBranch);
    mockFind.mockResolvedValueOnce("task/feature-main-t01-claude-recovered");
    const { reviewBranch, recoveredWorkerBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "LOCAL",
    }, { findRecoverableWorkerBranch: mockFind });

    expect(reviewBranch).toBe("task/feature-main-t01-claude-recovered");
    expect(recoveredWorkerBranch).toBe("task/feature-main-t01-claude-recovered");
    expect(mockFind).toHaveBeenCalled();
  });

  it("falls back to the feature branch when no worker branch with real work exists", async () => {
    const mockFind = vi.mocked(findRecoverableWorkerBranch);
    mockFind.mockResolvedValueOnce(null);
    const { reviewBranch } = await resolveReviewBranch({
      task: { id: "T04", provider: "qwen-code", worker_branch: undefined } as any,
      taskRun: { id: "run-4", workerBranch: null, provider: "qwen-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      githubMode: "LOCAL",
    }, { findRecoverableWorkerBranch: mockFind });

    expect(reviewBranch).toBe("feature/sprint-1");
  });

  it("falls back to the feature branch in REMOTE mode when no recoverable worker branch exists", async () => {
    const deps = { findRecoverableWorkerBranch: vi.mocked(findRecoverableWorkerBranch) };
    const { reviewBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "REMOTE",
    }, deps);

    expect(reviewBranch).toBe("feature/main");
    expect(deps.findRecoverableWorkerBranch).toHaveBeenCalled();
  });

  it("recovers local worker refs in REMOTE mode before falling back to the feature branch", async () => {
    const mockFind = vi.mocked(findRecoverableWorkerBranch);
    mockFind.mockResolvedValueOnce("task/feature-main-t01-claude-remote-local");
    const { reviewBranch, recoveredWorkerBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "REMOTE",
    }, { findRecoverableWorkerBranch: mockFind });

    expect(reviewBranch).toBe("task/feature-main-t01-claude-remote-local");
    expect(recoveredWorkerBranch).toBe("task/feature-main-t01-claude-remote-local");
  });

  it("recovers remote-tracking worker refs in REMOTE mode when local branch metadata is missing", async () => {
    const mockFind = vi.mocked(findRecoverableWorkerBranch);
    mockFind.mockResolvedValueOnce(null);
    const branchPrefix = buildWorkerBranchPrefix("feature/main", "T01", "claude-code");
    const oldBranch = `${branchPrefix}old`;
    const newBranch = `${branchPrefix}new`;
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "for-each-ref") {
        return {
          stdout: [
            `origin/${oldBranch}`,
            `origin/${newBranch}`,
          ].join("\n"),
        };
      }
      if (args[0] === "rev-list" && args[2] === `origin/feature/main..origin/${oldBranch}`) {
        return { stdout: "1\n" };
      }
      if (args[0] === "rev-list" && args[2] === `origin/feature/main..origin/${newBranch}`) {
        return { stdout: "2\n" };
      }
      if (args[0] === "log" && args[3] === `origin/${oldBranch}`) {
        return { stdout: "100\n" };
      }
      if (args[0] === "log" && args[3] === `origin/${newBranch}`) {
        return { stdout: "200\n" };
      }
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    });

    const { reviewBranch, recoveredWorkerBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "REMOTE",
    }, { findRecoverableWorkerBranch: mockFind, runner });

    expect(reviewBranch).toBe(newBranch);
    expect(recoveredWorkerBranch).toBe(newBranch);
  });

  it("ignores remote-tracking worker refs that have no commits ahead of the feature branch", async () => {
    const mockFind = vi.mocked(findRecoverableWorkerBranch);
    mockFind.mockResolvedValueOnce(null);
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "for-each-ref") {
        return { stdout: `origin/${buildWorkerBranchPrefix("feature/main", "T01", "claude-code")}empty\n` };
      }
      if (args[0] === "rev-list") {
        return { stdout: "0\n" };
      }
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    });

    const { reviewBranch, recoveredWorkerBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "REMOTE",
    }, { findRecoverableWorkerBranch: mockFind, runner });

    expect(reviewBranch).toBe("feature/main");
    expect(recoveredWorkerBranch).toBeNull();
  });
});
