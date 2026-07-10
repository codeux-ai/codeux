import { describe, expect, it } from "vitest";
import { buildLinkedIssuePromptBlock, buildTaskBundle, mergePromptWithLinkedIssues, parseTaskBundle } from "../../../dashboard/src/v2/lib/markdown-transfer.js";

describe("markdown-transfer", () => {
  it("builds a deterministic task bundle with file markers", () => {
    const bundle = buildTaskBundle([
      { fileName: "T01.md", markdown: "title: One\nprompt:\nDo one" },
      { fileName: "T02.md", markdown: "title: Two\nprompt:\nDo two" },
    ]);

    expect(bundle).toContain("--- FILE: T01.md ---");
    expect(bundle).toContain("--- FILE: T02.md ---");
  });

  it("parses task bundles split by file markers", () => {
    const tasks = parseTaskBundle([
      "--- FILE: T01.md ---",
      "title: One",
      "prompt:",
      "Do one",
      "",
      "--- FILE: T02.md ---",
      "title: Two",
      "depends_on: [\"T01\"]",
      "prompt:",
      "Do two",
    ].join("\n"));

    expect(tasks).toEqual([
      { taskKey: "T01", markdown: "title: One\nprompt:\nDo one" },
      { taskKey: "T02", markdown: "title: Two\ndepends_on: [\"T01\"]\nprompt:\nDo two" },
    ]);
  });

  it("builds linked issue prompt context", () => {
    const block = buildLinkedIssuePromptBlock([
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "openai/example",
        issueNumber: 42,
        issueKey: "#42",
        title: "Fix import UX",
        url: "https://github.com/openai/example/issues/42",
        labels: ["ux", "import"],
        assignees: ["pierre"],
      },
    ]);

    expect(block).toContain("## Linked Issues");
    expect(block).toContain("[GITHUB openai/example#42](https://github.com/openai/example/issues/42)");
    expect(block).toContain("Labels: `ux`, `import`");
  });

  it("renders full imported issue text and optional conversation context", () => {
    const block = buildLinkedIssuePromptBlock([
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "openai/example",
        issueNumber: 42,
        issueKey: "#42",
        title: "Fix import UX",
        url: "https://github.com/openai/example/issues/42",
        state: "open",
        labels: ["ux"],
        assignees: ["pierre"],
        issueAuthor: "alice",
        issueCreatedAt: "2026-05-16T10:00:00.000Z",
        issueUpdatedAt: "2026-05-17T10:00:00.000Z",
        issueBodyMarkdown: "Full issue body\n\n- preserve this acceptance criterion",
        issueConversationMarkdown: "##### Comment 1 - @bob\n\nFollow-up context",
        includeConversation: true,
      },
    ]);

    expect(block).toContain("### GITHUB openai/example#42: Fix import UX");
    expect(block).toContain("#### Issue Body");
    expect(block).toContain("Full issue body");
    expect(block).toContain("#### Conversation");
    expect(block).toContain("Follow-up context");
  });

  it("merges linked issue context once", () => {
    const issue = {
      provider: "gitlab" as const,
      hostDomain: "gitlab.com",
      repository: "group/project",
      issueNumber: 7,
      issueKey: "#7",
      title: "Add filters",
      url: "https://gitlab.com/group/project/-/issues/7",
    };

    const merged = mergePromptWithLinkedIssues("Plan the sprint.", [issue]);
    expect(merged.match(/## Linked Issues/g)).toHaveLength(1);
    expect(mergePromptWithLinkedIssues(merged, [issue]).match(/## Linked Issues/g)).toHaveLength(1);
  });

  it("preserves existing linked issue bodies when resubmitted linked issues only include metadata", () => {
    const existing = `${[
      "Plan the sprint.",
      "",
      "## Linked Issues",
      "",
      "### GITHUB openai/example#42: Fix import UX",
      "",
      "- Source: [GITHUB openai/example#42](https://github.com/openai/example/issues/42)",
      "",
      "#### Issue Body",
      "",
      "Existing body that should stay attached to the sprint.",
    ].join("\n")}\n`;

    const merged = mergePromptWithLinkedIssues(existing, [
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "openai/example",
        issueNumber: 42,
        issueKey: "#42",
        title: "Fix import UX",
        url: "https://github.com/openai/example/issues/42",
        state: "open",
        labels: ["ux"],
        issueBodyMarkdown: " ",
        issueConversationMarkdown: "\n",
      },
    ]);

    expect(merged).toBe(existing);
    expect(merged).toContain("Existing body that should stay attached to the sprint.");
    expect(merged).not.toContain("_No issue body was provided._");
  });

  it("refreshes existing linked issue context when resubmitted linked issues include body text", () => {
    const existing = [
      "Plan the sprint.",
      "",
      "## Linked Issues",
      "",
      "### GITHUB openai/example#42: Fix import UX",
      "",
      "#### Issue Body",
      "",
      "Stale body.",
    ].join("\n");

    const merged = mergePromptWithLinkedIssues(existing, [
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "openai/example",
        issueNumber: 42,
        issueKey: "#42",
        title: "Fix import UX",
        url: "https://github.com/openai/example/issues/42",
        issueBodyMarkdown: "Fresh imported body.",
      },
    ]);

    expect(merged.match(/## Linked Issues/g)).toHaveLength(1);
    expect(merged).toContain("Fresh imported body.");
    expect(merged).not.toContain("Stale body.");
  });

  it("removes stale linked issue context when all linked issues are removed", () => {
    const merged = mergePromptWithLinkedIssues("Goal\n\n## Linked Issues\n\nStale issue context", []);

    expect(merged).toBe("Goal");
  });
});
