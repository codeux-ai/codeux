import { describe, expect, it } from "vitest";
import { applyExternalSettingsHints, cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";

describe("dashboard settings helpers", () => {
  it("returns fresh default objects", () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();
    first.dashboardPort = 4999;
    first.git.defaultBranch = "develop";
    first.aiProvider.providers.gemini.model = "gemini-2.5-pro";
    first.sprintLoopSteps.watchLoopIntervalSeconds = 45;
    first.sprintLoopSteps.watchLoopOutputIntervalSeconds = 480;
    first.automationInterventions.autoAnswerClarification = true;
    first.ciIntelligence.julesCiAutofixMaxRetries = 9;
    first.cliWorkflow.cleanupWorktreeOnFailure = true;
    first.cliWorkflow.resumeFailedTaskInSameWorkspace = false;
    first.cliWorkflow.executionMode = "DOCKER";
    first.cliWorkflow.containerImage = "custom:image";
    first.cliWorkflow.containerCacheSetupScriptImage = true;
    first.mcpTools[0].enabled = false;
    expect(second.git.defaultBranch).toBe("main");
    expect(second.dashboardPort).toBe(4444);
    expect(second.aiProvider.providers.gemini.model).toBe("default");
    expect(second.sprintLoopSteps.watchLoopIntervalSeconds).toBe(120);
    expect(second.sprintLoopSteps.watchLoopOutputIntervalSeconds).toBe(300);
    expect(second.automationInterventions.autoAnswerClarification).toBe(false);
    expect(second.ciIntelligence.julesCiAutofixMaxRetries).toBe(3);
    expect(second.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(second.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
    expect(second.cliWorkflow.executionMode).toBe("HOST");
    expect(second.cliWorkflow.containerImage).toBe("node:24-bookworm");
    expect(second.cliWorkflow.containerCacheSetupScriptImage).toBe(false);
    expect(second.mcpTools[0].enabled).toBe(true);
  });

  it("imports only missing external secrets", () => {
    const settings = cloneDefaultSettings();
    settings.aiProvider.providers.jules.apiKey = "manual-jules";
    settings.aiProvider.providers.gemini.apiKey = "";
    settings.aiProvider.providers.codex.apiKey = "";
    settings.aiProvider.providers["claude-code"].apiKey = "";
    settings.git.githubToken = "";

    const merged = applyExternalSettingsHints(settings, {
      env: {
        julesApiKey: "",
        geminiApiKey: "",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "",
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
        githubToken: "resolved-gh",
      },
    });

    expect(merged.aiProvider.providers.jules.apiKey).toBe("manual-jules");
    expect(merged.aiProvider.providers.gemini.apiKey).toBe("resolved-gemini");
    expect(merged.aiProvider.providers.codex.apiKey).toBe("resolved-codex");
    expect(merged.aiProvider.providers["claude-code"].apiKey).toBe("resolved-claude");
    expect(merged.git.githubToken).toBe("resolved-gh");
  });
});
