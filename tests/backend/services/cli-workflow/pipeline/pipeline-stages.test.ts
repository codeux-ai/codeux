import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineContext } from "../../../../../src/services/cli-workflow/pipeline/pipeline-context.js";
import { executeProviderStage } from "../../../../../src/services/cli-workflow/pipeline/execute-provider-stage.js";
import { executeGitFinalizeStage } from "../../../../../src/services/cli-workflow/pipeline/git-finalize-stage.js";
import { executePrepareStage } from "../../../../../src/services/cli-workflow/pipeline/prepare-stage.js";
import { executePrFinalizeStage } from "../../../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js";
import { executeCleanupStage } from "../../../../../src/services/cli-workflow/pipeline/cleanup-stage.js";
import * as providerRetryPolicy from "../../../../../src/shared/providers/provider-retry-policy.js";
import { DEFAULT_TASK_SECTION_ORDER, DEFAULT_SPRINT_SECTION_ORDER } from "../../../../../src/domain/sprint/composer/pr-description-composer.js";
import { beginRuntimeShutdown, resetRuntimeShutdownForTests } from "../../../../../src/services/shutdown-state.js";
import { workerClarificationAgentMcpAccess } from "../../../../../src/services/agent-mcp-access.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetRuntimeShutdownForTests();
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
    allowExistingWorkerBranch: false,
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
          gemini: { apiKey: "key", model: "model", thinkingMode: false, enabled: true, weight: 1, maxConcurrentTasks: 0 },
          codex: { apiKey: "key", model: "model", thinkingMode: false, enabled: true, weight: 1, maxConcurrentTasks: 0 },
          "claude-code": { apiKey: "key", model: "model", thinkingMode: false, enabled: true, weight: 1, maxConcurrentTasks: 0 },
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
        sprintKeyPrefix: "SPR",
        taskPrTitleScheme: "({sprint_tag}) {task_title}",
        prDescription: {
          task: { summary: true, modelAndProvider: true, timing: true, fullPrompt: true, tokenUsage: true, qaFindings: true, branchInfo: true },
          sprint: { summary: true, taskChecklist: true, providerBreakdown: true, planningModel: true, mainPrompt: true, timing: true, tokenUsage: true, qaFindings: true, branchInfo: true },
          taskSectionOrder: [...DEFAULT_TASK_SECTION_ORDER],
          sprintSectionOrder: [...DEFAULT_SPRINT_SECTION_ORDER],
        },
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
      consoleLogLevel: "info",
      debugLogFileLevel: "error",
      consoleLogMode: "standard",
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
    taskClarificationContext: {
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-record-1",
      taskRunId: "task-run-1",
      sessionId: "test-session",
    },
    workspaceManager: {
      buildWorktreePath: vi.fn(),
      resolveResumeWorktreePath: vi.fn(),
      prepareWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      releaseWorkspaceHelper: vi.fn(),
      buildWorkspaceGuidance: vi.fn(),
    } as any,
    invocationWorkspacePreparer: {
      prepareWorktree: vi.fn(),
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
      projectManagementRepository: {
        getSprint: vi.fn().mockReturnValue({
          id: "sprint-1",
          number: 1,
          slug: "sprint-1",
          name: "Mock Sprint",
          goal: "Mock Sprint Goal",
          linkedIssues: [],
        }),
      } as any,
      executionRepository: {
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-1" }),
        updateProviderInvocationUsage: vi.fn(),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-1" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        getTaskRun: vi.fn().mockReturnValue({ id: "tr-1", projectId: "p-1" }),
        appendTaskRunEvent: vi.fn(),
        getTaskUsageGroups: vi.fn().mockReturnValue([]),
        listProviderInvocationsForTask: vi.fn().mockReturnValue([]),
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
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({
      worktreePath: "/repo/worktree",
      resumed: false,
      createdFreshWorkerBranch: true,
    });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("worker guide content");

    const result = await executePrepareStage(ctx);

    expect(result.worktreePath).toBe("/repo/worktree");
    expect(result.initialHead).toBe("head-sha");
    expect(ctx.freshWorkerBranchOwnership).toEqual({
      worktreePath: "/repo/worktree",
      initialTip: "head-sha",
    });
    expect(result.providerPrompt).toContain("worker guide content");
    expect(result.providerPrompt).toContain("test prompt");
    expect(result.providerPrompt).toContain("guidance");
    expect(result.providerPrompt).toContain("call `request_clarification`");
    expect(result.providerPrompt).toContain("projectId=project-1");
    expect(result.providerPrompt).toContain("taskId=task-record-1");
    expect(result.providerPrompt).toContain("sessionId=test-session");
    expect(result.providerPrompt).toContain("Do not call `reply_to_clarification`");
    expect(result.providerPrompt).toContain("CODE_UX_TASK_OUTCOME: blocked");
    expect(ctx.invocationWorkspacePreparer.prepareWorktree).toHaveBeenCalledWith({
      repoPath: "/repo",
      worktreePath: "/repo/worktree",
      workerBranch: "worker-branch",
      featureBranch: "feature-branch",
      resumeSessionId: undefined,
      allowExistingWorkerBranch: false,
      gitAuth: { githubToken: "token", gitlabToken: undefined },
      gitPolicy: {
        githubMode: "LOCAL",
        defaultBranch: "main",
        githubToken: "token",
        gitlabToken: undefined,
      },
    });
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
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
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
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");
    (ctx.deps.executionRepository as any).getTaskRun.mockReturnValue({ id: "tr-1", projectId: "p-1", sprintId: "sprint-1" });

    const result = await executePrepareStage(ctx);

    expect(memoryService.listBySprintAndAgent).not.toHaveBeenCalled();
    expect(memoryService.listLongTermByAgent).toHaveBeenCalledWith("p-1", "agent-1", 100);
    expect(result.providerPrompt).toContain("## RELEVANT MEMORY CONTEXT");
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
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
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
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
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
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: false });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });
    vi.mocked(ctx.deps.getWorkerInstruction).mockResolvedValue("");

    const result = await executePrepareStage(ctx);

    expect(result.providerPrompt).toContain("## LEARNINGS CAPTURE (Required)");
    expect(result.providerPrompt).toContain("Default Settings Instruction");
  });

  it("handles FF-merge during resume properly", async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.invocationWorkspacePreparer.prepareWorktree).mockResolvedValue({ worktreePath: "/repo/worktree", resumed: true });
    vi.mocked(ctx.workspaceManager.buildWorkspaceGuidance).mockResolvedValue("guidance");
    vi.mocked(ctx.runCommand).mockResolvedValue({ ok: true, stdout: "head-sha\n", stderr: "" });

    const result = await executePrepareStage(ctx, "old-session");

    expect(ctx.runCommand).toHaveBeenCalledWith("git", ["merge", "--ff-only", "origin/feature-branch"], "/repo/worktree");
    expect(result.providerPrompt).toContain("test prompt");
    expect(result.providerPrompt).toContain("call `request_clarification`");
    expect(result.providerPrompt).toContain("CODE_UX_TASK_OUTCOME: blocked");
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: expect.stringContaining("Resumed failed workspace")
    }));
  });
});

describe("executeProviderStage", () => {
  it("reuses the preparation invocation and defers its completion past provider execution", async () => {
    const ctx = createMockContext();
    const executionInvocation = {
      id: "exec-prepared",
      status: "running",
      providerInvocationId: null as string | null,
    };
    ctx.executionInvocationId = executionInvocation.id;
    ctx.deps.executionRepository!.getExecutionInvocation = vi.fn().mockReturnValue(executionInvocation as any);
    vi.mocked(ctx.deps.executionRepository!.updateExecutionInvocation).mockImplementation((_id, input) => {
      Object.assign(executionInvocation, input);
      return executionInvocation as any;
    });
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({
      ok: true,
      stdout: "success",
      stderr: "",
      usageTelemetry: { transcriptText: "success transcript" } as any,
    });

    await executeProviderStage(ctx, "prompt");

    expect(ctx.deps.executionRepository!.createExecutionInvocation).not.toHaveBeenCalled();
    expect(ctx.deps.executionRepository!.createProviderInvocationUsage).toHaveBeenCalledOnce();
    expect(executionInvocation).toMatchObject({
      status: "running",
      providerInvocationId: "usage-1",
    });
    expect(ctx.deps.executionRepository!.updateExecutionInvocation).not.toHaveBeenCalledWith(
      "exec-prepared",
      expect.objectContaining({ status: "completed" }),
    );
    expect(ctx.deps.executionRepository!.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-prepared", {
      role: "user",
      contentMarkdown: "prompt",
    });
  });

  it("passes the narrow clarification gateway and worker identity to a task-coding provider run", async () => {
    const ctx = createMockContext();
    ctx.agentPresetId = "assigned-worker";
    ctx.agentMcpAccess = workerClarificationAgentMcpAccess({
      codeUxEnabled: false,
      codeUxToolToggles: [],
      linkedServerIds: [],
    });
    ctx.deps.getMcpConnectionInfo = () => ({
      url: "http://127.0.0.1:4445/mcp",
      authToken: "token",
    });
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({
      ok: true,
      stdout: "success",
      stderr: "",
      usageTelemetry: { transcriptText: "success transcript" } as any,
    });

    await executeProviderStage(ctx, "prompt");

    expect(ctx.providerRunner.runProvider).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "task_coding",
      mcpConnection: {
        url: "http://127.0.0.1:4445/mcp",
        authToken: "token",
        agentId: "assigned-worker",
      },
    }));
  });

  it("requires a real preserved provider conversation for clarification continuation", async () => {
    const ctx = createMockContext();
    ctx.provider = "claude-code";
    ctx.workspaceSessionId = "source-workspace-session";
    ctx.requireProviderSessionResume = true;
    ctx.deps.executionRepository!.getLatestProviderInvocationUsageBySession = vi.fn().mockReturnValue({
      id: "provider-source",
      nativeSessionId: "claude-native-session",
      model: "claude-model",
    });
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({
      ok: true,
      stdout: "continued",
      stderr: "",
      usageTelemetry: { transcriptText: "continued transcript" } as any,
    });

    await executeProviderStage(ctx, "continue with the manager answer");

    expect(ctx.providerRunner.runProvider).toHaveBeenCalledWith(expect.objectContaining({
      continueSessionId: "claude-native-session",
      allowFreshSessionFallback: false,
    }));
  });

  it("rejects clarification continuation when no prior provider invocation exists", async () => {
    const ctx = createMockContext();
    ctx.requireProviderSessionResume = true;
    ctx.workspaceSessionId = "missing-workspace-session";
    ctx.deps.executionRepository!.getLatestProviderInvocationUsageBySession = vi.fn().mockReturnValue(null);

    await expect(executeProviderStage(ctx, "continue")).rejects.toThrow(/no prior gemini invocation/i);
    expect(ctx.providerRunner.runProvider).not.toHaveBeenCalled();
  });

  it("throws an error if provider run fails without retry conditions", async () => {
    const ctx = createMockContext();
    ctx.workflowSettings.retryOnReadFileNotFound = false;
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "fatal provider error", usageTelemetry: { transcriptText: "error transcript", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "estimated", rawUsageJson: "{}" } as any });

    await expect(executeProviderStage(ctx, "prompt")).rejects.toThrow("fatal provider error");
    expect(ctx.providerRunner.runProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        gitPolicy: expect.objectContaining({
          githubMode: "LOCAL",
          defaultBranch: "main",
        }),
      }),
    );
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

  it("uses the selected provider instance concurrency cap from the provider override", async () => {
    const ctx = createMockContext();
    ctx.providerSettingsOverride = {
      model: "custom-model",
      thinkingMode: "HIGH",
      apiKey: "key",
      maxConcurrentTasks: 2,
    };
    ctx.deps.providerConcurrencyService = {
      waitForSlotAndClaim: vi.fn().mockResolvedValue({ id: "usage-override" }),
    } as any;
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValueOnce({
      ok: true,
      stdout: "success",
      stderr: "",
      usageTelemetry: { transcriptText: "success transcript" } as any,
    });

    await executeProviderStage(ctx, "prompt");

    expect(ctx.deps.providerConcurrencyService.waitForSlotAndClaim).toHaveBeenCalledWith(
      "gemini",
      2,
      expect.objectContaining({
        provider: "gemini",
        purpose: "task_coding",
      }),
      undefined,
      undefined,
      "exec-1",
    );
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

  it("never passes the logical task workspace id as a Codex native resume id", async () => {
    const ctx = createMockContext();
    ctx.provider = "codex";
    (ctx.deps.executionRepository as any).getLatestProviderInvocationUsageBySession = vi.fn().mockReturnValue({
      sessionId: ctx.workspaceSessionId,
      nativeSessionId: null,
      provider: "codex",
      purpose: "task_coding",
    });
    vi.mocked(ctx.providerRunner.runProvider).mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "success",
      stderr: "",
      nativeSessionId: null,
      usageTelemetry: { transcriptText: "success transcript" } as any,
    });

    await executeProviderStage(ctx, "prompt");

    expect(ctx.providerRunner.runProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      sessionId: "test-session",
      workspaceSessionId: "test-session",
      continueSessionId: null,
      continueSessionWithoutNativeId: true,
    }));
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
    ctx.freshWorkerBranchOwnership = {
      worktreePath: ctx.worktreePath,
      initialTip: ctx.initialHead,
    };

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
      gitIdentity: undefined,
      githubMode: "LOCAL",
      allowExistingWorkerBranch: false,
      freshWorkerBranchOwnership: {
        worktreePath: ctx.worktreePath,
        initialTip: ctx.initialHead,
      },
    });
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED" });
  });

  it("does not trust an empty patch as no-output while runtime shutdown is in progress", async () => {
    const ctx = createMockContext();

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(false);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(false);
    beginRuntimeShutdown();

    await expect(executeGitFinalizeStage(ctx)).rejects.toThrow("Runtime shutdown interrupted git finalization");

    expect(ctx.workflowSucceeded).toBeFalsy();
    expect(ctx.deps.sessionTracking.updateSession).not.toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED" });
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
    ctx.settings.git.githubMode = "REMOTE";

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(true);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(true);
    vi.mocked(ctx.runCommand)
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, stdout: "feedbeef\n", stderr: "" });

    const result = await executeGitFinalizeStage(ctx);

    expect(ctx.runCommand).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "push",
        "-u",
        "--force-with-lease=refs/heads/worker-branch:",
        "origin",
        "refs/heads/worker-branch:refs/heads/worker-branch",
      ],
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

  it("accepts an ambiguous direct fresh-branch push when the remote contains the local tip", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "REMOTE";
    const branchTip = "1".repeat(40);

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(true);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(true);
    vi.mocked(ctx.runCommand)
      .mockRejectedValueOnce(new Error("git push failed: exit code 137, no output captured"))
      .mockResolvedValueOnce({ ok: true, stdout: `${branchTip}\n`, stderr: "" })
      .mockResolvedValueOnce({
        ok: true,
        stdout: `${branchTip}\trefs/heads/worker-branch\n`,
        stderr: "",
      })
      .mockResolvedValueOnce({ ok: true, stdout: `${branchTip}\n`, stderr: "" });

    const result = await executeGitFinalizeStage(ctx);

    expect(ctx.runCommand).toHaveBeenNthCalledWith(
      2,
      "git",
      ["rev-parse", "--verify", "refs/heads/worker-branch"],
      "/repo",
      expect.anything(),
    );
    expect(ctx.runCommand).toHaveBeenNthCalledWith(
      3,
      "git",
      ["ls-remote", "--heads", "origin", "refs/heads/worker-branch"],
      "/repo",
      expect.anything(),
    );
    expect(ctx.runCommand.mock.calls.filter((call) => call[1][0] === "push")).toHaveLength(1);
    expect(result.commitSha).toBe(branchTip);
  });

  it("allows a resumed invocation to advance its existing remote worker branch", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "REMOTE";
    ctx.allowExistingWorkerBranch = true;

    vi.mocked(ctx.prService.hasUnpushedCommits).mockResolvedValue(true);
    vi.mocked(ctx.prService.hasWorkerBranchCommitsAgainstFeature).mockResolvedValue(true);
    vi.mocked(ctx.runCommand)
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, stdout: "feedbeef\n", stderr: "" });

    await executeGitFinalizeStage(ctx);

    expect(ctx.runCommand).toHaveBeenNthCalledWith(
      1,
      "git",
      ["push", "-u", "origin", "refs/heads/worker-branch:refs/heads/worker-branch"],
      "/repo",
      expect.anything(),
    );
  });
});

describe("executePrFinalizeStage", () => {
  it("resolves PR and updates session state to COMPLETED", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "REMOTE";
    ctx.settings.git.taskPrTitleScheme = "({sprint_tag}) {task_key}: {task_title}";
    ctx.task.id = "Task 1";
    ctx.task.title = "Wire task PR titles";
    vi.mocked(ctx.deps.projectManagementRepository!.getSprint).mockReturnValue({
      id: "sprint-40",
      number: 40,
      slug: "title-formatting",
      name: "Title formatting",
      goal: "Mock Sprint Goal",
      linkedIssues: [{ issueKey: "CODUX-40" }],
    });
    vi.mocked(ctx.prService.resolveOrCreateFeaturePr).mockResolvedValue("https://github.com/pr/1");

    await executePrFinalizeStage(ctx);

    expect(ctx.workflowSucceeded).toBe(true);
    expect(ctx.prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "Task 1",
        provider: "gemini",
        title: "(CODUX-40) Task 1: Wire task PR titles",
        featureBranch: "feature-branch",
        workerBranch: "worker-branch",
        body: expect.stringContaining("test prompt"),
      }),
      ctx.repoPath,
      {
        githubToken: "token",
        gitlabToken: undefined,
      }
    );
    expect(ctx.prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Mock Sprint Goal") }),
      ctx.repoPath,
      expect.anything(),
    );
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED", prUrl: "https://github.com/pr/1" });
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Workflow completed. PR: https://github.com/pr/1"
    }));
  });

  it("falls back to the sprint key when no linked issue exists", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "REMOTE";
    ctx.settings.git.taskPrTitleScheme = "({sprint_tag}) {task_key}: {task_title}";
    vi.mocked(ctx.deps.projectManagementRepository!.getSprint).mockReturnValue({
      id: "sprint-40",
      number: 40,
      slug: "title-formatting",
      name: "Title formatting",
      goal: "Mock Sprint Goal",
      linkedIssues: [],
    });
    vi.mocked(ctx.prService.resolveOrCreateFeaturePr).mockResolvedValue("https://github.com/pr/1");

    await executePrFinalizeStage(ctx);

    expect(ctx.prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "(SPR-40) T1: test task",
      }),
      ctx.repoPath,
      expect.anything(),
    );
  });

  it("renders completion timing in the task PR body while the task run row is still open", async () => {
    const ctx = createMockContext();
    ctx.taskRunId = "tr-1";
    ctx.settings.git.githubMode = "REMOTE";
    vi.mocked(ctx.deps.executionRepository!.getTaskRun).mockReturnValue({
      id: "tr-1",
      projectId: "p-1",
      sprintId: "sprint-1",
      sprintRunId: "sprint-run-1",
      taskId: "task-1",
      dispatchId: "dispatch-1",
      connectionId: null,
      provider: "codex",
      mode: "docker_cli",
      sessionId: "test-session",
      sessionName: null,
      state: "RUNNING",
      workerBranch: "worker-branch",
      prUrl: null,
      startedAt: "2026-07-03T02:18:16.000Z",
      finishedAt: null,
      durationMs: null,
    });
    vi.mocked(ctx.prService.resolveOrCreateFeaturePr).mockResolvedValue("https://github.com/pr/1");

    await executePrFinalizeStage(ctx, { completionTimestamp: "2026-07-03T02:31:30.000Z" });

    expect(ctx.prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("| Finished | 2026-07-03 02:31:30 UTC |"),
      }),
      ctx.repoPath,
      expect.anything(),
    );
    expect(ctx.prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("| Duration | 13m 14s |"),
      }),
      ctx.repoPath,
      expect.anything(),
    );
  });

  it("skips PR creation if autoCreatePr is false", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "REMOTE";
    ctx.settings.git.autoCreatePr = false;

    await executePrFinalizeStage(ctx);

    expect(ctx.prService.resolveOrCreateFeaturePr).not.toHaveBeenCalled();
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED", prUrl: undefined });
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Workflow completed without PR because auto-create PRs are disabled.",
    }));
  });

  it("skips remote PR creation in LOCAL git mode and reports the local merge handoff", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "LOCAL";
    ctx.settings.git.autoCreatePr = true;

    await executePrFinalizeStage(ctx);

    expect(ctx.prService.resolveOrCreateFeaturePr).not.toHaveBeenCalled();
    expect(ctx.workflowSucceeded).toBe(true);
    expect(ctx.deps.sessionTracking.updateSession).toHaveBeenCalledWith(ctx.sessionId, { state: "COMPLETED", prUrl: undefined });
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: "Workflow completed. Worker branch worker-branch is ready to merge locally into feature-branch.",
    }));
  });

  it("fails loudly if autoCreatePr is enabled but no PR URL is returned", async () => {
    const ctx = createMockContext();
    ctx.settings.git.githubMode = "REMOTE";
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
    expect(ctx.workspaceManager.releaseWorkspaceHelper).not.toHaveBeenCalled();
  });

  it("preserves the worktree if cleanupWorktreeOnSuccess is false and workflow succeeded", async () => {
    const ctx = createMockContext();
    ctx.workflowSucceeded = true;
    ctx.workflowSettings.cleanupWorktreeOnSuccess = false;

    await executeCleanupStage(ctx);

    expect(ctx.workspaceManager.removeWorktree).not.toHaveBeenCalled();
    expect(ctx.workspaceManager.releaseWorkspaceHelper).toHaveBeenCalledWith("/repo/worktree");
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
    expect(ctx.workspaceManager.releaseWorkspaceHelper).toHaveBeenCalledWith("/repo/worktree");
    expect(ctx.deps.sessionTracking.appendActivity).toHaveBeenCalledWith(ctx.sessionId, expect.objectContaining({
      description: expect.stringContaining("Preserving worktree")
    }));
  });

  it("preserves a successful no-change worktree while manager clarification is pending", async () => {
    const ctx = createMockContext();
    ctx.workflowSucceeded = true;
    ctx.workflowSettings.cleanupWorktreeOnSuccess = true;
    ctx.preserveWorkspaceForClarification = true;

    await executeCleanupStage(ctx);

    expect(ctx.workspaceManager.removeWorktree).not.toHaveBeenCalled();
    expect(ctx.workspaceManager.releaseWorkspaceHelper).toHaveBeenCalledWith("/repo/worktree");
  });
});
