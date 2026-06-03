import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineContext } from "../../../../../src/services/cli-workflow/pipeline/pipeline-context.js";
import { executeProviderStage } from "../../../../../src/services/cli-workflow/pipeline/execute-provider-stage.js";
import { executeGitFinalizeStage } from "../../../../../src/services/cli-workflow/pipeline/git-finalize-stage.js";
import { executePrepareStage } from "../../../../../src/services/cli-workflow/pipeline/prepare-stage.js";
import { executePrFinalizeStage } from "../../../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js";
import { executeCleanupStage } from "../../../../../src/services/cli-workflow/pipeline/cleanup-stage.js";
import * as providerRetryPolicy from "../../../../../src/shared/providers/provider-retry-policy.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const createMockContext = (): PipelineContext => {
  return {
    sessionId: "test-session",
    workspaceSessionId: "test-session",
    workerBranch: "worker-branch",
    featureBranch: "feature-branch",
    task: { id: "T1", sprint_id: "sprint-1", prompt: "test prompt", title: "test task", state: "PENDING", description: "desc" },
    provider: "gemini",
    title: "test title",
    repoPath: "/repo",
    worktreePath: "/repo/worktree",
    workflowSettings: {
      executionMode: "HOST",
      resumeFailedTaskInSameWorkspace: false,
      retryOnReadFileNotFound: true,
      retryOnQuotaReset: true,
      retryOnRateLimit: true,
      rateLimitRetryDelaySeconds: 10,
      maxRateLimitRetries: 5,
      cleanupWorktreeOnSuccess: true,
      cleanupWorktreeOnFailure: false,
      containerImage: "node:18",
      containerSetupScriptPath: "",
      containerCacheSetupScriptImage: false,
      containerMountGitConfig: false,
      containerMountGithubAuth: false,
      containerMountGeminiAuth: false,
      containerMountCodexAuth: false,
      containerMountClaudeCodeAuth: false,
      containerGithubAuthPath: "",
      containerGeminiAuthPath: "",
      containerCodexAuthPath: "",
      containerClaudeCodeAuthPath: "",
      maxPlanningJsonRetries: 3,
      maxQuotaRetriesWithoutTimer: 5,
    },
    settings: {
      aiProvider: {
        providers: {
          gemini: { apiKey: "key", model: "model", thinkingMode: false, enabled: true, weight: 1 },
          codex: { apiKey: "key", model: "model", thinkingMode: false, enabled: true, weight: 1 },
          "claude-code": { apiKey: "key", model: "model", thinkingMode: false, enabled: true, weight: 1 },
        },
        provider: "gemini",
        strategy: "SINGLE",
        julesApiKey: "jules-key",
      },
      git: {
        autoCreatePr: true,
        githubMode: "LOCAL",
        githubToken: "token",
        defaultBranch: "main",
        featureBranchPrefix: "feature/",
        sprintBranchScheme: "sprint",
      },
      cliWorkflow: {
        cleanupWorktreeOnSuccess: true,
        cleanupWorktreeOnFailure: false,
        retryOnReadFileNotFound: true,
        retryOnQuotaReset: true,
        retryOnRateLimit: true,
        rateLimitRetryDelaySeconds: 10,
        maxRateLimitRetries: 5,
        resumeFailedTaskInSameWorkspace: false,
        executionMode: "HOST",
        containerImage: "node:18",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
        containerMountGitConfig: false,
        containerMountGithubAuth: false,
        containerMountGeminiAuth: false,
        containerMountCodexAuth: false,
        containerMountClaudeCodeAuth: false,
        containerGithubAuthPath: "",
        containerGeminiAuthPath: "",
        containerCodexAuthPath: "",
        containerClaudeCodeAuthPath: "",
        maxPlanningJsonRetries: 3,
        maxQuotaRetriesWithoutTimer: 5,
      },
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
        model: "default",
        maxConcurrency: 1,
        timeoutSeconds: 300,
      },
      dashboardPort: 3000,
      enableDebugLogFile: false,
      automationLevel: "FULL",
      automationInterventions: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoResumePaused: true,
        clarificationAnswerTemplate: "",
        clarificationCooldownSeconds: 300,
      },
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: false,
        resolveAllCommentsBeforeMainMerge: false,
        resolveMainMergeConflicts: false,
        resolveAllCommentsBeforeFeatureMerge: false,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: false,
        julesCiAutofixMaxRetries: 1,
        featurePrAutoMergeMode: "OFF",
        mainBranchAutoMergeMode: "OFF",
      },
      sprintLoopSteps: {
        branchPreflight: true,
        planningPreflight: true,
        loadSubtasks: true,
        sessionSync: true,
        statusDerivation: true,
        startReadyTasks: true,
        mergeProtocol: true,
        actionRequiredProtocol: true,
        statusTable: true,
        watchLoop: true,
        watchLoopIntervalSeconds: 60,
        watchLoopOutputIntervalSeconds: 60,
      },
      agents: {
        saveToProjectDirectory: true,
        instructionTemplates: {},
      },
      skills: [],
      mcpTools: [],
    },
    initialHead: "abcd123",
    workflowSucceeded: false,
    workspaceManager: {
      buildWorktreePath: vi.fn(),
      resolveResumeWorktreePath: vi.fn(),
      prepareWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      buildWorkspaceGuidance: vi.fn(),
    } as any,
    workspaceArtifactService: {
      exportBinaryPatch: vi.fn().mockResolvedValue(""),
      applyPatchToBranch: vi.fn().mockResolvedValue({
        hasChanges: false,
        commitSha: undefined,
        stats: undefined,
      }),
    } as any,
    prService: {
      hasUnpushedCommits: vi.fn(),
      hasWorkerBranchCommitsAgainstFeature: vi.fn(),
      resolveOrCreateFeaturePr: vi.fn(),
    } as any,
    providerRunner: {
      runProvider: vi.fn(),
    } as any,
    deps: {
      sessionTracking: { appendActivity: vi.fn(), updateSession: vi.fn() } as any,
      projectManagementRepository: { getSprint: vi.fn().mockReturnValue({ goal: "Mock Sprint Goal" }) } as any,
      executionRepository: {
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-1" }),
        updateProviderInvocationUsage: vi.fn(),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-1" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        getTaskRun: vi.fn().mockReturnValue({ id: "tr-1", projectId: "p-1" }),
        appendTaskRunEvent: vi.fn(),
      } as any,
      memoryService: {
        listBySprintAndAgent: vi.fn(),
        listLongTermByAgent: vi.fn(),
      } as any,
      getDashboardSettings: vi.fn(),
      getWorkerInstruction: vi.fn(),
      getGithubToken: vi.fn(),
      logger: { error: vi.fn() } as any,
    },
    runCommand: vi.fn(),
  };
};

describe("executePrepareStage", () => {
  it("prepares the worktree and resolves provider prompt", async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("worker guide content");

    const result = await executePrepareStage(ctx);

    expect(result.worktreePath).toBe("/repo/worktree");
    expect(result.initialHead).toBe("head-sha");
    expect(result.providerPrompt).toContain("worker guide content");
    expect(result.providerPrompt).toContain("test prompt");
    expect(result.providerPrompt).toContain("guidance");
    expect(ctx.workspaceManager.prepareWorktree).toHaveBeenCalledWith(
      "/repo",
      "/repo/worktree",
      "worker-branch",
      "feature-branch",
      undefined,
      { githubToken: "token", gitlabToken: undefined },
    );
  });

  it("includes default memory learnings instruction when memory capture is enabled without override", async () => {
    const ctx = createMockContext();
    ctx.settings.memory = {
      enabled: true,
      autoCaptureSprint: true,
      workerLearningsInstruction: "Default Settings Instruction",
      maxLongTermPerProject: 50,
      minLongTermRelevance: 0.7,
      shortTermRetentionSprints: 3,
    };
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");

    const result = await executePrepareStage(ctx);

    expect(result.providerPrompt).toContain("## LEARNINGS CAPTURE (Required)");
    expect(result.providerPrompt).toContain("Default Settings Instruction");
  });

  it("filters injected memories by configured tier, category, strength, and caps", async () => {
    const ctx = createMockContext();
    ctx.settings.memory = {
      enabled: true,
      autoCaptureSprint: false,
      workerLearningsInstruction: "Default Settings Instruction",
      maxLongTermPerProject: 50,
      minLongTermRelevance: 0.7,
      shortTermRetentionSprints: 3,
    };
    ctx.agentPresetId = "agent-1";
    ctx.taskRunId = "run-1";
    ctx.agentMemoryConfig = {
      tier: "long_term",
      categories: ["codebase"],
      minStrength: 4,
      minStrengthPerCategory: { codebase: 5 },
      maxShortTerm: 0,
      maxLongTerm: 1,
    };
    const memoryService = ctx.deps.memoryService as any;
    memoryService.listBySprintAndAgent.mockReturnValue([
      { category: "codebase", content: "short-term should not appear", strength: 10 },
    ]);
    memoryService.listLongTermByAgent.mockReturnValue([
      { category: "patterns", content: "wrong category", strength: 10 },
      { category: "codebase", content: "below category threshold", strength: 4 },
      { category: "codebase", content: "kept long-term memory", strength: 6 },
    ]);
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");
    (ctx.deps.executionRepository as any).getTaskRun.mockReturnValue({ id: "tr-1", projectId: "p-1", sprintId: "sprint-1" });

    const result = await executePrepareStage(ctx);

    expect(memoryService.listBySprintAndAgent).not.toHaveBeenCalled();
    expect(memoryService.listLongTermByAgent).toHaveBeenCalledWith("p-1", "agent-1", 100);
    expect(result.providerPrompt).toContain("## MEMORY CONTEXT");
    expect(result.providerPrompt).toContain("### Long-Term Knowledge");
    expect(result.providerPrompt).not.toContain("### Recent Sprint Learnings");
    expect(result.providerPrompt).toContain("kept long-term memory");
    expect(result.providerPrompt).not.toContain("wrong category");
    expect(result.providerPrompt).not.toContain("below category threshold");
    expect(result.providerPrompt).not.toContain("short-term should not appear");
  });

  it("injects both memory tiers when no agent memory config is present", async () => {
    const ctx = createMockContext();
    ctx.settings.memory = {
      enabled: true,
      autoCaptureSprint: false,
      workerLearningsInstruction: "Default Settings Instruction",
      maxLongTermPerProject: 50,
      minLongTermRelevance: 0.7,
      shortTermRetentionSprints: 3,
    };
    ctx.agentPresetId = "agent-1";
    ctx.taskRunId = "run-1";
    const memoryService = ctx.deps.memoryService as any;
    memoryService.listBySprintAndAgent.mockReturnValue([
      { category: "learning", content: "short-term memory", strength: 1 },
    ]);
    memoryService.listLongTermByAgent.mockReturnValue([
      { category: "decision", content: "long-term memory", strength: 1 },
    ]);
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");
    (ctx.deps.executionRepository as any).getTaskRun.mockReturnValue({ id: "tr-1", projectId: "p-1", sprintId: "sprint-1" });

    const result = await executePrepareStage(ctx);

    expect(memoryService.listBySprintAndAgent).toHaveBeenCalledWith("p-1", "sprint-1", "agent-1", 100);
    expect(memoryService.listLongTermByAgent).toHaveBeenCalledWith("p-1", "agent-1", 100);
    expect(result.providerPrompt).toContain("short-term memory");
    expect(result.providerPrompt).toContain("long-term memory");
  });

  it("uses preset override memory learnings instruction when override is enabled and non-empty", async () => {
    const ctx = createMockContext();
    ctx.settings.memory = {
      enabled: true,
      autoCaptureSprint: true,
      workerLearningsInstruction: "Default Settings Instruction",
      maxLongTermPerProject: 50,
      minLongTermRelevance: 0.7,
      shortTermRetentionSprints: 3,
    };
    ctx.memoryTemplateOverrideEnabled = true;
    ctx.memoryTemplateMarkdown = "Preset Override Instruction";
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");

    const result = await executePrepareStage(ctx);

    expect(result.providerPrompt).toContain("## LEARNINGS CAPTURE (Required)");
    expect(result.providerPrompt).toContain("Preset Override Instruction");
    expect(result.providerPrompt).not.toContain("Default Settings Instruction");
  });

  it("falls back to default memory learnings instruction when override is enabled but template is empty", async () => {
    const ctx = createMockContext();
    ctx.settings.memory = {
      enabled: true,
      autoCaptureSprint: true,
      workerLearningsInstruction: "Default Settings Instruction",
      maxLongTermPerProject: 50,
      minLongTermRelevance: 0.7,
      shortTermRetentionSprints: 3,
    };
    ctx.memoryTemplateOverrideEnabled = true;
    ctx.memoryTemplateMarkdown = "   \n"; // empty string behavior
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");

    const result = await executePrepareStage(ctx);

    expect(result.providerPrompt).toContain("## LEARNINGS CAPTURE (Required)");
    expect(result.providerPrompt).toContain("Default Settings Instruction");
  });

  it("handles FF-merge during resume properly", async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.workspaceManager.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: true });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });

    await executePrepareStage(ctx, "old-session");

    expect(ctx.runCommand).toHaveBeenCalledWith("git", ["merge", "--ff-only", "origin/feature-branch"], "/repo/worktree");
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: expect.stringContaining("Resumed failed workspace")
    }));
  });
});

describe("executeProviderStage", () => {
  it("throws an error if provider run fails without retry conditions", async () => {
    const ctx = createMockContext();
    ctx.workflowSettings.retryOnReadFileNotFound = false;
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "fatal provider error", usageTelemetry: { transcriptText: "error transcript", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "estimated", rawUsageJson: "{}" } as any });

    await expect(executeProviderStage(ctx, "prompt")).rejects.toThrow("fatal provider error");
    expect(ctx.deps.executionRepository?.createExecutionInvocation).toHaveBeenCalled();
    expect(ctx.deps.executionRepository?.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-1", {
      role: "user",
      contentMarkdown: "prompt",
    });
    expect(ctx.deps.executionRepository?.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-1", {
      role: "tool",
      contentMarkdown: "fatal provider error",
    });
    expect(ctx.deps.executionRepository?.updateExecutionInvocation).toHaveBeenCalledWith("exec-1", expect.objectContaining({ status: "failed" }));
  });

  it("retries if retryOnReadFileNotFound is true and error is a read file not found error", async () => {
    const ctx = createMockContext();
    ctx.workflowSettings.retryOnReadFileNotFound = true;

    // Simulate first failure due to not found
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({
      ok: false,
      stdout: "",
      stderr: "error executing tool read_file: file not found",
      usageTelemetry: { transcriptText: "fail1 transcript" } as any,
    });
    // Simulate second success
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({ ok: true, stdout: "success", stderr: "", usageTelemetry: { transcriptText: "success transcript" } as any });

    await executeProviderStage(ctx, "prompt");
    expect(ctx.providerRunner.runProvider).toHaveBeenCalledTimes(2);
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Retrying with file-discovery guidance."
    }));

    // Check system fallback message for retry
    expect(ctx.deps.executionRepository?.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-1", expect.objectContaining({
      role: "system",
      contentMarkdown: "Retrying with file-discovery guidance.",
    }));
  });

  it("continues the native provider session when retrying after a rate limit", async () => {
    const ctx = createMockContext();
    vi.spyOn(providerRetryPolicy, "sleepWithSignal").mockResolvedValue();
    vi.mocked(ctx.providerRunner.runProvider)
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stdout: "",
        stderr: "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'",
        nativeSessionId: "native-rate-limit",
        usageTelemetry: { transcriptText: "" } as any,
      })
      .mockResolvedValueOnce({
        ok: true,
        code: 0,
        stdout: "success",
        stderr: "",
        nativeSessionId: "native-rate-limit",
        usageTelemetry: { transcriptText: "success transcript" } as any,
      });

    await executeProviderStage(ctx, "prompt");

    expect(ctx.providerRunner.runProvider).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ctx.providerRunner.runProvider).mock.calls[1]?.[0]?.continueSessionId).toBe("native-rate-limit");
  });

  it("stops retrying rate-limited provider runs after the configured max", async () => {
    const ctx = createMockContext();
    ctx.workflowSettings.maxRateLimitRetries = 1;
    vi.spyOn(providerRetryPolicy, "sleepWithSignal").mockResolvedValue();
    vi.mocked(ctx.providerRunner.runProvider)
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stdout: "",
        stderr: "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'",
        nativeSessionId: "native-rate-limit",
        usageTelemetry: { transcriptText: "" } as any,
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stdout: "",
        stderr: "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'",
        nativeSessionId: "native-rate-limit",
        usageTelemetry: { transcriptText: "" } as any,
      });

    await expect(executeProviderStage(ctx, "prompt")).rejects.toThrow("rate-limited");

    expect(ctx.providerRunner.runProvider).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ctx.providerRunner.runProvider).mock.calls[1]?.[0]?.continueSessionId).toBe("native-rate-limit");
    expect(providerRetryPolicy.sleepWithSignal).toHaveBeenCalledTimes(1);
  });
});

describe("executeGitFinalizeStage", () => {
  it("returns { hasChanges: false } when there are no changes or unpushed commits", async () => {
    const ctx = createMockContext();

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(false);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(false);

    const result = await executeGitFinalizeStage(ctx);

    expect(result.hasChanges).toBe(false);
    expect(ctx.workflowSucceeded).toBe(true);
    expect(ctx.workspaceArtifactService.exportBinaryPatch).toHaveBeenCalledWith(ctx.worktreePath, ctx.initialHead);
    expect(ctx.workspaceArtifactService.applyPatchToBranch).toHaveBeenCalledWith({
      repoPath: ctx.repoPath,
      baseRef: ctx.initialHead,
      workerBranch: ctx.workerBranch,
      patchText: "",
      commitMessage: `feat(task ${ctx.task.id}): implement via ${ctx.provider}`,
      gitAuth: { githubToken: "token", gitlabToken: undefined },
    });
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED" });
  });

  it("applies exported patch results when the isolated workspace has changes", async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.workspaceArtifactService.exportBinaryPatch).mockResolvedValue("diff --git a/file.txt b/file.txt");
    vi.mocked(ctx.workspaceArtifactService.applyPatchToBranch).mockResolvedValue({
      hasChanges: true,
      commitSha: "deadbeef",
      stats: {
        filesChanged: 1,
        insertions: 3,
        deletions: 1,
      },
    });

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(false);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(false);

    const result = await executeGitFinalizeStage(ctx);

    expect(result.hasChanges).toBe(true);
    expect(result.committedChanges).toBe(true);
    expect(result.commitSha).toBe("deadbeef");
    expect(result.stats).toEqual({
      filesChanged: 1,
      insertions: 3,
      deletions: 1,
    });
    expect(ctx.workspaceArtifactService.applyPatchToBranch).toHaveBeenCalledTimes(1);
    expect(ctx.runCommand).not.toHaveBeenCalled();
  });

  it("pushes an existing local worker-branch commit when the provider committed directly in the workspace", async () => {
    const ctx = createMockContext();

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(true);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(true);
    vi.mocked(ctx.runCommand)
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, stdout: "feedbeef\n", stderr: "" });

    const result = await executeGitFinalizeStage(ctx);

    expect(ctx.runCommand).toHaveBeenNthCalledWith(
      1,
      "git",
      ["push", "-u", "origin", "refs/heads/worker-branch:refs/heads/worker-branch"],
      "/repo",
      expect.anything(),
    );
    expect(ctx.runCommand).toHaveBeenNthCalledWith(
      2,
      "git",
      ["rev-parse", "refs/heads/worker-branch"],
      "/repo",
    );
    expect(result).toEqual({
      hasChanges: true,
      committedChanges: true,
      pushedBranch: "worker-branch",
      commitSha: "feedbeef",
    });
  });
});

describe("executePrFinalizeStage", () => {
  it("resolves PR and updates session state to COMPLETED", async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.prService.resolveOrCreateFeaturePr).mockResolvedValue("https://github.com/pr/1");

    await executePrFinalizeStage(ctx);

    expect(ctx.workflowSucceeded).toBe(true);
    expect(ctx.prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "T1",
        provider: "gemini",
        title: "test title",
        featureBranch: "feature-branch",
        workerBranch: "worker-branch",
        taskDescription: "test prompt",
        sprintDescription: "Mock Sprint Goal",
      }),
      ctx.repoPath,
      {
        githubToken: "token",
        gitlabToken: undefined,
      }
    );
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED", prUrl: "https://github.com/pr/1" });
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Workflow completed. PR: https://github.com/pr/1"
    }));
  });

  it("skips PR creation if autoCreatePr is false", async () => {
    const ctx = createMockContext();
    ctx.settings.git.autoCreatePr = false;

    await executePrFinalizeStage(ctx);

    expect(ctx.prService.resolveOrCreateFeaturePr).not.toHaveBeenCalled();
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED", prUrl: undefined });
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Workflow completed without PR because auto-create PRs are disabled.",
    }));
  });

  it("fails loudly if autoCreatePr is enabled but no PR URL is returned", async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.prService.resolveOrCreateFeaturePr).mockResolvedValue(undefined);

    await expect(executePrFinalizeStage(ctx))
      .rejects
      .toThrow("Feature PR creation completed without a PR URL for worker-branch");

    expect(ctx.workflowSucceeded).toBe(false);
    expect(ctx.deps.sessionTracking.updateSession).not.toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      state: "COMPLETED",
    }));
  });
});

describe("executeCleanupStage", () => {
  it("removes the worktree if cleanupWorktreeOnSuccess is true and workflow succeeded", async () => {
    const ctx = createMockContext();
    ctx.workflowSucceeded = true;
    ctx.workflowSettings.cleanupWorktreeOnSuccess = true;

    await executeCleanupStage(ctx);

    expect(ctx.workspaceManager.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/worktree");
  });

  it("preserves the worktree if cleanupWorktreeOnSuccess is false and workflow succeeded", async () => {
    const ctx = createMockContext();
    ctx.workflowSucceeded = true;
    ctx.workflowSettings.cleanupWorktreeOnSuccess = false;

    await executeCleanupStage(ctx);

    expect(ctx.workspaceManager.removeWorktree).not.toHaveBeenCalled();
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: expect.stringContaining("Preserving worktree")
    }));
  });

  it("preserves the worktree for active sprint tasks even when success cleanup is enabled", async () => {
    const ctx = createMockContext();
    ctx.workflowSucceeded = true;
    ctx.workflowSettings.cleanupWorktreeOnSuccess = true;
    ctx.preserveSuccessfulWorktreeForActiveSprint = true;

    await executeCleanupStage(ctx);

    expect(ctx.workspaceManager.removeWorktree).not.toHaveBeenCalled();
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: expect.stringContaining("Preserving worktree")
    }));
  });
});
