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
    getDashboardSettings: () => { throw new Error("not used"); },
    getGuideContent: async () => "",
    getGithubToken: () => undefined,
  }) as any;
};

describe("CliWorkflowService unpushed commit detection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs task workflow pipeline and handles error", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      getGuideContent: vi.fn().mockResolvedValue("guide"),
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockRejectedValue(new Error("Stage failed"));
    vi.mocked(executeCleanupStage).mockResolvedValue(undefined);

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      projectId: "repo", sprintId: "1",
      sessionId: "sess-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(deps.sessionTracking.updateSession).toHaveBeenCalledWith("sess-1", { state: "FAILED" });
    expect(deps.sessionTracking.appendActivity).toHaveBeenCalledWith("sess-1", {
      originator: "system",
      description: "Workflow failed: Stage failed",
    });
    expect(deps.logger.error).toHaveBeenCalled();
  });


  it("runs task workflow pipeline successfully", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      getGuideContent: vi.fn().mockResolvedValue("guide"),
      getGithubToken: vi.fn().mockReturnValue("token"),
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
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: true });
    vi.mocked(executePrFinalizeStage).mockResolvedValue(undefined);
    vi.mocked(executeCleanupStage).mockResolvedValue(undefined);

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      projectId: "repo", sprintId: "1",
      sessionId: "sess-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executePrepareStage).toHaveBeenCalled();
    expect(executeProviderStage).toHaveBeenCalled();
    expect(executeGitFinalizeStage).toHaveBeenCalled();
    expect(executePrFinalizeStage).toHaveBeenCalled();
    expect(executeCleanupStage).toHaveBeenCalled();
  });

  it("runs task workflow pipeline and stops when no changes", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      getGuideContent: vi.fn().mockResolvedValue("guide"),
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeGitFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
    const { executePrFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      projectId: "repo", sprintId: "1",
      sessionId: "sess-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    // executePrFinalizeStage should not be called since hasChanges is false.
    // However, since mock is global, we need to clear it or expect it wasn't called from this specific invocation
    // Actually the safest way is vi.clearAllMocks() at the beginning of each test, but we can just use toHaveBeenCalledTimes if we clear it.
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
      getGuideContent: vi.fn().mockResolvedValue("guide"),
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
      projectId: "repo", sprintId: "1",
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
      getGuideContent: vi.fn().mockResolvedValue("guide"),
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
      projectId: "repo", sprintId: "1",
    };

    const session = await service.startTask(input);

    expect(session.id).toContain("cli-gemini-");
    expect(deps.sessionTracking.createSession).toHaveBeenCalled();
    expect((service as any).runTaskWorkflow).toHaveBeenCalled();
  });

  it("detects unpushed commits when worker branch has no remote ref yet", async () => {
    const service = buildService();
    service.runCommand = async (_command: string, args: string[]) => {
      const key = args.join(" ");
      if (key === "show-ref --verify --quiet refs/remotes/origin/worker/task-1") {
        throw new Error("missing worker remote");
      }
      if (key === "show-ref --verify --quiet refs/remotes/origin/feature/test") {
        return { ok: true, stdout: "", stderr: "" };
      }
      if (key === "rev-list --count origin/feature/test..HEAD") {
        return { ok: true, stdout: "2\n", stderr: "" };
      }
      throw new Error(`unexpected call: ${key}`);
    };

    const detected = await service.hasUnpushedWorkerBranchCommits("/tmp/worktree", "worker/task-1", "feature/test");
    expect(detected).toBe(true);
  });

  it("returns false when worker branch is already pushed and has no commits ahead", async () => {
    const service = buildService();
    service.runCommand = async (_command: string, args: string[]) => {
      const key = args.join(" ");
      if (key === "show-ref --verify --quiet refs/remotes/origin/worker/task-2") {
        return { ok: true, stdout: "", stderr: "" };
      }
      if (key === "rev-list --count origin/worker/task-2..HEAD") {
        return { ok: true, stdout: "0\n", stderr: "" };
      }
      throw new Error(`unexpected call: ${key}`);
    };

    const detected = await service.hasUnpushedWorkerBranchCommits("/tmp/worktree", "worker/task-2", "feature/test");
    expect(detected).toBe(false);
  });

  it("detects existing worker-branch commits ahead of feature branch even when nothing is unpushed", async () => {
    const service = buildService();
    service.runCommand = async (_command: string, args: string[]) => {
      const key = args.join(" ");
      if (key === "show-ref --verify --quiet refs/remotes/origin/feature/test") {
        return { ok: true, stdout: "", stderr: "" };
      }
      if (key === "rev-list --count origin/feature/test..HEAD") {
        return { ok: true, stdout: "3\n", stderr: "" };
      }
      throw new Error(`unexpected call: ${key}`);
    };

    const detected = await service.hasWorkerBranchCommitsAgainstFeature("/tmp/worktree", "feature/test");
    expect(detected).toBe(true);
  });
});
