import { describe, expect, it } from "vitest";
import { sanitizeGit, sanitizePrDescriptionSections } from "../../../../../src/domain/settings/settings-sanitizers/git-sanitizer.js";

describe("sanitizeGit", () => {
  it("resolves github token from external hints", () => {
    const result = sanitizeGit({}, {
      resolved: { githubToken: "gh-token", julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "" },
      env: {},
      settingsJson: {},
    });
    expect(result.githubToken).toBe("");
    expect(result.githubTokenCredentialRef).toBeNull();
  });

  it("prioritizes input token", () => {
    const result = sanitizeGit({ git: { githubToken: "explicit-gh-token" } }, {
      resolved: { githubToken: "gh-token", julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "" },
      env: {},
      settingsJson: {},
    });
    expect(result.githubToken).toBe("");
  });

  it("defaults prDescription to all-enabled when not stored (backward compat)", () => {
    const result = sanitizeGit({});
    expect(result.prDescription.task.summary).toBe(true);
    expect(result.prDescription.task.fullPrompt).toBe(true);
    expect(result.prDescription.sprint.planningModel).toBe(true);
    expect(result.prDescription.sprint.mainPrompt).toBe(true);
  });
});

describe("sanitizePrDescriptionSections", () => {
  it("defaults every field to true when input is undefined", () => {
    const result = sanitizePrDescriptionSections(undefined);
    expect(Object.values(result.task).every((v) => v === true)).toBe(true);
    expect(Object.values(result.sprint).every((v) => v === true)).toBe(true);
  });

  it("preserves explicit false values", () => {
    const result = sanitizePrDescriptionSections({
      task: { tokenUsage: false } as any,
      sprint: { qaFindings: false } as any,
    });
    expect(result.task.tokenUsage).toBe(false);
    expect(result.task.summary).toBe(true);
    expect(result.sprint.qaFindings).toBe(false);
    expect(result.sprint.summary).toBe(true);
  });

  it("defaults non-boolean garbage values to true", () => {
    const result = sanitizePrDescriptionSections({
      task: { fullPrompt: "nope" } as any,
      sprint: { mainPrompt: 0 } as any,
    });
    expect(result.task.fullPrompt).toBe(true);
    expect(result.sprint.mainPrompt).toBe(true);
  });

  it("defaults section order to the natural default order when not stored", () => {
    const result = sanitizePrDescriptionSections(undefined);
    expect(result.taskSectionOrder).toEqual(["summary", "modelAndProvider", "timing", "tokenUsage", "qaFindings", "fullPrompt", "branchInfo"]);
    expect(result.sprintSectionOrder[0]).toBe("summary");
  });

  it("preserves a valid custom section order", () => {
    const result = sanitizePrDescriptionSections({
      taskSectionOrder: ["branchInfo", "summary", "timing", "tokenUsage", "qaFindings", "fullPrompt", "modelAndProvider"] as any,
    });
    expect(result.taskSectionOrder).toEqual(["branchInfo", "summary", "timing", "tokenUsage", "qaFindings", "fullPrompt", "modelAndProvider"]);
  });

  it("drops unknown keys and appends missing known keys for a partial/garbage order", () => {
    const result = sanitizePrDescriptionSections({
      taskSectionOrder: ["summary", "not-a-real-section", "summary"] as any,
    });
    expect(result.taskSectionOrder[0]).toBe("summary");
    expect(result.taskSectionOrder).not.toContain("not-a-real-section");
    expect(result.taskSectionOrder).toHaveLength(7);
  });

  it("falls back to the default order when the stored value isn't an array", () => {
    const result = sanitizePrDescriptionSections({ sprintSectionOrder: "nope" as any });
    expect(result.sprintSectionOrder).toHaveLength(9);
  });
});
