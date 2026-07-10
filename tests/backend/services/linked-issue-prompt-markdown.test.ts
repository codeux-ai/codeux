import { describe, expect, it } from "vitest";
import type { IssuePromptContext, SprintLinkedIssueInput } from "../../../src/contracts/project-management-types.js";
import { buildLinkedIssuePromptBlock, mergePromptWithLinkedIssues } from "../../../src/services/linked-issue-prompt-markdown.js";

describe("linked-issue-prompt-markdown", () => {
  it("formats GitHub issue context with body metadata and default conversation inclusion", () => {
    const issue: IssuePromptContext = {
      provider: "github",
      hostDomain: "github.com",
      repository: "codeux-ai/codeux",
      issueNumber: 42,
      issueKey: "#42",
      title: "Preserve imported issue bodies",
      url: "https://github.com/codeux-ai/codeux/issues/42",
      state: "open",
      labels: ["planning", "mcp"],
      assignees: ["alice"],
      issueAuthor: "bob",
      issueCreatedAt: "2026-06-01T10:00:00.000Z",
      issueUpdatedAt: "2026-06-02T10:00:00.000Z",
      issueBodyMarkdown: "Acceptance criteria:\n\n- Keep the full body\n- Preserve markdown",
      issueConversationMarkdown: "##### Comment 1 - @carol\n\nUse this context too.",
      includeConversation: true,
    };

    const block = buildLinkedIssuePromptBlock([issue]);

    expect(block).toContain("## Linked Issues");
    expect(block).toContain("### GITHUB codeux-ai/codeux#42: Preserve imported issue bodies");
    expect(block).toContain("- Source: [GITHUB codeux-ai/codeux#42](https://github.com/codeux-ai/codeux/issues/42)");
    expect(block).toContain("- State: open");
    expect(block).toContain("- Labels: `planning`, `mcp`");
    expect(block).toContain("- Assignees: @alice");
    expect(block).toContain("- Author: @bob");
    expect(block).toContain("- Created: 2026-06-01T10:00:00.000Z");
    expect(block).toContain("- Updated: 2026-06-02T10:00:00.000Z");
    expect(block).toContain("#### Issue Body\n\nAcceptance criteria:\n\n- Keep the full body\n- Preserve markdown");
    expect(block).toContain("#### Conversation\n\n##### Comment 1 - @carol\n\nUse this context too.");
  });

  it("formats GitLab issue context and excludes conversation when requested", () => {
    const issue: SprintLinkedIssueInput = {
      provider: "gitlab",
      hostDomain: "gitlab.com",
      repository: "group/project",
      issueNumber: 7,
      issueKey: "#7",
      title: "Add backlog filters",
      url: "https://gitlab.com/group/project/-/issues/7",
      state: "opened",
      labels: ["ux"],
      assignees: ["dana"],
      issueBodyMarkdown: "Filter by labels\r\n\r\n- Status stays visible",
      issueConversationMarkdown: "This comment should not be included.",
      includeConversation: false,
    };

    const block = buildLinkedIssuePromptBlock([issue]);

    expect(block).toContain("### GITLAB group/project#7: Add backlog filters");
    expect(block).toContain("Filter by labels\n\n- Status stays visible");
    expect(block).not.toContain("#### Conversation");
    expect(block).not.toContain("This comment should not be included.");
  });

  it("formats Jira issue keys and falls back for empty bodies", () => {
    const issue: IssuePromptContext = {
      provider: "jira",
      hostDomain: "jira.example.com",
      projectKey: "OPS",
      repository: "OPS",
      issueNumber: 123,
      issueKey: "OPS-123",
      title: "Clarify release workflow",
      url: "https://jira.example.com/browse/OPS-123",
      state: "In Progress",
      labels: [],
      assignees: [],
      issueBodyMarkdown: "   ",
      issueConversationMarkdown: "",
      includeConversation: true,
      issueAuthor: null,
      issueCreatedAt: null,
      issueUpdatedAt: null,
    };

    const block = buildLinkedIssuePromptBlock([issue]);

    expect(block).toContain("### JIRA OPSOPS-123: Clarify release workflow");
    expect(block).toContain("- Source: [JIRA OPSOPS-123](https://jira.example.com/browse/OPS-123)");
    expect(block).toContain("#### Issue Body\n\n_No issue body was provided._");
    expect(block).not.toContain("#### Conversation");
  });

  it("replaces an existing linked issues section on repeated merges", () => {
    const firstIssue: SprintLinkedIssueInput = {
      provider: "github",
      hostDomain: "github.com",
      repository: "codeux-ai/codeux",
      issueNumber: 1,
      issueKey: "#1",
      title: "Old issue",
      url: "https://github.com/codeux-ai/codeux/issues/1",
      issueBodyMarkdown: "Old body",
    };
    const secondIssue: SprintLinkedIssueInput = {
      provider: "github",
      hostDomain: "github.com",
      repository: "codeux-ai/codeux",
      issueNumber: 2,
      issueKey: "#2",
      title: "New issue",
      url: "https://github.com/codeux-ai/codeux/issues/2",
      issueBodyMarkdown: "New body",
    };

    const goal = [
      "Plan the sprint.",
      "",
      "## Existing Scope",
      "",
      "Keep this section.",
    ].join("\n");

    const firstMerge = mergePromptWithLinkedIssues(goal, [firstIssue]);
    const secondMerge = mergePromptWithLinkedIssues(firstMerge, [secondIssue]);
    const thirdMerge = mergePromptWithLinkedIssues(secondMerge, [secondIssue]);

    expect(secondMerge.match(/## Linked Issues/g)).toHaveLength(1);
    expect(thirdMerge).toBe(secondMerge);
    expect(secondMerge).toContain("## Existing Scope\n\nKeep this section.");
    expect(secondMerge).not.toContain("Old issue");
    expect(secondMerge).toContain("New issue");
    expect(secondMerge).toContain("New body");
  });

  it("preserves existing linked issue bodies when resubmitted linked issues only include metadata", () => {
    const existing = [
      "Plan the sprint.",
      "",
      "## Linked Issues",
      "",
      "### GITHUB codeux-ai/codeux#2: Existing issue",
      "",
      "- Source: [GITHUB codeux-ai/codeux#2](https://github.com/codeux-ai/codeux/issues/2)",
      "",
      "#### Issue Body",
      "",
      "Existing body that should stay attached to the sprint.",
    ].join("\n");
    const metadataOnlyIssue: SprintLinkedIssueInput = {
      provider: "github",
      hostDomain: "github.com",
      repository: "codeux-ai/codeux",
      issueNumber: 2,
      issueKey: "#2",
      title: "Existing issue",
      url: "https://github.com/codeux-ai/codeux/issues/2",
      state: "open",
      labels: ["planning"],
      assignees: ["alice"],
    };

    const merged = mergePromptWithLinkedIssues(existing, [metadataOnlyIssue]);

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
      "### GITHUB codeux-ai/codeux#2: Existing issue",
      "",
      "#### Issue Body",
      "",
      "Stale body.",
    ].join("\n");
    const refreshedIssue: SprintLinkedIssueInput = {
      provider: "github",
      hostDomain: "github.com",
      repository: "codeux-ai/codeux",
      issueNumber: 2,
      issueKey: "#2",
      title: "Existing issue",
      url: "https://github.com/codeux-ai/codeux/issues/2",
      issueBodyMarkdown: "Fresh imported body.",
    };

    const merged = mergePromptWithLinkedIssues(existing, [refreshedIssue]);

    expect(merged.match(/## Linked Issues/g)).toHaveLength(1);
    expect(merged).toContain("Fresh imported body.");
    expect(merged).not.toContain("Stale body.");
  });

  it("removes stale linked issue context when there are no valid issues", () => {
    const merged = mergePromptWithLinkedIssues("Goal\n\n## Linked Issues\n\nStale issue context", []);

    expect(merged).toBe("Goal");
  });
});
