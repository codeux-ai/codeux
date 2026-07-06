import { describe, expect, it } from "vitest";
import {
  buildIssueImportCompactState,
  buildIssueImportFilterSummaryChips,
  buildIssueImportMetadataRows,
  getIssueImportActiveFilterCount,
  getIssueImportActiveFilterCountLabel,
  getIssueImportDefaultSortLabel,
  getIssueImportEmptyStateCopy,
  getIssueImportErrorCopy,
  getIssueImportProviderMetadata,
  getIssueImportSelectedResultCountLabel,
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

  it("falls back to GitHub metadata for invalid or empty provider values", () => {
    expect(getIssueImportProviderMetadata("unknown")).toMatchObject({
      provider: "github",
      label: "GitHub",
      importLabel: "GitHub issue import",
      icon: "github",
    });
    expect(getIssueImportProviderMetadata(null)).toMatchObject({
      provider: "github",
      label: "GitHub",
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

  it("builds provider-neutral filter summary chips in priority order", () => {
    const chips = buildIssueImportFilterSummaryChips([
      { id: "state", label: "State", value: "open", defaultValue: "open", alwaysShow: true, priority: 20 },
      { id: "labels", label: "Labels", value: ["bug", "", "quality"], priority: 10 },
      { id: "assignee", label: "Assignee", value: "  ", priority: 5 },
      { id: "limit", label: "Limit", value: 40, defaultValue: 40, defaultLabel: "40 results", alwaysShow: true, priority: 30 },
      { id: "jql", label: "JQL", value: "project = OPS", priority: 1 },
    ]);

    expect(chips).toEqual([
      { id: "jql", label: "JQL", value: "project = OPS", active: true },
      { id: "labels", label: "Labels", value: "bug, quality", active: true },
      { id: "state", label: "State", value: "open", active: false },
      { id: "limit", label: "Limit", value: "40", active: false },
    ]);
  });

  it("counts active filters without counting empty or defaulted values", () => {
    const filters = [
      { id: "provider", label: "Provider", value: "github", defaultValue: "github", alwaysShow: true },
      { id: "search", label: "Search", value: "pipeline" },
      { id: "labels", label: "Labels", value: ["bug"] },
      { id: "assignee", label: "Assignee", value: "" },
      { id: "limit", label: "Limit", value: 40, defaultValue: 40 },
    ];

    expect(getIssueImportActiveFilterCount(filters)).toBe(2);
    expect(getIssueImportActiveFilterCountLabel(0)).toBe("No active filters");
    expect(getIssueImportActiveFilterCountLabel(1)).toBe("1 active filter");
    expect(getIssueImportActiveFilterCountLabel(3)).toBe("3 active filters");
  });

  it("formats default sort and selected result count labels", () => {
    expect(getIssueImportDefaultSortLabel("updated", "desc", [
      { value: "updated", label: "Updated" },
    ])).toBe("Updated, Newest first");
    expect(getIssueImportDefaultSortLabel("priority", "asc", [
      { value: "priority", label: "Priority" },
    ], [
      { value: "asc", label: "Low to high" },
    ])).toBe("Priority, Low to high");
    expect(getIssueImportDefaultSortLabel(null, null)).toBe("Default");

    expect(getIssueImportSelectedResultCountLabel(0, 0)).toBe("0 selected issues across 0 visible results.");
    expect(getIssueImportSelectedResultCountLabel(1, 10)).toBe("1 selected issue across 10 visible results.");
    expect(getIssueImportSelectedResultCountLabel(3, 20, 100)).toBe(
      "3 selected issues across 20 visible of 100 results.",
    );
  });

  it("builds compact importer state from filters, sort, and selection", () => {
    expect(buildIssueImportCompactState({
      filters: [
        { id: "state", label: "State", value: "open", defaultValue: "open", alwaysShow: true },
        { id: "labels", label: "Labels", value: ["security"], priority: -1 },
      ],
      selectedCount: 2,
      visibleCount: 12,
      totalCount: 12,
      sortField: "created",
      sortDirection: "asc",
      sortFieldOptions: [{ value: "created", label: "Created" }],
    })).toEqual({
      chips: [
        { id: "labels", label: "Labels", value: "security", active: true },
        { id: "state", label: "State", value: "open", active: false },
      ],
      activeFilterCount: 1,
      activeFilterCountLabel: "1 active filter",
      sortLabel: "Created, Oldest first",
      selectedCountLabel: "2 selected issues across 12 visible results.",
    });
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

  it("builds GitLab issue metadata rows with provider metadata and sanitized values", () => {
    const rows = buildIssueImportMetadataRows({
      provider: "gitlab",
      repository: "group/project",
      issueNumber: 18,
      state: "closed",
      issueType: "Incident",
      priority: "Medium",
      issueAuthor: "Grace Hopper",
      issueCommentCount: -3,
      createdAt: "",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });

    expect(rows.slice(0, 7)).toEqual([
      { id: "provider", label: "Provider", value: "GitLab" },
      { id: "repository", label: "Repository", value: "group/project" },
      { id: "issue", label: "Issue", value: "#18" },
      { id: "state", label: "State", value: "closed" },
      { id: "type", label: "Type", value: "Incident" },
      { id: "priority", label: "Priority", value: "Medium" },
      { id: "author", label: "Author", value: "Grace Hopper" },
    ]);
    expect(rows).toContainEqual({ id: "comments", label: "Comments", value: "0" });
    expect(rows.find((row) => row.id === "updated")?.value).toMatch(/\d{4}|May/);
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
