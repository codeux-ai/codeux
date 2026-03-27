import { describe, it, expect } from "vitest";
import { resolveMainBranchPrBody } from "../../../src/sprint/sprint-orchestrator.js";

describe("resolveMainBranchPrBody", () => {
  const defaultArgs = {
    featureBranch: "feature/sprint-1",
    defaultBranch: "main",
    sprintNumber: 1,
    sprintDescription: "A sprint to add testing capabilities.",
  };

  it("handles all tasks completed with mixed providers", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "COMPLETED", provider: "claude-code" },
        { id: "T02", title: "Task 2", status: "COMPLETED", provider: "gemini" },
        { id: "T03", title: "Task 3", status: "COMPLETED", provider: "jules" },
        { id: "T04", title: "Task 4", status: "COMPLETED", provider: "claude-code" },
      ],
    });

    expect(body).toContain("**4/4 tasks completed**");
    expect(body).toContain("2 by claude-code");
    expect(body).toContain("1 by gemini");
    expect(body).toContain("1 by jules");

    expect(body).toContain("- [x] **T01**: Task 1 — `claude-code`");
    expect(body).toContain("- [x] **T02**: Task 2 — `gemini`");
    expect(body).toContain("- [x] **T03**: Task 3 — `jules`");
    expect(body).toContain("- [x] **T04**: Task 4 — `claude-code`");
  });

  it("handles mixed status tasks", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "COMPLETED", provider: "claude-code" },
        { id: "T02", title: "Task 2", status: "FAILED", provider: "gemini" },
        { id: "T03", title: "Task 3", status: "RUNNING", provider: "jules" },
      ],
    });

    expect(body).toContain("**1/3 tasks completed**");
    expect(body).toContain("1 by claude-code");

    expect(body).toContain("- [x] **T01**: Task 1");
    expect(body).toContain("- [ ] **T02**: Task 2");
    expect(body).toContain("- [ ] **T03**: Task 3");
  });

  it("renders PR URLs as markdown links", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "COMPLETED", provider: "jules", pr_url: "https://github.com/test/pull/1" },
      ],
    });

    expect(body).toContain("- [x] **T01**: Task 1 — `jules` ([PR](https://github.com/test/pull/1))");
  });

  it("omits provider label when provider is not specified", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "COMPLETED" },
      ],
    });

    expect(body).toContain("- [x] **T01**: Task 1\n"); // No backticks
    expect(body).not.toContain("`undefined`");
  });

  it("treats CODING_COMPLETED with merge settled (is_merged: true) as completed", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "CODING_COMPLETED", is_merged: true },
      ],
    });

    expect(body).toContain("- [x] **T01**: Task 1");
    expect(body).toContain("**1/1 tasks completed**");
  });

  it("treats CODING_COMPLETED with merge settled (merge_indicator: MERGED) as completed", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "CODING_COMPLETED", merge_indicator: "MERGED" },
      ],
    });

    expect(body).toContain("- [x] **T01**: Task 1");
    expect(body).toContain("**1/1 tasks completed**");
  });

  it("treats CODING_COMPLETED with merge settled (merge_indicator: AUTOMERGE) as completed", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "CODING_COMPLETED", merge_indicator: "AUTOMERGE" },
      ],
    });

    expect(body).toContain("- [x] **T01**: Task 1");
    expect(body).toContain("**1/1 tasks completed**");
  });

  it("treats CODING_COMPLETED without merge settled as incomplete", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [
        { id: "T01", title: "Task 1", status: "CODING_COMPLETED", is_merged: false },
        { id: "T02", title: "Task 2", status: "CODING_COMPLETED" },
      ],
    });

    expect(body).toContain("- [ ] **T01**: Task 1");
    expect(body).toContain("- [ ] **T02**: Task 2");
    expect(body).toContain("**0/2 tasks completed**");
  });

  it("falls back to minimal body format with an empty subtasks array", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: [],
    });

    expect(body).toContain("Automated sprint completion PR opened by Sprint OS.");
    expect(body).toContain("Sprint: 1");
    expect(body).toContain("**Sprint Context:**\nA sprint to add testing capabilities.");
    expect(body).toContain(`Base: \`main\``);
    expect(body).toContain(`Head: \`feature/sprint-1\``);
    expect(body).not.toContain("tasks completed"); // Minimal format omits this
  });

  it("falls back to minimal body format when subtasks is undefined", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      subtasks: undefined,
    });

    expect(body).toContain("Automated sprint completion PR opened by Sprint OS.");
    expect(body).toContain("Sprint: 1");
    expect(body).toContain(`Base: \`main\``);
    expect(body).toContain(`Head: \`feature/sprint-1\``);
    expect(body).not.toContain("tasks completed");
  });

  it("handles empty sprint description", () => {
    const body = resolveMainBranchPrBody({
      ...defaultArgs,
      sprintDescription: "",
      subtasks: [],
    });

    expect(body).toContain("**Sprint Context:**\nNo sprint description provided.");
  });

  it("handles missing sprint name/number gracefully", () => {
    const body = resolveMainBranchPrBody({
      featureBranch: "feature/x",
      defaultBranch: "main",
      subtasks: [],
    });

    expect(body).toContain("Sprint: not recorded");
  });
});
