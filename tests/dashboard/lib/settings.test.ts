import { describe, expect, it } from "vitest";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";

describe("dashboard settings helpers", () => {
  it("returns fresh default objects", () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();
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
    first.mcpTools[0].enabled = false;
    expect(second.git.defaultBranch).toBe("main");
    expect(second.aiProvider.providers.gemini.model).toBe("default");
    expect(second.sprintLoopSteps.watchLoopIntervalSeconds).toBe(120);
    expect(second.sprintLoopSteps.watchLoopOutputIntervalSeconds).toBe(300);
    expect(second.automationInterventions.autoAnswerClarification).toBe(false);
    expect(second.ciIntelligence.julesCiAutofixMaxRetries).toBe(3);
    expect(second.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(second.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
    expect(second.cliWorkflow.executionMode).toBe("HOST");
    expect(second.cliWorkflow.containerImage).toBe("node:22-bookworm-slim");
    expect(second.mcpTools[0].enabled).toBe(true);
  });
});
