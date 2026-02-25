import { describe, expect, it } from "vitest";
import { cloneDefaultSettings } from "./settings.js";

describe("dashboard settings helpers", () => {
  it("returns fresh default objects", () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();
    first.git.defaultBranch = "develop";
    first.aiProvider.providers.gemini.model = "gemini-2.5-pro";
    first.cliWorkflow.cleanupWorktreeOnFailure = true;
    first.cliWorkflow.resumeFailedTaskInSameWorkspace = false;
    expect(second.git.defaultBranch).toBe("main");
    expect(second.aiProvider.providers.gemini.model).toBe("default");
    expect(second.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(second.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
  });
});
