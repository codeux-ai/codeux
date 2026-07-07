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

  it("accepts CREATE_PR for featurePrAutoMergeMode", () => {
    const payload = cloneDefaults({
      env: {},
      settingsJson: {},
      resolved: {},
    });

    // Default clone includes `ciIntelligence` initialized by cloneDefaults, modify it
    payload.ciIntelligence.featurePrAutoMergeMode = "CREATE_PR";

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.data.ciIntelligence.featurePrAutoMergeMode).toBe("CREATE_PR");
  });

  it("rejects invalid sprint preview container ports", () => {
    const payload = cloneDefaults({
      env: {},
      settingsJson: {},
      resolved: {},
    });
    payload.sprintPreview.containerAppPort = 70000;
    payload.sprintPreview.containerAppPorts = [3000, 0, 65536];

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: "sprintPreview.containerAppPort", message: "Expected a port number between 1 and 65535" },
      { path: "sprintPreview.containerAppPorts.1", message: "Expected a port number between 1 and 65535" },
      { path: "sprintPreview.containerAppPorts.2", message: "Expected a port number between 1 and 65535" },
    ]));
  });

  it("rejects malformed external importer settings", () => {
    const payload = cloneDefaults({
      env: {},
      settingsJson: {},
      resolved: {},
    });
    payload.notion.enabled = "yes" as any;
    payload.notion.apiToken = 42 as any;
    payload.notion.defaultSearchLimit = 0;
    payload.miro = "invalid" as any;

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: "notion.enabled", message: "Expected a boolean" },
      { path: "notion.apiToken", message: "Expected a string" },
      { path: "notion.defaultSearchLimit", message: "Expected a finite number between 1 and 250" },
      { path: "miro", message: "Expected an object" },
    ]));
  });

  it("rejects Docker memory limits outside the supported MiB range", () => {
    const payload = cloneDefaults({
      env: {},
      settingsJson: {},
      resolved: {},
    });
    payload.cliWorkflow.containerMemoryLimitMb = 262145;

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(false);
    expect(result.issues).toContainEqual({
      path: "cliWorkflow.containerMemoryLimitMb",
      message: "Expected an integer between 0 and 262144",
    });
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
      consoleLogLevel: "info",
      debugLogFileLevel: "error",
      consoleLogMode: "standard",
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
      consoleLogLevel: "bad",
      debugLogFileLevel: "bad",
      consoleLogMode: "bad",
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
            maxConcurrentTasks: "bad",
          },
          gemini: "bad",
          "claude-code": {
            enabled: false,
            model: "default",
            weight: 0,
            thinkingMode: "HIGH",
            apiKey: "",
            maxConcurrentTasks: 0,
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
        sprintKeyPrefix: 5,
      },
      ciIntelligence: {
        enabled: "bad",
        enableLivePrMonitoring: "bad",
        resolveAllCommentsBeforeMainMerge: "bad",
        resolveMainMergeConflicts: "bad",
        resolveAllCommentsBeforeFeatureMerge: "bad",
        resolveMergeConflicts: "bad",
        waitForJulesCiAutofix: "bad",
        julesCiAutofixMaxRetries: "bad",
        featurePrAutoMergeMode: "invalid",
        mainBranchAutoMergeMode: "invalid",
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
        gitMode: "bad",
        executionMode: "bad",
        containerImage: 1,
        containerSetupScriptPath: 2,
        containerMemoryLimitMb: "bad",
        containerCacheSetupScriptImage: "bad",
        containerInstallPlaywrightBrowsers: "bad",
        containerRunAsRoot: "bad",
        containerMountGitConfig: "bad",
        containerGitUserName: 7,
        containerGitUserEmail: 8,
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
        instructionTemplates: {},
        qualityAssurance: {
          enabled: "bad",
          maxTaskReviewRuns: "bad",
          taskCompletion: {
            enabled: "bad",
            agentPresetId: 1,
            agentPresetIds: ["qa", 1],
          },
          sprintCompletion: "bad",
          completedTaskWithoutPr: {
            enabled: "bad",
            agentPresetId: 2,
            agentPresetIds: "bad",
          },
        },
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
    expect(paths).toContain("consoleLogLevel");
    expect(paths).toContain("debugLogFileLevel");
    expect(paths).toContain("consoleLogMode");
    expect(paths).toContain("automationLevel");
    expect(paths).toContain("automationInterventions.autoApprovePlan");
    expect(paths).toContain("aiProvider.provider");
    expect(paths).toContain("aiProvider.providers.jules.apiKey");
    expect(paths).toContain("aiProvider.providers.gemini");
    expect(paths).toContain("git.githubMode");
    expect(paths).toContain("git.sprintKeyPrefix");
    expect(paths).toContain("ciIntelligence.featurePrAutoMergeMode");
    expect(paths).toContain("ciIntelligence.mainBranchAutoMergeMode");
    expect(paths).toContain("sprintLoopSteps.watchLoopOutputIntervalSeconds");
    expect(paths).toContain("cliWorkflow.executionMode");
    expect(paths).toContain("cliWorkflow.gitMode");
    expect(paths).toContain("cliWorkflow.containerMemoryLimitMb");
    expect(paths).toContain("cliWorkflow.containerSetupScriptPath");
    expect(paths).toContain("cliWorkflow.containerCacheSetupScriptImage");
    expect(paths).toContain("cliWorkflow.containerInstallPlaywrightBrowsers");
    expect(paths).toContain("cliWorkflow.containerRunAsRoot");
    expect(paths).toContain("cliWorkflow.containerClaudeCodeAuthPath");
    expect(paths).toContain("workers.executionMode");
    expect(paths).toContain("workers.virtualWorkerProvider");
    expect(paths).toContain("agents.saveToProjectDirectory");
    expect(paths).toContain("agents.instructionTemplates.planningMissing");
    expect(paths).toContain("agents.qualityAssurance.enabled");
    expect(paths).toContain("agents.qualityAssurance.maxTaskReviewRuns");
    expect(paths).toContain("agents.qualityAssurance.taskCompletion.enabled");
    expect(paths).toContain("agents.qualityAssurance.taskCompletion.agentPresetId");
    expect(paths).toContain("agents.qualityAssurance.taskCompletion.agentPresetIds.1");
    expect(paths).toContain("agents.qualityAssurance.sprintCompletion");
    expect(paths).toContain("agents.qualityAssurance.completedTaskWithoutPr.enabled");
    expect(paths).toContain("agents.qualityAssurance.completedTaskWithoutPr.agentPresetId");
    expect(paths).toContain("agents.qualityAssurance.completedTaskWithoutPr.agentPresetIds");
    expect(paths).toContain("skills[0]");
    expect(paths).toContain("skills[1].isInternal");
    expect(paths).toContain("mcpTools[0]");
    expect(paths).toContain("mcpTools[1].enabled");
  });

  it("accepts QA trigger agent preset arrays and legacy single preset fields", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.agents.qualityAssurance.taskCompletion.agentPresetId = "qa-legacy";
    payload.agents.qualityAssurance.taskCompletion.agentPresetIds = ["qa-legacy"];
    payload.agents.qualityAssurance.sprintCompletion.agentPresetId = "qa-1";
    payload.agents.qualityAssurance.sprintCompletion.agentPresetIds = ["qa-1", "qa-2"];
    payload.agents.qualityAssurance.completedTaskWithoutPr.agentPresetId = null;
    payload.agents.qualityAssurance.completedTaskWithoutPr.agentPresetIds = [];

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts relative and absolute container setup script path strings", () => {
    const relativePayload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    relativePayload.cliWorkflow.containerSetupScriptPath = "scripts/missing-container-setup.sh";

    const relativeResult = validateSettingsPayload(relativePayload);
    expect(relativeResult.success).toBe(true);
    expect(relativeResult.issues).toEqual([]);

    const absolutePayload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    absolutePayload.cliWorkflow.containerSetupScriptPath = "/tmp/code-ux/missing-container-setup.sh";

    const absoluteResult = validateSettingsPayload(absolutePayload);
    expect(absoluteResult.success).toBe(true);
    expect(absoluteResult.issues).toEqual([]);
  });

  it("rejects non-string container setup script path values", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.cliWorkflow.containerSetupScriptPath = 42 as any;

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: "cliWorkflow.containerSetupScriptPath", message: "Expected a string" },
    ]));
  });

  it("requires Docker root execution to be boolean in full settings payloads", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    expect(payload.cliWorkflow.containerRunAsRoot).toBe(false);

    payload.cliWorkflow.containerRunAsRoot = "yes" as any;

    const result = validateSettingsPayload(payload);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: "cliWorkflow.containerRunAsRoot", message: "Expected a boolean" },
    ]));
  });
});

describe("maxParsingRetries validation", () => {
  it("rejects values less than 0", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.cliWorkflow.maxParsingRetries = -1;
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toContain("cliWorkflow.maxParsingRetries");
  });

  it("rejects values greater than 10", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.cliWorkflow.maxParsingRetries = 11;
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toContain("cliWorkflow.maxParsingRetries");
  });

  it("rejects non-integer values", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.cliWorkflow.maxParsingRetries = 3.5;
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toContain("cliWorkflow.maxParsingRetries");
  });

  it("accepts valid boundary values", () => {
    const payload0 = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload0.cliWorkflow.maxParsingRetries = 0;
    expect(validateSettingsPayload(payload0).success).toBe(true);

    const payload10 = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload10.cliWorkflow.maxParsingRetries = 10;
    expect(validateSettingsPayload(payload10).success).toBe(true);
  });
});

describe("sprintKeyPrefix validation", () => {
  it("rejects values less than 2 characters", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.git.sprintKeyPrefix = "A";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toContain("git.sprintKeyPrefix");
  });

  it("rejects values greater than 10 characters", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.git.sprintKeyPrefix = "TOOLONGPREFIX";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toContain("git.sprintKeyPrefix");
  });

  it("rejects non-uppercase values", () => {
    const payload = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload.git.sprintKeyPrefix = "spr";
    const result = validateSettingsPayload(payload);
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toContain("git.sprintKeyPrefix");
  });

  it("accepts valid prefixes", () => {
    const payload1 = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload1.git.sprintKeyPrefix = "SP";
    expect(validateSettingsPayload(payload1).success).toBe(true);

    const payload2 = cloneDefaults({ env: {}, settingsJson: {}, resolved: {} });
    payload2.git.sprintKeyPrefix = "CUSTOMPROJ";
    expect(validateSettingsPayload(payload2).success).toBe(true);
  });
});
