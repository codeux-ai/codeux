import { describe, expect, it } from "vitest";
import { validateSettingsPayload } from "../../../../src/domain/settings/settings-schema.js";

/**
 * Minimal valid payload that passes all non-token validation gates.
 * Uses DEFAULT_DASHBOARD_SETTINGS as a structural reference.
 */
function makeBasePayload() {
  return {
    dashboardPort: 4444,
    consoleLogLevel: "info",
    debugLogFileLevel: "error",
    consoleLogMode: "standard",
    dbAutoVacuumOnStartup: true,
    dbPruningEnabled: true,
    dbRetentionDays: 14,
    automationLevel: "SEMI_AUTO",
    automationInterventions: {
      autoApprovePlan: true,
      autoAnswerClarification: false,
      autoAnswerClarificationMode: "TEMPLATE",
      autoResumePaused: false,
      clarificationAnswerTemplate: "Proceed.",
    },
    aiProvider: {
      provider: "jules",
      strategy: "MANUAL",
      providers: {
        jules: {
          provider: "jules",
          name: "Jules Primary",
          enabled: true,
          model: "auto",
          weight: 1,
          thinkingMode: "MEDIUM",
          apiKey: "sk-...",
          mountAuth: false,
          authPath: "",
          maxConcurrentTasks: 1,
        },
      },
      invocationRouting: {
        task_coding: {
          profile: "GLOBAL",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
        planning: {
          profile: "WORKER",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
        dashboard_reply: {
          profile: "WORKER",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
        clarification_reply: {
          profile: "WORKER",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
        qa_review: {
          profile: "WORKER",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
        ci_fix: {
          profile: "WORKER",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
        merge_conflict: {
          profile: "WORKER",
          strategy: "MANUAL",
          provider: null,
          allowedProviders: [],
          providers: {},
        },
      },
    },
    git: {
      githubMode: "REMOTE",
      githubToken: "ghp_...",
      defaultBranch: "main",
      autoCreatePr: true,
      autoCloseLinkedIssues: true,
      featureBranchPrefix: "feat/",
      sprintBranchScheme: "sprint-{sprint_id}",
      sprintKeyPrefix: "SPRINT",
    },
    jira: {
      host: "jira.com",
      email: "a@b.com",
      apiToken: "...",
      autoCloseLinkedIssues: true,
      defaultProject: "PROJ",
      closeTransitionName: "Done",
    },
    ciIntelligence: {
      enabled: true,
      enableLivePrMonitoring: true,
      resolveAllCommentsBeforeMainMerge: true,
      resolveMainMergeConflicts: true,
      resolveMainMergeFailedChecks: true,
      resolveAllCommentsBeforeFeatureMerge: true,
      resolveMergeConflicts: true,
      waitForJulesCiAutofix: true,
      julesCiAutofixMaxRetries: 3,
      featurePrAutoMergeMode: "OFF",
      mainBranchAutoMergeMode: "OFF",
    },
    guardrails: {
      enabled: true,
      perTaskTotalCeiling: 10,
      qaRunsCap: 5,
      qaRunsOnLimit: "WARN_ONLY",
      jobs: {
        task_coding: { cap: 1, onLimit: "WARN_ONLY" },
        ci_fix: { cap: 1, onLimit: "WARN_ONLY" },
        merge_conflict: { cap: 1, onLimit: "WARN_ONLY" },
        clarification_reply: { cap: 1, onLimit: "WARN_ONLY" },
        planning: { cap: 1, onLimit: "WARN_ONLY" },
      },
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
      watchLoopOutputIntervalSeconds: 300,
    },
    cliWorkflow: {
      cleanupWorktreeOnSuccess: true,
      cleanupWorktreeOnFailure: false,
      retryOnReadFileNotFound: true,
      retryOnQuotaReset: true,
      retryOnRateLimit: true,
      rateLimitRetryDelaySeconds: 60,
      maxRateLimitRetries: 3,
      maxPlanningJsonRetries: 3,
      maxQuotaRetriesWithoutTimer: 3,
      resumeFailedTaskInSameWorkspace: true,
      gitMode: "remote",
      executionMode: "DOCKER",
      containerImage: "node:20",
      containerSetupScriptPath: "",
      containerCacheSetupScriptImage: true,
      containerMountGitConfig: true,
      containerGitUserName: "Jules",
      containerGitUserEmail: "jules@example.com",
      containerMountGithubAuth: true,
      containerMountGeminiAuth: false,
      containerMountCodexAuth: false,
      containerMountClaudeCodeAuth: false,
      containerMountQwenCodeAuth: false,
      containerMountOpenCodeAuth: false,
      containerMountAntigravityAuth: false,
      containerGithubAuthPath: "",
      containerGeminiAuthPath: "",
      containerCodexAuthPath: "",
      containerClaudeCodeAuthPath: "",
      containerQwenCodeAuthPath: "",
      containerOpenCodeAuthPath: "",
      containerAntigravityAuthPath: "",
    },
    sprintPreview: {
      enabled: false,
      showInAppBrowser: true,
      autoStartOnRunningSprint: true,
      rebuildOnTaskCompletion: true,
      rebuildOnSprintCompletion: true,
      autoStopOnTerminalSprint: true,
      maxConcurrentContainers: 2,
      hostPortRangeStart: 3000,
      hostPortRangeEnd: 4000,
      containerAppPort: 3000,
      startupScriptPath: "",
    },
    workers: {
      executionMode: "VIRTUAL",
      virtualWorkerProvider: "gemini",
      model: "gpt-4",
    },
    agents: {
      saveToProjectDirectory: true,
      routing: {
        planning: { agentPresetId: "default" },
        taskCoding: { mode: "ORCHESTRATOR", agentPresetId: "default", orchestratorAgentPresetIds: [] },
        ciFix: { agentPresetId: "default" },
        mergeConflict: { agentPresetId: "default" },
        dashboardReply: { agentPresetId: "default" },
        clarificationReply: { agentPresetId: "default" },
      },
      instructionTemplates: {
        branchMissing: "",
        planningMissing: "",
        planningCreated: "",
        mergeHeader: "",
        mergeTask: "",
        actionRequiredAgentHeader: "",
        actionRequiredAgentTask: "",
        actionRequiredHumanHeader: "",
        actionRequiredHumanTask: "",
        watchHeader: "",
        watchMergeRequired: "",
        watchNoMoreActions: "",
        completionSteps: "",
        cleanupAllMerged: "",
        cleanupFailed: "",
        cleanupDeferred: "",
        cleanupEmpty: "",
      },
      qualityAssurance: {
        enabled: true,
        maxTaskReviewRuns: 3,
        maxSprintReviewRuns: 3,
        exhaustionPolicy: "ESCALATE_TO_HUMAN",
        taskCompletion: { enabled: true, agentPresetId: "default" },
        sprintCompletion: { enabled: true, agentPresetId: "default" },
        completedTaskWithoutPr: { enabled: true, agentPresetId: "default" },
      },
    },
    skills: [],
    mcpTools: [],
    memory: {
      enabled: false,
      embeddingModel: null,
      autoCaptureSprint: true,
      autoCaptureAgent: true,
      autoPromote: true,
      promotionThreshold: 0.8,
      maxSprintMemories: 10,
      maxProjectMemories: 50,
    },
  };
}

describe("branch-name-tokens validation", () => {
  it("accepts valid canonical tokens", () => {
    const payload = makeBasePayload();
    payload.git.sprintBranchScheme = "{sprint_id}-{sprint_number}";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(true);
  });

  it("accepts valid legacy aliases", () => {
    const payload = makeBasePayload();
    payload.git.sprintBranchScheme = "{sprint}-{n}";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(true);
  });

  it("rejects invalid tokens", () => {
    const payload = makeBasePayload();
    payload.git.sprintBranchScheme = "{invalid_token}";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues[0].message).toContain("Invalid token: {invalid_token}");
  });

  it("rejects duplicate canonical tokens (even if using aliases)", () => {
    const payload = makeBasePayload();
    // {sprint} and {sprint_id} both map to canonical sprint_id
    payload.git.sprintBranchScheme = "{sprint}-{sprint_id}";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues[0].message).toContain("Duplicate token usage (canonical): sprint_id");
  });

  it("rejects duplicate simple tokens", () => {
    const payload = makeBasePayload();
    payload.git.sprintBranchScheme = "{sprint_number}-{sprint_number}";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues[0].message).toContain("Duplicate token usage (canonical): sprint_number");
  });
});
