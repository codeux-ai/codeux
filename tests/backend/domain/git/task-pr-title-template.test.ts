import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_PR_TITLE_SCHEME,
  formatTaskPrTitle,
  resolveTaskPrSprintTag,
} from "../../../../src/domain/git/task-pr-title-template.js";

describe("formatTaskPrTitle", () => {
  it("renders a linked Jira issue tag with the real task title", () => {
    const title = formatTaskPrTitle({
      scheme: "({sprint_tag}) {task_key}: {task_title}",
      sprintKeyPrefix: "SPR",
      sprint: {
        id: "sprint-40",
        number: 40,
        name: "Importer hardening",
        linkedIssues: [{ issueKey: "CODUX-40" }],
      },
      task: {
        id: "task-1",
        taskKey: "Task 1",
        title: "This is the real task title",
      },
      provider: "codex",
    });

    expect(title).toBe("(CODUX-40) Task 1: This is the real task title");
  });

  it("uses the default scheme with sprint tag and task title", () => {
    const title = formatTaskPrTitle({
      scheme: DEFAULT_TASK_PR_TITLE_SCHEME,
      sprintKeyPrefix: "SPR",
      sprint: {
        id: "sprint-12",
        number: 12,
        slug: "settings-cleanup",
        linkedIssues: [],
      },
      task: {
        id: "T01",
        title: "Add title template setting",
      },
    });

    expect(title).toBe("(SPR-12) Add title template setting");
  });

  it("falls back to the configured sprint key prefix plus sprint number", () => {
    expect(resolveTaskPrSprintTag({
      id: "sprint-12",
      number: 12,
      linkedIssues: [],
    }, "SPR")).toBe("SPR-12");
  });

  it("falls back to a stable sprint slug or id when no issue key or number exists", () => {
    expect(resolveTaskPrSprintTag({
      id: "sprint-row-id",
      slug: "checkout-repair",
      number: null,
      linkedIssues: [],
    }, "SPR")).toBe("checkout-repair");

    expect(resolveTaskPrSprintTag({
      id: "sprint-row-id",
      number: null,
      linkedIssues: [],
    }, "SPR")).toBe("sprint-row-id");
  });

  it("keeps provider available only when the template asks for it", () => {
    const withoutProvider = formatTaskPrTitle({
      scheme: "({sprint_tag}) {task_title}",
      sprintKeyPrefix: "SPR",
      sprint: { number: 3, linkedIssues: [] },
      task: { id: "task-3", title: "Create PR body" },
      provider: "codex",
    });
    const withProvider = formatTaskPrTitle({
      scheme: "({sprint_tag}) {task_title} [{provider}]",
      sprintKeyPrefix: "SPR",
      sprint: { number: 3, linkedIssues: [] },
      task: { id: "task-3", title: "Create PR body" },
      provider: "codex",
    });

    expect(withoutProvider).toBe("(SPR-3) Create PR body");
    expect(withProvider).toBe("(SPR-3) Create PR body [codex]");
  });

  it("preserves unknown tokens so template mistakes remain visible", () => {
    const title = formatTaskPrTitle({
      scheme: "{unknown_token} {task_title}",
      sprintKeyPrefix: "SPR",
      sprint: { number: 2, linkedIssues: [] },
      task: { id: "task-2", title: "Wire defaults" },
    });

    expect(title).toBe("{unknown_token} Wire defaults");
  });

  it("collapses whitespace and falls back to a safe task title when the template renders empty", () => {
    const spaced = formatTaskPrTitle({
      scheme: "  ({sprint_tag})    {task_title}\n\t{provider}  ",
      sprintKeyPrefix: "SPR",
      sprint: { number: 8, linkedIssues: [] },
      task: { id: "task-8", title: "   Normalize    output   " },
      provider: "codex",
    });
    const fallback = formatTaskPrTitle({
      scheme: " \n\t ",
      sprintKeyPrefix: "SPR",
      sprint: { number: 9, linkedIssues: [] },
      task: { id: "task-9", title: "   Real task title   " },
    });

    expect(spaced).toBe("(SPR-8) Normalize output codex");
    expect(fallback).toBe("Real task title");
  });
});
