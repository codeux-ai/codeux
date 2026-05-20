import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeGitFinalizeStage } from "../../src/services/cli-workflow/pipeline/git-finalize-stage.js";
import { executePrFinalizeStage } from "../../src/services/cli-workflow/pipeline/pr-finalize-stage.js";
import type { PipelineContext } from "../../src/services/cli-workflow/pipeline/pipeline-context.js";
import type { DashboardSettings } from "../../src/contracts/app-types.js";

describe("Local Git Orchestration Integration", () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      provider: "openai",
      task: { id: "test-task", prompt: "test prompt" },
      title: "Test Task",
      repoPath: "/test/repo",
      worktreePath: "/test/repo/.worktrees/workspace",
      workerBranch: "test-worker-branch",
      featureBranch: "test-feature-branch",
      initialHead: "abcd123",
      sessionId: "test-session",
      settings: {
        git: {
          githubMode: "LOCAL",
          githubToken: "token",
          gitlabToken: "token",
          autoCreatePr: true,
        },
      } as DashboardSettings,
      workspaceArtifactService: {
        exportBinaryPatch: vi.fn().mockResolvedValue("mock patch"),
        applyPatchToBranch: vi.fn().mockResolvedValue({
          hasChanges: true,
          commitSha: "newsha456",
          stats: { filesChanged: 1, insertions: 10, deletions: 0 }
        })
      },
      prService: {
        hasUnpushedCommits: vi.fn().mockResolvedValue(false),
        hasWorkerBranchCommitsAgainstFeature: vi.fn().mockResolvedValue(true),
        resolveOrCreateFeaturePr: vi.fn()
      },
      deps: {
        sessionTracking: {
          appendActivity: vi.fn(),
          updateSession: vi.fn()
        },
        getGithubToken: vi.fn().mockReturnValue("token")
      },
      runCommand: vi.fn().mockResolvedValue({ stdout: "success", stderr: "" }),
      workflowSucceeded: false
    };
  });

  it("should skip pushing in git-finalize-stage when githubMode is LOCAL", async () => {
    mockCtx.prService.hasUnpushedCommits.mockResolvedValueOnce(true);

    const result = await executeGitFinalizeStage(mockCtx as PipelineContext);

    expect(mockCtx.workspaceArtifactService.applyPatchToBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        skipPush: true
      })
    );

    // Verify `git push` was never run
    const gitPushCalls = mockCtx.runCommand.mock.calls.filter((call: any) =>
      call[0] === "git" && call[1].includes("push")
    );
    expect(gitPushCalls.length).toBe(0);

    expect(result.hasChanges).toBe(true);
  });

  it("should merge locally in pr-finalize-stage when githubMode is LOCAL", async () => {
    const result = await executePrFinalizeStage(mockCtx as PipelineContext);

    // Verify PR service is not used
    expect(mockCtx.prService.resolveOrCreateFeaturePr).not.toHaveBeenCalled();

    // Verify git merge sequence
    expect(mockCtx.runCommand).toHaveBeenNthCalledWith(1, "git", ["checkout", "test-feature-branch"], "/test/repo");
    expect(mockCtx.runCommand).toHaveBeenNthCalledWith(2, "git", ["merge", "--no-ff", "-m", "Merge worker branch test-worker-branch", "test-worker-branch"], "/test/repo");
    expect(mockCtx.runCommand).toHaveBeenNthCalledWith(3, "git", ["checkout", "test-worker-branch"], "/test/repo");

    expect(mockCtx.deps.sessionTracking.updateSession).toHaveBeenCalledWith("test-session", { state: "COMPLETED" });
    expect(mockCtx.workflowSucceeded).toBe(true);
    expect(result.prUrl).toBeUndefined();
  });
});
