import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveReviewBranch } from "../../../../src/domain/qa-review/qa-review-branch-resolution.js";
import { findRecoverableWorkerBranch } from "../../../../src/infrastructure/git/local-merge.js";

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

  it("does not attempt local-ref recovery in REMOTE mode", async () => {
    const deps = { findRecoverableWorkerBranch: vi.mocked(findRecoverableWorkerBranch) };
    const { reviewBranch } = await resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined } as any,
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" } as any,
      repoPath: "/repo",
      featureBranch: "feature/main",
      githubMode: "REMOTE",
    }, deps);

    expect(reviewBranch).toBe("feature/main");
    expect(deps.findRecoverableWorkerBranch).not.toHaveBeenCalled();
  });
});
