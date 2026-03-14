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
    });

    expect(settings.aiProvider.julesApiKey).toBe("resolved-jules");
    expect(settings.aiProvider.providers.gemini.apiKey).toBe("resolved-gemini");
    expect(settings.aiProvider.providers.codex.apiKey).toBe("resolved-codex");
    expect(settings.aiProvider.providers["claude-code"].apiKey).toBe("resolved-claude");
    expect(settings.git.githubToken).toBe("resolved-github");
  });

  it("sanitizes malformed input back to safe defaults", () => {
    const settings = sanitizeSettings({
      dashboardPort: "nope",
      enableDebugLogFile: "nope",
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
        containerMountGeminiAuth: "bad",
      },
      skills: [
        { name: "git_manager_remote", enabled: false },
        { name: "git_manager_local", enabled: true },
        { name: "custom-skill", enabled: true },
      ],
      mcpTools: [
        { name: "get_session", enabled: false },
      ],
    });

    expect(settings.dashboardPort).toBe(4444);
    expect(settings.enableDebugLogFile).toBe(false);
    expect(settings.automationLevel).toBe("SEMI_AUTO");
    expect(settings.automationInterventions.autoApprovePlan).toBe(true);
    expect(settings.aiProvider.provider).toBe("jules");
    expect(settings.git.githubMode).toBe("REMOTE");
    expect(settings.ciIntelligence.waitForJulesCiAutofix).toBe(false);
    expect(settings.sprintLoopSteps.watchLoopIntervalSeconds).toBe(120);
    expect(settings.sprintLoopSteps.watchLoopOutputIntervalSeconds).toBe(300);
    expect(settings.cliWorkflow.executionMode).toBe("HOST");
    expect(settings.cliWorkflow.containerImage).toBe("node:24-bookworm");
    expect(settings.cliWorkflow.containerMountGeminiAuth).toBe(true);
    expect(settings.skills.find((skill) => skill.name === "git_manager_remote")?.enabled).toBe(true);
    expect(settings.skills.find((skill) => skill.name === "git_manager_local")?.enabled).toBe(false);
    expect(settings.skills.find((skill) => skill.name === "custom-skill")?.isInternal).toBe(false);
    expect(settings.mcpTools.find((tool) => tool.name === "get_session")?.enabled).toBe(false);
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
});
