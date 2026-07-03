/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SprintJiraImportModal } from "../../../../../dashboard/src/v2/components/sprints/SprintJiraImportModal";
import { fetchProjectEffectiveSettings } from "../../../../../dashboard/src/v2/lib/settings-api";
import { fetchProjectIssuePromptContexts, searchJiraIssues } from "../../../../../dashboard/src/v2/lib/project-api";

expect.extend(matchers);

vi.mock("../../../../../dashboard/src/v2/lib/settings-api", () => ({
  fetchProjectEffectiveSettings: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/lib/project-api", () => ({
  searchJiraIssues: vi.fn(),
  fetchProjectIssuePromptContexts: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseIssue = {
  key: "OPS-42",
  title: "Import Jira backlog",
  url: "https://acme.atlassian.net/browse/OPS-42",
  state: "In Progress",
  labels: ["jira"],
  assignees: ["Pierre"],
  projectKey: "OPS",
  issueType: "Story",
  priority: "High",
  bodyPreview: "Full Jira issue body.",
  updatedAt: "2026-05-20T10:00:00.000+0000",
  createdAt: "2026-05-01T10:00:00.000+0000",
  issueAuthor: "Reporter One",
  issueReporter: "Reporter One",
  issueMilestone: null,
  issueCommentCount: 2,
  sourceProvider: "jira" as const,
};

describe("SprintJiraImportModal", () => {
  it("loads the default project key and uses guided Jira filters", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "ops" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue]);
    vi.mocked(fetchProjectIssuePromptContexts).mockResolvedValue([] as never);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          projectKey: "OPS",
          issueKey: "",
          search: "",
          status: "open",
          assigneeText: "",
          reporterText: "",
          issueType: "",
          priority: "",
          labels: [],
          updatedAfter: "",
          updatedBefore: "",
          sortField: "updated",
          sortDirection: "desc",
          limit: 40,
          jql: "",
        }),
        expect.any(AbortSignal),
      );
    });

    expect(screen.getByDisplayValue("OPS")).toBeInTheDocument();
  });

  it("supports exact keys, user filters, labels, date windows, sort controls, and JQL override", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue]);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalled();
    });

    fireEvent.input(screen.getByPlaceholderText("OPS-42"), { target: { value: "OPS-77" } });
    fireEvent.input(screen.getByPlaceholderText("Search title, description, or key"), {
      target: { value: "backlog" },
    });
    fireEvent.input(screen.getByLabelText("Jira assignee"), { target: { value: "me" } });
    fireEvent.input(screen.getByLabelText("Jira reporter"), { target: { value: "currentUser()" } });
    fireEvent.input(screen.getByPlaceholderText("Bug, Story, Epic"), { target: { value: "Bug" } });
    fireEvent.input(screen.getByPlaceholderText("High, Critical, Medium"), { target: { value: "Critical" } });

    fireEvent.input(screen.getByPlaceholderText("Optional Jira labels, press Enter to add"), {
      target: { value: "security" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Optional Jira labels, press Enter to add"), {
      key: "Enter",
    });

    fireEvent.input(screen.getByLabelText("Updated after"), { target: { value: "2026-05-01" } });
    fireEvent.input(screen.getByLabelText("Updated before"), { target: { value: "2026-05-31" } });
    fireEvent.change(screen.getByLabelText("Sort field"), { target: { value: "priority" } });
    fireEvent.change(screen.getByLabelText("Sort direction"), { target: { value: "asc" } });

    fireEvent.click(screen.getByText("Advanced JQL override"));
    fireEvent.input(screen.getByPlaceholderText("project = OPS AND labels in (security)"), {
      target: { value: "project = OPS AND labels in (security)" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({
          projectKey: "OPS",
          issueKey: "OPS-77",
          search: "backlog",
          assigneeText: "me",
          reporterText: "currentUser()",
          issueType: "Bug",
          priority: "Critical",
          labels: ["security"],
          updatedAfter: "2026-05-01",
          updatedBefore: "2026-05-31",
          limit: 40,
          jql: "project = OPS AND labels in (security)",
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it("supports bulk selection, clear all, and append-conversation toggles", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([
      baseIssue,
      {
        ...baseIssue,
        key: "OPS-99",
        title: "Follow-up backlog cleanup",
        url: "https://acme.atlassian.net/browse/OPS-99",
        issueType: "Task",
      },
    ]);
    const onImport = vi.fn();

    render(
      <SprintJiraImportModal
        projectId="project-1"
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Import Jira backlog")).toBeInTheDocument();
      expect(screen.getByText("Follow-up backlog cleanup")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /select all visible/i }));
    expect(screen.getByText(/2 selected issues will be imported/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 visible results selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/append conversation to all selected/i));
    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    expect(screen.getByText("No issues selected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import issues disabled until jira issues are selected/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /select all visible/i }));
    fireEvent.click(screen.getByLabelText(/append conversation to all selected/i));
    fireEvent.click(screen.getByRole("button", { name: /import issues/i }));

    await waitFor(() => {
      expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith("project-1", [
        {
          provider: "jira",
          hostDomain: "acme.atlassian.net",
          projectKey: "OPS",
          repository: "OPS",
          issueNumber: 42,
          issueKey: "OPS-42",
          title: "Import Jira backlog",
          url: "https://acme.atlassian.net/browse/OPS-42",
          state: "In Progress",
          labels: ["jira"],
          assignees: ["Pierre"],
          includeConversation: false,
        },
        {
          provider: "jira",
          hostDomain: "acme.atlassian.net",
          projectKey: "OPS",
          repository: "OPS",
          issueNumber: 99,
          issueKey: "OPS-99",
          title: "Follow-up backlog cleanup",
          url: "https://acme.atlassian.net/browse/OPS-99",
          state: "In Progress",
          labels: ["jira"],
          assignees: ["Pierre"],
          includeConversation: false,
        },
      ]);
      expect(onImport).toHaveBeenCalledTimes(1);
    });
  });

  it("preserves stored special-task mode through refreshed results and emits special payloads", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(searchJiraIssues)
      .mockResolvedValueOnce([
        baseIssue,
        {
          ...baseIssue,
          key: "OPS-13",
          title: "Security hardening follow-up",
          url: "https://acme.atlassian.net/browse/OPS-13",
          issueType: "Security",
          priority: "High",
          labels: ["security", "hardening"],
          bodyPreview: "This issue tracks a security fix.",
        },
      ])
      .mockResolvedValueOnce([
        baseIssue,
        {
          ...baseIssue,
          key: "OPS-13",
          title: "Security hardening follow-up",
          url: "https://acme.atlassian.net/browse/OPS-13",
          issueType: "Task",
          priority: "Medium",
          labels: ["ops"],
          bodyPreview: "Routine follow-up work after the original review.",
        },
      ]);
    vi.mocked(fetchProjectIssuePromptContexts).mockResolvedValue([
      {
        provider: "jira",
        hostDomain: "acme.atlassian.net",
        repository: "OPS",
        issueNumber: 42,
        issueKey: "OPS-42",
        title: "Import Jira backlog",
        url: "https://acme.atlassian.net/browse/OPS-42",
        state: "In Progress",
        labels: ["jira"],
        assignees: ["Pierre"],
        issueBodyMarkdown: "Full Jira issue body.",
        issueConversationMarkdown: "Conversation text.",
        includeConversation: true,
        issueAuthor: "Reporter One",
        issueCreatedAt: "2026-05-01T10:00:00.000+0000",
        issueUpdatedAt: "2026-05-20T10:00:00.000+0000",
      },
    ] as never);
    const onImport = vi.fn();
    const onImportSpecialTasks = vi.fn();

    render(
      <SprintJiraImportModal
        projectId="project-1"
        onClose={vi.fn()}
        onImport={onImport}
        onImportSpecialTasks={onImportSpecialTasks}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Security hardening follow-up")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /select all visible/i }));
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: /import issues/i }));

    await waitFor(() => {
      expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith("project-1", [
        expect.objectContaining({
          issueKey: "OPS-42",
          includeConversation: true,
        }),
      ]);
      expect(onImport).toHaveBeenCalledWith([
        expect.objectContaining({
          issueKey: "OPS-42",
          includeConversation: true,
        }),
      ]);
      expect(onImportSpecialTasks).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: "security",
          title: "Security hardening follow-up",
          sourceUrl: "https://acme.atlassian.net/browse/OPS-13",
          provider: "jira",
          repository: "OPS",
        }),
      ]);
    });
  });
});
