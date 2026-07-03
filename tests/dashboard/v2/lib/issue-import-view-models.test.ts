import { describe, expect, it } from "vitest";
import {
  buildIssueImportMetadataRows,
  getIssueImportEmptyStateCopy,
  getIssueImportErrorCopy,
  getIssueImportProviderMetadata,
  getSelectedIssueCountLabel,
  truncateIssueImportAssignees,
  truncateIssueImportLabels,
} from "../../../../dashboard/src/v2/lib/issue-import-view-models.js";

describe("issue import view models", () => {
  it("returns display metadata for GitHub, GitLab, and Jira", () => {
    expect(getIssueImportProviderMetadata("github")).toMatchObject({
      provider: "github",
      label: "GitHub",
      importLabel: "GitHub issue import",
      icon: "github",
    });
    expect(getIssueImportProviderMetadata("gitlab")).toMatchObject({
      provider: "gitlab",
      label: "GitLab",
      importLabel: "GitLab issue import",
      icon: "gitlab",
    });
    expect(getIssueImportProviderMetadata("jira")).toMatchObject({
      provider: "jira",
      label: "Jira",
      importLabel: "Jira issue import",
      icon: "jira",
    });
  });

  it("allows typed provider accent overrides", () => {
    const metadata = getIssueImportProviderMetadata("github", {
      badgeClassName: "custom-badge",
    });

    expect(metadata.accent.badgeClassName).toBe("custom-badge");
    expect(metadata.accent.selectedCardClassName).toContain("signal");
  });

  it("formats zero, one, and many selected issue labels", () => {
    expect(getSelectedIssueCountLabel(0)).toBe("No issues selected.");
    expect(getSelectedIssueCountLabel(1)).toBe("1 selected issue will be imported.");
    expect(getSelectedIssueCountLabel(3)).toBe("3 selected issues will be imported.");
  });

  it("formats linked and special task selected issue labels", () => {
    expect(getSelectedIssueCountLabel(3, 2, 1)).toBe(
      "3 selected issues will be imported. 2 linked, 1 special task.",
    );
    expect(getSelectedIssueCountLabel(4, 1, 3)).toBe(
      "4 selected issues will be imported. 1 linked, 3 special tasks.",
    );
  });

  it("builds repository issue metadata rows with fallbacks", () => {
    const rows = buildIssueImportMetadataRows({
      provider: "github",
      repository: "codeux-ai/codeux",
      issueNumber: 42,
      state: "open",
      issueAuthor: "octocat",
      issueCommentCount: 0,
      updatedAt: "not-a-date",
    });

    expect(rows).toEqual([
      { id: "provider", label: "Provider", value: "GitHub" },
      { id: "repository", label: "Repository", value: "codeux-ai/codeux" },
      { id: "issue", label: "Issue", value: "#42" },
      { id: "state", label: "State", value: "open" },
      { id: "author", label: "Author", value: "octocat" },
      { id: "comments", label: "Comments", value: "0" },
      { id: "updated", label: "Updated", value: "not-a-date" },
    ]);
  });

  it("builds Jira issue metadata rows from project and issue keys", () => {
    const rows = buildIssueImportMetadataRows({
      provider: "jira",
      projectKey: "OPS",
      issueKey: "OPS-7",
      state: "in_progress",
      issueType: "Bug",
      priority: "High",
      issueReporter: "Ada Lovelace",
      issueMilestone: "Q3",
    });

    expect(rows).toEqual([
      { id: "provider", label: "Provider", value: "Jira" },
      { id: "repository", label: "Project", value: "OPS" },
      { id: "issue", label: "Issue", value: "OPS-7" },
      { id: "state", label: "State", value: "in progress" },
      { id: "type", label: "Type", value: "Bug" },
      { id: "priority", label: "Priority", value: "High" },
      { id: "reporter", label: "Reporter", value: "Ada Lovelace" },
      { id: "milestone", label: "Milestone", value: "Q3" },
    ]);
  });

  it("uses safe metadata fallbacks for missing values", () => {
    const rows = buildIssueImportMetadataRows({
      provider: "gitlab",
      state: null,
    });

    expect(rows).toEqual([
      { id: "provider", label: "Provider", value: "GitLab" },
      { id: "state", label: "State", value: "Unknown" },
    ]);
  });

  it("truncates labels and assignees with duplicate and empty values removed", () => {
    expect(truncateIssueImportLabels(["bug", "", "security", "bug", "quality"], 2)).toEqual({
      visible: ["bug", "security"],
      overflowCount: 1,
      overflowLabel: "+1 more",
    });

    expect(truncateIssueImportAssignees(["Ada", null, "Grace", "Linus"], 2)).toEqual({
      visible: ["Ada", "Grace"],
      overflowCount: 1,
      overflowLabel: "+1 more",
    });
  });

  it("returns provider-specific empty state copy", () => {
    expect(getIssueImportEmptyStateCopy("jira", false)).toEqual({
      title: "Search Jira issues",
      description: "Choose filters and run a search to preview importable sprint context.",
    });
    expect(getIssueImportEmptyStateCopy("gitlab", true)).toEqual({
      title: "No GitLab issues found",
      description: "Adjust the filters, broaden the repository scope, or search for an exact issue key.",
    });
  });

  it("returns safe error copy for unknown errors", () => {
    expect(getIssueImportErrorCopy(new Error("Repository is required."))).toEqual({
      title: "Issue import failed",
      message: "Repository is required.",
    });
    expect(getIssueImportErrorCopy(null)).toEqual({
      title: "Issue import failed",
      message: "The issue search could not be completed. Check the filters and try again.",
    });
  });
});
