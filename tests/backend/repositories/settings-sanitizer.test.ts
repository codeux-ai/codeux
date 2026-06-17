import { describe, expect, it } from "vitest";
import { cloneDefaults, sanitizeSettings } from "../../../src/repositories/settings-sanitizer.js";

describe("settings-sanitizer", () => {
  it("clones defaults using resolved external hints", () => {
    const settings = cloneDefaults({
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
        julesApiKey: "resolved-jules",
        geminiApiKey: "resolved-gemini",
        codexApiKey: "resolved-codex",
        claudeCodeApiKey: "resolved-claude",
        githubToken: "resolved-github",
      },
      providerAvailability: {
        jules: { hasApiKey: true, hasLocalAuth: false },
        gemini: { hasApiKey: true, hasLocalAuth: false },
        codex: { hasApiKey: true, hasLocalAuth: false },
        claudeCode: { hasApiKey: true, hasLocalAuth: false },
      },
    });

    expect(settings.aiProvider.providers.jules.apiKey).toBe("resolved-jules");
    expect(settings.aiProvider.providers.gemini.apiKey).toBe("resolved-gemini");
    expect(settings.aiProvider.providers.codex.apiKey).toBe("resolved-codex");
    expect(settings.aiProvider.providers["claude-code"].apiKey).toBe("resolved-claude");
    expect(settings.git.githubToken).toBe("resolved-github");
    expect(settings.agents.saveToProjectDirectory).toBe(true);
    expect(settings.agents.instructionTemplates.planningMissing).toContain("Sprint Planning Missing");
  });

  it("sanitizes malformed input back to safe defaults", () => {
    const settings = sanitizeSettings({
      dashboardPort: "nope",
      enableDebugLogFile: "nope",
      consoleLogLevel: "nope",
      debugLogFileLevel: "nope",
      consoleLogMode: "nope",
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
        providers: {
          jules: { enabled: "bad", model: 1, weight: "bad", thinkingMode: "bad", apiKey: 1 },
        },
      },
      git: {
        githubMode: "invalid",
        githubToken: 42,
      },
      ciIntelligence: {
        enabled: "bad",
        waitForJulesCiAutofix: "bad",
      },
      sprintLoopSteps: {
        watchLoopIntervalSeconds: "bad",
        watchLoopOutputIntervalSeconds: "bad",
      },
      cliWorkflow: {
        executionMode: "invalid",
        containerImage: 42,
        containerSetupScriptPath: 7,
        containerCacheSetupScriptImage: "bad",
        containerMountGeminiAuth: "bad",
      },
      agents: {
        saveToProjectDirectory: "bad",
        qualityAssurance: {
          enabled: "bad",
          maxTaskReviewRuns: "bad",
          taskCompletion: {
            enabled: "bad",
            agentPresetId: 7,
          },
          sprintCompletion: {
            enabled: "bad",
            agentPresetId: 8,
          },
          completedTaskWithoutPr: {
            enabled: "bad",
            agentPresetId: 9,
          },
        },
      },
      skills: [
        { name: "git_manager_remote", enabled: false },
        { name: "git_manager_local", enabled: true },
        { name: "custom-skill", enabled: true },
      ],
      mcpTools: [
        { name: "manage_tasks", enabled: false },
      ],
    });

    expect(settings.dashboardPort).toBe(4444);
    expect(settings.consoleLogLevel).toBe("info");
    expect(settings.debugLogFileLevel).toBe("off");
    expect(settings.consoleLogMode).toBe("standard");
    expect(settings.automationLevel).toBe("SEMI_AUTO");
    expect(settings.automationInterventions.autoApprovePlan).toBe(true);
    expect(settings.aiProvider.provider).toBe("jules");
    expect(settings.git.githubMode).toBe("REMOTE");
    expect(settings.ciIntelligence.waitForJulesCiAutofix).toBe(false);
    expect(settings.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
    expect(settings.ciIntelligence.mainBranchAutoMergeMode).toBe("CREATE_PR");
    expect(settings.ciIntelligence.resolveMergeConflicts).toBe(true);
    expect(settings.ciIntelligence.resolveMainMergeConflicts).toBe(true);
    expect(settings.sprintLoopSteps.watchLoopIntervalSeconds).toBe(10);
    expect(settings.sprintLoopSteps.watchLoopOutputIntervalSeconds).toBe(300);
    expect(settings.cliWorkflow.executionMode).toBe("DOCKER");
    expect(settings.cliWorkflow.containerImage).toBe("node:24-bookworm");
    expect(settings.cliWorkflow.containerCacheSetupScriptImage).toBe(true);
    expect(settings.cliWorkflow.containerMountGeminiAuth).toBe(false);
    expect(settings.agents.saveToProjectDirectory).toBe(true);
    expect(settings.agents.instructionTemplates.planningMissing).toContain("Sprint Planning Missing");
    expect(settings.agents.qualityAssurance.enabled).toBe(true);
    expect(settings.agents.qualityAssurance.maxTaskReviewRuns).toBe(5);
    expect(settings.agents.qualityAssurance.taskCompletion.enabled).toBe(true);
    expect(settings.agents.qualityAssurance.taskCompletion.agentPresetId).toBe(null);
    expect(settings.agents.qualityAssurance.sprintCompletion.enabled).toBe(true);
    expect(settings.agents.qualityAssurance.sprintCompletion.agentPresetId).toBe(null);
    expect(settings.agents.qualityAssurance.completedTaskWithoutPr.enabled).toBe(true);
    expect(settings.agents.qualityAssurance.completedTaskWithoutPr.agentPresetId).toBe(null);
    expect(settings.skills.find((skill) => skill.name === "git_manager_remote")?.enabled).toBe(true);
    expect(settings.skills.find((skill) => skill.name === "git_manager_local")?.enabled).toBe(false);
    expect(settings.skills.find((skill) => skill.name === "custom-skill")?.isInternal).toBe(false);
    expect(settings.mcpTools.find((tool) => tool.name === "manage_tasks")?.enabled).toBe(false);
    expect(settings.memory.enabled).toBe(true);
  });

  it("preserves valid appearance background image and pattern settings", () => {
    const settings = sanitizeSettings({
      appearance: {
        backgroundMode: "STATIC",
        animatedBackground: "neon-dreams",
        staticBackgroundColor: "#123456",
        backgroundImage: "data:image/png;base64,abc123",
        backgroundPattern: "DIAGONAL_LINES",
      },
    });

    expect(settings.appearance.backgroundMode).toBe("STATIC");
    expect(settings.appearance.animatedBackground).toBe("neon-dreams");
    expect(settings.appearance.staticBackgroundColor).toBe("#123456");
    expect(settings.appearance.backgroundImage).toBe("data:image/png;base64,abc123");
    expect(settings.appearance.backgroundPattern).toBe("DIAGONAL_LINES");
  });

  it("normalizes legacy orchestrator provider routing to agent routing", () => {
    const settings = sanitizeSettings({
      aiProvider: {
        strategy: "ORCHESTRATOR",
        invocationRouting: {
          dashboard_reply: {
            strategy: "ORCHESTRATOR",
          },
        },
      },
    } as any);

    expect(settings.aiProvider.strategy).toBe("AGENT");
    expect(settings.aiProvider.invocationRouting.dashboard_reply.strategy).toBe("AGENT");
  });

  it("drops unsafe appearance background image and unknown pattern values", () => {
    const settings = sanitizeSettings({
      appearance: {
        backgroundImage: "javascript:alert(1)",
        backgroundPattern: "SPIRAL",
      },
    });

    expect(settings.appearance.backgroundImage).toBe(null);
    expect(settings.appearance.backgroundPattern).toBe("NONE");
  });

  it("enforces git manager skill modes based on github mode", () => {
    const localSettings = sanitizeSettings({
      git: {
        githubMode: "LOCAL",
      },
      skills: [
        { name: "git_manager_remote", enabled: true },
        { name: "git_manager_local", enabled: false },
        { name: "git_manager", enabled: false },
      ],
    });

    expect(localSettings.skills.find((skill) => skill.name === "git_manager_remote")?.enabled).toBe(false);
    expect(localSettings.skills.find((skill) => skill.name === "git_manager_local")?.enabled).toBe(true);
    expect(localSettings.skills.find((skill) => skill.name === "git_manager")?.enabled).toBe(true);
  });

  it("keeps autoApprovePlan true by default or fallback, but preserves explicit false", () => {
    const missing = sanitizeSettings({
      automationInterventions: {}
    });
    expect(missing.automationInterventions.autoApprovePlan).toBe(true);

    const invalid = sanitizeSettings({
      automationInterventions: {
        autoApprovePlan: "not-a-boolean"
      }
    });
    expect(invalid.automationInterventions.autoApprovePlan).toBe(true);

    const explicitFalse = sanitizeSettings({
      automationInterventions: {
        autoApprovePlan: false
      }
    });
    expect(explicitFalse.automationInterventions.autoApprovePlan).toBe(false);
  });
});
