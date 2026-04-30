import { describe, expect, it, vi, beforeEach } from "vitest";
import { CliWorkflowService } from "../../../src/services/cli-workflow-service.js";
import { executePrepareStage } from "../../../src/services/cli-workflow/pipeline/prepare-stage.js";
import { executeProviderStage } from "../../../src/services/cli-workflow/pipeline/execute-provider-stage.js";
import { executeGitFinalizeStage } from "../../../src/services/cli-workflow/pipeline/git-finalize-stage.js";
import { executePrFinalizeStage } from "../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js";
import { executeCleanupStage } from "../../../src/services/cli-workflow/pipeline/cleanup-stage.js";

vi.mock("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/execute-provider-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");


const buildService = (): any => {
  return new CliWorkflowService({
    sessionTracking: {} as any,
    executionRepository: undefined,
    getDashboardSettings: () => { throw new Error("not used"); },
    agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: async () => null } as any,
    getGithubToken: () => undefined,
  }) as any;
};

describe("CliWorkflowService unpushed commit detection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs task workflow pipeline and handles error", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockRejectedValue(new Error("Stage failed"));
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(deps.sessionTracking.updateSession).toHaveBeenCalledWith("sess-1", { state: "FAILED" });
    expect(deps.sessionTracking.appendActivity).toHaveBeenCalledWith("sess-1", {
      originator: "system",
      description: "Workflow failed: Stage failed",
    });
    expect(executionRepository.appendTaskRunEvent).toHaveBeenNthCalledWith(
      2,
      "run-1",
      "cli_workflow_failed",
      "system",
      expect.objectContaining({ errorMessage: "Stage failed", provider: "gemini" }),
      expect.objectContaining({ sourceEventKey: undefined }),
    );
    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "FAILED" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({ status: "failed", errorMessage: "Stage failed" }),
    );
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("blocks unrecoverable git credential failures instead of leaving the task retryable", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
        taskId: "task-1",
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue(undefined),
      executionRepository,
      projectManagementRepository: {
        updateTask: vi.fn(),
      },
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockRejectedValue(
      new Error("fatal: could not read Username for 'https://github.com': No such device or address"),
    );
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "BLOCKED" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({
        status: "blocked",
        errorMessage: "fatal: could not read Username for 'https://github.com': No such device or address",
      }),
    );
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
      "task-1",
      { status: "pending" },
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenNthCalledWith(
      2,
      "run-1",
      "cli_workflow_blocked",
      "system",
      expect.objectContaining({
        category: "git_configuration",
        errorMessage: "fatal: could not read Username for 'https://github.com': No such device or address",
      }),
      expect.objectContaining({ sourceEventKey: undefined }),
    );
  });


  it("runs task workflow pipeline successfully", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    // Mock the external stages
    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeProviderStage } = await import("../../../src/services/cli-workflow/pipeline/execute-provider-stage.js");
    const { executeGitFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
    const { executePrFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
    vi.mocked(executeProviderStage).mockResolvedValue(undefined);
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({
      hasChanges: true,
      committedChanges: true,
      pushedBranch: "worker-1",
      stats: { filesChanged: 2, insertions: 10, deletions: 5 },
    });
    vi.mocked(executePrFinalizeStage).mockResolvedValue({ prUrl: "https://example.com/pr/1" });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: true });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executePrepareStage).toHaveBeenCalled();
    expect(executeProviderStage).toHaveBeenCalled();
    expect(executeGitFinalizeStage).toHaveBeenCalled();
    expect(executePrFinalizeStage).toHaveBeenCalled();
    expect(executeCleanupStage).toHaveBeenCalled();
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_prepare_started",
      "system",
      expect.any(Object),
      expect.objectContaining({ sourceEventKey: "cli:prepare:started" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_git_pushed",
      "system",
      expect.objectContaining({
        committedChanges: true,
        pushedBranch: "worker-1",
        filesChanged: 2,
        insertions: 10,
        deletions: 5,
      }),
      expect.objectContaining({ sourceEventKey: "cli:git:pushed:worker-1" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_pr_finalized",
      "system",
      expect.objectContaining({ prUrl: "https://example.com/pr/1", workerBranch: "worker-1" }),
      expect.objectContaining({ sourceEventKey: "cli:pr-finalized:worker-1" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_workflow_completed",
      "system",
      expect.objectContaining({ outcome: "pushed", prUrl: "https://example.com/pr/1" }),
      expect.any(Object),
    );
    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "COMPLETED", prUrl: "https://example.com/pr/1" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("runs task workflow pipeline and stops when no changes", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({ id: "run-1", startedAt: "2024-01-01T00:00:00Z", taskId: "T1", dispatchId: "dispatch-1" }),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      appendTaskRunEvent: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeGitFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
    const { executePrFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: false, committedChanges: false });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executePrFinalizeStage).not.toHaveBeenCalled();
    expect(executeCleanupStage).toHaveBeenCalled();
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_git_no_changes",
      "system",
      expect.any(Object),
      expect.any(Object)
    );
    // ensure no stats are emitted
    expect(executionRepository.appendTaskRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "cli_git_pushed",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });


  it("resumes failed task in same workspace when configured", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue({ sessionId: "old-session", workerBranch: "worker/old-branch" }),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { resumeFailedTaskInSameWorkspace: true, executionMode: "docker" } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    (service as any).runTaskWorkflow = vi.fn().mockResolvedValue(undefined);

    // Mock the workspace manager
    (service as any).workspaceManager.resolveResumeWorktreePath = vi.fn().mockResolvedValue("/tmp/repo/.worktrees/old-session");

    const input = {
      provider: "gemini" as const,
      task: { id: "T1", prompt: "prompt", title: "title" } as any,
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
    };

    const session = await service.startTask(input);
    expect(deps.sessionTracking.appendActivity).toHaveBeenCalledWith(session.id, { originator: "system", description: "Retry configured to resume failed workspace from old-session at /tmp/repo/.worktrees/old-session." });
  });

  it("starts a task and returns a session", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: {} }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);
    
    // We mock the private runTaskWorkflow to avoid side effects in this unit test
    (service as any).runTaskWorkflow = vi.fn().mockResolvedValue(undefined);

    const input = {
      provider: "gemini" as const,
      task: { id: "T1", prompt: "prompt", title: "title" } as any,
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
    };

    const session = await service.startTask(input);

    expect(session.id).toContain("cli-gemini-");
    expect(deps.sessionTracking.createSession).toHaveBeenCalled();
    expect((service as any).runTaskWorkflow).toHaveBeenCalled();
  });

  it("detects unpushed commits when worker branch has no remote ref yet", async () => {
    const service = buildService();
    service.prService.hasUnpushedCommits = vi.fn().mockResolvedValue(true);

    const detected = await service.hasUnpushedWorkerBranchCommits("/tmp/worktree", "worker/task-1", "feature/test");
    expect(detected).toBe(true);
    expect(service.prService.hasUnpushedCommits).toHaveBeenCalledWith(
      "/tmp/worktree",
      "worker/task-1",
      "feature/test",
      expect.any(Function),
    );
  });

  it("returns false when worker branch is already pushed and has no commits ahead", async () => {
    const service = buildService();
    service.prService.hasUnpushedCommits = vi.fn().mockResolvedValue(false);

    const detected = await service.hasUnpushedWorkerBranchCommits("/tmp/worktree", "worker/task-2", "feature/test");
    expect(detected).toBe(false);
  });

  it("detects existing worker-branch commits ahead of feature branch even when nothing is unpushed", async () => {
    const service = buildService();
    service.prService.hasWorkerBranchCommitsAgainstFeature = vi.fn().mockResolvedValue(true);

    const detected = await service.hasWorkerBranchCommitsAgainstFeature("/tmp/worktree", "feature/test", "worker/task-3");
    expect(detected).toBe(true);
    expect(service.prService.hasWorkerBranchCommitsAgainstFeature).toHaveBeenCalledWith(
      "/tmp/worktree",
      "worker/task-3",
      "feature/test",
      expect.any(Function),
    );
  });
});
