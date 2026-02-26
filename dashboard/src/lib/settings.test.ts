import { describe, expect, it } from "vitest";
import { cloneDefaultSettings } from "./settings.js";

describe("dashboard settings helpers", () => {
  it("returns fresh default objects", () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();
    first.git.defaultBranch = "develop";
    first.aiProvider.providers.gemini.model = "gemini-2.5-pro";
    first.sprintLoopSteps.watchLoopIntervalSeconds = 45;
    first.cliWorkflow.cleanupWorktreeOnFailure = true;
    first.cliWorkflow.resumeFailedTaskInSameWorkspace = false;
    first.cliWorkflow.executionMode = "DOCKER";
    first.cliWorkflow.containerImage = "custom:image";
    expect(second.git.defaultBranch).toBe("main");
    expect(second.aiProvider.providers.gemini.model).toBe("default");
    expect(second.sprintLoopSteps.watchLoopIntervalSeconds).toBe(120);
    expect(second.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(second.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
    expect(second.cliWorkflow.executionMode).toBe("HOST");
    expect(second.cliWorkflow.containerImage).toBe("node:22-bookworm-slim");
  });
});
