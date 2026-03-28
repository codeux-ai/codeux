import { describe, expect, it } from "vitest";
import { sanitizeGit } from "../../../../../src/domain/settings/settings-sanitizers/git-sanitizer.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

describe("sanitizeGit", () => {
  it("resolves github token from external hints", () => {
    const result = sanitizeGit({}, {
      resolved: { githubToken: "gh-token", julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "" },
      env: {},
      settingsJson: {},
    });
    expect(result.githubToken).toBe("gh-token");
  });

  it("prioritizes input token", () => {
    const result = sanitizeGit({ git: { githubToken: "explicit-gh-token" } }, {
      resolved: { githubToken: "gh-token", julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "" },
      env: {},
      settingsJson: {},
    });
    expect(result.githubToken).toBe("explicit-gh-token");
  });

  it("prioritizes input defaultSprintKey and falls back to default", () => {
    const defaultResult = sanitizeGit({});
    expect(defaultResult.defaultSprintKey).toBe("SPR");

    const inputResult = sanitizeGit({ git: { defaultSprintKey: "DEV" } });
    expect(inputResult.defaultSprintKey).toBe("DEV");

    const emptyResult = sanitizeGit({ git: { defaultSprintKey: "   " } });
    expect(emptyResult.defaultSprintKey).toBe("SPR");
  });

  it("sanitizes githubMode correctly", () => {
    expect(sanitizeGit({ git: { githubMode: "LOCAL" } }).githubMode).toBe("LOCAL");
    expect(sanitizeGit({ git: { githubMode: "REMOTE" } }).githubMode).toBe("REMOTE");
    expect(sanitizeGit({ git: { githubMode: "INVALID" as any } }).githubMode).toBe("REMOTE");
  });

  it("sanitizes defaultBranch correctly", () => {
    expect(sanitizeGit({ git: { defaultBranch: "master" } }).defaultBranch).toBe("master");
    expect(sanitizeGit({ git: { defaultBranch: "   " } }).defaultBranch).toBe(DEFAULT_DASHBOARD_SETTINGS.git.defaultBranch);
  });

  it("sanitizes autoCreatePr correctly", () => {
    expect(sanitizeGit({ git: { autoCreatePr: false } }).autoCreatePr).toBe(false);
    expect(sanitizeGit({ git: { autoCreatePr: true } }).autoCreatePr).toBe(true);
    expect(sanitizeGit({ git: {} }).autoCreatePr).toBe(DEFAULT_DASHBOARD_SETTINGS.git.autoCreatePr);
  });

  it("sanitizes featureBranchPrefix correctly", () => {
    expect(sanitizeGit({ git: { featureBranchPrefix: "feat/" } }).featureBranchPrefix).toBe("feat/");
    expect(sanitizeGit({ git: { featureBranchPrefix: "   " } }).featureBranchPrefix).toBe(DEFAULT_DASHBOARD_SETTINGS.git.featureBranchPrefix);
  });

  it("sanitizes sprintBranchScheme correctly", () => {
    expect(sanitizeGit({ git: { sprintBranchScheme: "custom/{id}" } }).sprintBranchScheme).toBe("custom/{id}");
    expect(sanitizeGit({ git: { sprintBranchScheme: "   " } }).sprintBranchScheme).toBe(DEFAULT_DASHBOARD_SETTINGS.git.sprintBranchScheme);
  });
});
