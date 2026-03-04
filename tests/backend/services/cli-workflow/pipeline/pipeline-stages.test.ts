import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PipelineContext } from "../../../../../src/services/cli-workflow/pipeline/pipeline-context.js";
import { executeProviderStage } from "../../../../../src/services/cli-workflow/pipeline/execute-provider-stage.js";
import { executeGitFinalizeStage } from "../../../../../src/services/cli-workflow/pipeline/git-finalize-stage.js";

const createMockContext = (): PipelineContext => {
  return {
    sessionId: "test-session",
    workerBranch: "worker-branch",
    featureBranch: "feature-branch",
    task: { id: "T1", prompt: "test prompt", title: "test task", state: "PENDING", description: "desc" },
    provider: "gemini",
    title: "test title",
    repoPath: "/repo",
    worktreePath: "/repo/worktree",
    workflowSettings: {
      executionMode: "LOCAL",
      resumeFailedTaskInSameWorkspace: false,
      retryOnReadFileNotFound: true,
      cleanupWorktreeOnSuccess: true,
      cleanupWorktreeOnFailure: false,
      containerImage: "node:18",
    },
    settings: {
      aiProvider: {
        providers: {
          gemini: { apiKey: "key", model: "model", thinkingMode: false },
          codex: { apiKey: "key", model: "model", thinkingMode: false },
          "claude-code": { apiKey: "key", model: "model", thinkingMode: false },
        },
      },
      git: { autoCreatePr: true },
      cliWorkflow: {},
    },
    initialHead: "abcd123",
    workflowSucceeded: false,
    workspaceManager: {
      buildWorktreePath: vi.fn(),
      resolveResumeWorktreePath: vi.fn(),
      prepareWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      buildWorkspaceGuidance: vi.fn(),
    },
    prService: {
      hasUnpushedCommits: vi.fn(),
      hasWorkerBranchCommitsAgainstFeature: vi.fn(),
      resolveOrCreateFeaturePr: vi.fn(),
    },
    providerRunner: {
      runProvider: vi.fn(),
    },
    deps: {
      sessionTracking: { appendActivity: vi.fn(), updateSession: vi.fn() } as any,
      getDashboardSettings: vi.fn(),
      getGuideContent: vi.fn(),
      getGithubToken: vi.fn(),
      logger: { error: vi.fn() } as any,
    },
    runCommand: vi.fn(),
  };
};

describe("executeProviderStage", () => {
  it("throws an error if provider run fails without retry conditions", async () => {
    const ctx = createMockContext();
    ctx.workflowSettings.retryOnReadFileNotFound = false;
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({ ok: false, stdout: "", stderr: "fatal provider error" });

    await expect(executeProviderStage(ctx, "prompt")).rejects.toThrow("fatal provider error");
  });

  it("retries if retryOnReadFileNotFound is true and error is a read file not found error", async () => {
    const ctx = createMockContext();
    ctx.workflowSettings.retryOnReadFileNotFound = true;

    // Simulate first failure due to not found
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({
      ok: false,
      stdout: "",
      stderr: "error executing tool read_file: file not found"
    });
    // Simulate second success
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({ ok: true, stdout: "success", stderr: "" });

    await executeProviderStage(ctx, "prompt");
    expect(ctx.providerRunner.runProvider).toHaveBeenCalledTimes(2);
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Retrying with file-discovery guidance."
    }));
  });
});

describe("executeGitFinalizeStage", () => {
  it("returns { hasChanges: false } when there are no changes or unpushed commits", async () => {
    const ctx = createMockContext();

    // Mock runCommand to simulate no changes
    vi.mocked(ctx.runCommand).mockImplementation(async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key === "git rev-parse --abbrev-ref HEAD") return { ok: true, stdout: "worker-branch", stderr: "" };
      if (key === "git rev-parse HEAD") return { ok: true, stdout: "abcd123", stderr: "" }; // Matches initialHead
      if (key === "git status --porcelain") return { ok: true, stdout: "", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    });

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(false);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(false);

    const result = await executeGitFinalizeStage(ctx);

    expect(result.hasChanges).toBe(false);
    expect(ctx.workflowSucceeded).toBe(true);
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED" });
  });

  it("commits and pushes when there are working tree changes", async () => {
    const ctx = createMockContext();

    vi.mocked(ctx.runCommand).mockImplementation(async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key === "git rev-parse --abbrev-ref HEAD") return { ok: true, stdout: "worker-branch", stderr: "" };
      if (key === "git rev-parse HEAD") return { ok: true, stdout: "abcd123", stderr: "" };
      if (key === "git status --porcelain") return { ok: true, stdout: "M file.txt", stderr: "" }; // Has changes
      if (key === "git add -A") return { ok: true, stdout: "", stderr: "" };
      if (key.startsWith("git commit -m")) return { ok: true, stdout: "", stderr: "" };
      if (key === `git push -u origin ${ctx.workerBranch}`) return { ok: true, stdout: "", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    });

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(false);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(false);

    const result = await executeGitFinalizeStage(ctx);

    expect(result.hasChanges).toBe(true);
    expect(ctx.runCommand).toHaveBeenCalledWith("git", ["add", "-A"], ctx.worktreePath);
    expect(ctx.runCommand).toHaveBeenCalledWith("git", ["push", "-u", "origin", ctx.workerBranch], ctx.worktreePath);
  });
});
