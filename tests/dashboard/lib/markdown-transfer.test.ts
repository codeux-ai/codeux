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
    expect(block).toContain("[Fix import UX](https://github.com/openai/example/issues/42)");
    expect(block).toContain("labels: `ux`, `import`");
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
});
