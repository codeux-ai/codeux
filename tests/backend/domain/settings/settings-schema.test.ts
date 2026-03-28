import { describe, expect, it } from "vitest";
import { validateSettingsPayload } from "../../../../src/domain/settings/settings-schema.js";
import { cloneDefaults } from "../../../../src/repositories/settings-sanitizer.js";

describe("validateSettingsPayload", () => {
  it("accepts a valid dashboard settings payload", () => {
    const payload = cloneDefaults({
      env: {
        julesApiKey: "env-jules",
        geminiApiKey: "env-gemini",
        codexApiKey: "env-codex",
        claudeCodeApiKey: "env-claude",
        githubToken: "env-github",
      },
      settingsJson: {
        julesApiKey: "",
        geminiApiKey: "",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "",
      },
      resolved: {
        julesApiKey: "env-jules",
        geminiApiKey: "env-gemini",
        codexApiKey: "env-codex",
        claudeCodeApiKey: "env-claude",
        githubToken: "env-github",
      },
    });

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.data).toEqual(payload);
  });

  it("rejects non-object payloads early", () => {
    const result = validateSettingsPayload("invalid");

    expect(result.success).toBe(false);
    expect(result.issues).toEqual([
      { path: "root", message: "Payload must be an object" },
    ]);
  });

  it("reports section-level object and array validation failures", () => {
    const payload = {
      dashboardPort: 4444,
      enableDebugLogFile: false,
      automationLevel: "FULL",
      automationInterventions: "invalid",
      aiProvider: "invalid",
      git: "invalid",
      ciIntelligence: "invalid",
      sprintLoopSteps: "invalid",
      cliWorkflow: "invalid",
      workers: "invalid",
      agents: "invalid",
      skills: "invalid",
      mcpTools: "invalid",
    };

    const result = validateSettingsPayload(payload);
    const paths = result.issues.map((issue) => issue.path);

    expect(result.success).toBe(false);
    expect(paths).toContain("automationInterventions");
    expect(paths).toContain("aiProvider");
    expect(paths).toContain("git");
    expect(paths).toContain("ciIntelligence");
    expect(paths).toContain("sprintLoopSteps");
    expect(paths).toContain("cliWorkflow");
    expect(paths).toContain("workers");
    expect(paths).toContain("agents");
    expect(paths).toContain("skills");
    expect(paths).toContain("mcpTools");
  });

  it("reports detailed field validation failures across nested settings", () => {
    const payload = {
      dashboardPort: "bad",
      enableDebugLogFile: "bad",
      automationLevel: "INVALID",
      automationInterventions: {
        autoApprovePlan: "bad",
        autoAnswerClarification: "bad",
        autoResumePaused: "bad",
        clarificationAnswerTemplate: 42,
      },
      aiProvider: {
        provider: "invalid",
        strategy: "invalid",
        julesApiKey: 42,
        providers: {
          jules: {
            enabled: "bad",
            model: 1,
            weight: "bad",
            thinkingMode: "invalid",
            apiKey: 1,
          },
          gemini: "bad",
          "claude-code": {
            enabled: false,
            model: "default",
            weight: 0,
            thinkingMode: "HIGH",
            apiKey: "",
          },
        },
      },
      git: {
        githubMode: "invalid",
        githubToken: 1,
        defaultBranch: 2,
        autoCreatePr: "bad",
        featureBranchPrefix: 3,
        sprintBranchScheme: 4,
        defaultSprintKey: 5,
      },
      ciIntelligence: {
        enabled: "bad",
        enableLivePrMonitoring: "bad",
        waitForCiBeforeMainMerge: "bad",
        resolveAllCommentsBeforeMainMerge: "bad",
        resolveMainMergeConflicts: "bad",
        waitForCiBeforeFeatureMerge: "bad",
        resolveAllCommentsBeforeFeatureMerge: "bad",
        resolveMergeConflicts: "bad",
        waitForJulesCiAutofix: "bad",
        julesCiAutofixMaxRetries: "bad",
        featurePrAutoMergeMode: "invalid",
      },
      sprintLoopSteps: {
        branchPreflight: "bad",
        planningPreflight: "bad",
        loadSubtasks: "bad",
        sessionSync: "bad",
        statusDerivation: "bad",
        startReadyTasks: "bad",
        mergeProtocol: "bad",
        actionRequiredProtocol: "bad",
        statusTable: "bad",
        watchLoop: "bad",
        watchLoopIntervalSeconds: "bad",
        watchLoopOutputIntervalSeconds: "bad",
      },
      cliWorkflow: {
        cleanupWorktreeOnSuccess: "bad",
        cleanupWorktreeOnFailure: "bad",
        retryOnReadFileNotFound: "bad",
        resumeFailedTaskInSameWorkspace: "bad",
        executionMode: "bad",
        containerImage: 1,
        containerSetupScriptPath: 2,
        containerCacheSetupScriptImage: "bad",
        containerMountGitConfig: "bad",
        containerMountGithubAuth: "bad",
        containerMountGeminiAuth: "bad",
        containerMountCodexAuth: "bad",
        containerMountClaudeCodeAuth: "bad",
        containerGithubAuthPath: 3,
        containerGeminiAuthPath: 4,
        containerCodexAuthPath: 5,
        containerClaudeCodeAuthPath: 6,
      },
      workers: {
        executionMode: "bad",
        virtualWorkerProvider: "jules",
      },
      agents: {
        saveToProjectDirectory: "bad",
      },
      skills: [
        "bad",
        { name: 1, enabled: "bad", isInternal: "bad" },
      ],
      mcpTools: [
        "bad",
        { name: 1, enabled: "bad", isInternal: "bad" },
      ],
    };

    const result = validateSettingsPayload(payload);
    const paths = result.issues.map((issue) => issue.path);

    expect(result.success).toBe(false);
    expect(paths).toContain("dashboardPort");
    expect(paths).toContain("enableDebugLogFile");
    expect(paths).toContain("automationLevel");
    expect(paths).toContain("automationInterventions.autoApprovePlan");
    expect(paths).toContain("aiProvider.provider");
    expect(paths).toContain("aiProvider.providers.jules.apiKey");
    expect(paths).toContain("aiProvider.providers.gemini");
    expect(paths).toContain("aiProvider.providers.codex");
    expect(paths).toContain("git.githubMode");
    expect(paths).toContain("git.defaultSprintKey");
    expect(paths).toContain("ciIntelligence.featurePrAutoMergeMode");
    expect(paths).toContain("sprintLoopSteps.watchLoopOutputIntervalSeconds");
    expect(paths).toContain("cliWorkflow.executionMode");
    expect(paths).toContain("cliWorkflow.containerCacheSetupScriptImage");
    expect(paths).toContain("cliWorkflow.containerClaudeCodeAuthPath");
    expect(paths).toContain("workers.executionMode");
    expect(paths).toContain("workers.virtualWorkerProvider");
    expect(paths).toContain("agents.saveToProjectDirectory");
    expect(paths).toContain("agents.instructionTemplates");
    expect(paths).toContain("skills[0]");
    expect(paths).toContain("skills[1].isInternal");
    expect(paths).toContain("mcpTools[0]");
    expect(paths).toContain("mcpTools[1].enabled");
  });
});
