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
    first.agents.selfReflection.planning.enabled = true;
    first.agents.selfReflection.planning.criteria[0]!.threshold = 0.1;
    first.notion.enabled = true;
    first.notion.apiToken = "manual-token";
    first.figma.fileKey = "figma-file";
    first.mural.boardId = "mural-id";
    first.mcpTools[0].enabled = false;
    expect(second.git.defaultBranch).toBe("main");
    expect(second.dashboardPort).toBe(4444);
    expect(second.aiProvider.providers.gemini.model).toBe("default");
    expect(second.sprintLoopSteps.watchLoopIntervalSeconds).toBe(10);
    expect(second.sprintLoopSteps.watchLoopOutputIntervalSeconds).toBe(300);
    expect(second.automationInterventions.autoAnswerClarification).toBe(false);
    expect(second.ciIntelligence.julesCiAutofixMaxRetries).toBe(3);
    expect(second.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(second.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
    expect(second.cliWorkflow.executionMode).toBe("DOCKER");
    expect(second.cliWorkflow.containerImage).toBe("node:24-bookworm");
    expect(second.cliWorkflow.containerCacheSetupScriptImage).toBe(true);
    expect(second.agents.selfReflection.planning.enabled).toBe(false);
    expect(second.agents.selfReflection.planning.criteria[0]!.threshold).toBe(0.85);
    expect(second.notion.enabled).toBe(false);
    expect(second.notion.apiToken).toBe("");
    expect(second.figma.fileKey).toBe("");
    expect(second.mural.boardId).toBe("");
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

  it("preserves autoApprovePlan: true in cloneDefaultSettings and allows manual toggling to false", () => {
    const settings = cloneDefaultSettings();
    expect(settings.automationInterventions.autoApprovePlan).toBe(true);

    // Modify cloned settings
    settings.automationInterventions.autoApprovePlan = false;
    expect(settings.automationInterventions.autoApprovePlan).toBe(false);

    // Get fresh clone, check it is still true
    const fresh = cloneDefaultSettings();
    expect(fresh.automationInterventions.autoApprovePlan).toBe(true);
  });

  it("enables browser preview and the in-app browser by default without auto-starting sprint previews", () => {
    const settings = cloneDefaultSettings();

    expect(settings.sprintPreview.enabled).toBe(true);
    expect(settings.sprintPreview.showInAppBrowser).toBe(true);
    expect(settings.sprintPreview.autoStartOnRunningSprint).toBe(false);
  });
});
