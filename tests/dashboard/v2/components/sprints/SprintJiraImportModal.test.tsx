/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SprintJiraImportModal } from "../../../../../dashboard/src/v2/components/sprints/SprintJiraImportModal";
import { fetchProjectEffectiveSettings } from "../../../../../dashboard/src/v2/lib/settings-api";
import { fetchJiraProjectStatuses, fetchProjectIssuePromptContexts, searchJiraIssues } from "../../../../../dashboard/src/v2/lib/project-api";

expect.extend(matchers);

vi.mock("../../../../../dashboard/src/v2/lib/settings-api", () => ({
  fetchProjectEffectiveSettings: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/lib/project-api", () => ({
  searchJiraIssues: vi.fn(),
  fetchJiraProjectStatuses: vi.fn(),
  fetchProjectIssuePromptContexts: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchJiraProjectStatuses).mockResolvedValue([
    { id: "10000", name: "Zu erledigen", issueTypes: ["Story"] },
    { id: "10001", name: "In Arbeit", issueTypes: ["Story", "Bug"] },
  ]);
});

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

const inWorkIssue = {
  ...baseIssue,
  key: "OPS-77",
  title: "Already being handled",
  url: "https://acme.atlassian.net/browse/OPS-77",
  state: "In Work",
};

describe("SprintJiraImportModal", () => {
  it("loads the default project key, Jira workflow statuses, and uses guided Jira filters", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "ops" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue]);
    vi.mocked(fetchProjectIssuePromptContexts).mockResolvedValue([] as never);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: /import backlog scope/i });
    expect(dialog).toHaveAccessibleDescription(/search jira with exact keys/i);
    expect(screen.getByRole("button", { name: /close jira import/i })).toBeEnabled();

    await waitFor(() => {
      expect(fetchJiraProjectStatuses).toHaveBeenCalledWith("project-1", "OPS", expect.any(AbortSignal));
      expect(searchJiraIssues).toHaveBeenCalled();
    });

    const searchInput = vi.mocked(searchJiraIssues).mock.calls.at(-1)?.[1];
    expect(searchInput).toEqual(expect.objectContaining({
      projectKey: "OPS",
      issueKey: "",
      search: "",
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
    }));
    expect(searchInput).not.toHaveProperty("status");
    expect(searchInput).not.toHaveProperty("statusNames");

    expect(screen.getByDisplayValue("OPS")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Jira status" })).toHaveDisplayValue("All statuses");
    expect(screen.getByRole("option", { name: "Zu erledigen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /import issues disabled until jira issues are selected/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /advanced jira filters/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("checkbox", { name: /hide in work/i })).toBeChecked();
    expect(document.getElementById("jira-import-advanced-filters")).toHaveClass("hidden");
    expect(screen.getAllByText(/Showing all Jira statuses sorted by updated, newest first/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Active Jira filters")).toHaveTextContent(/Visibility\s*Hide in Work/i);
    expect([...document.querySelectorAll("[aria-live='polite']")].some((node) => (
      node.textContent?.replace(/\s+/g, " ").includes("0 linked, 0 special")
    ))).toBe(true);
    expect(screen.getByRole("button", { name: /import jira backlog/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("searches with a selected Jira workflow status label", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "ops" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue]);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Zu erledigen" })).toBeInTheDocument();
    });

    const statusSelect = screen.getByRole("combobox", { name: "Jira status" }) as HTMLSelectElement;
    statusSelect.value = "jira-status:Zu%20erledigen";
    fireEvent.input(statusSelect);
    fireEvent.change(statusSelect);

    await waitFor(() => {
      expect(statusSelect).toHaveDisplayValue("Zu erledigen");
    });

    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalledTimes(2);
    });

    const searchInput = vi.mocked(searchJiraIssues).mock.calls.at(-1)?.[1];
    expect(searchInput).toEqual(expect.objectContaining({
      projectKey: "OPS",
      statusNames: ["Zu erledigen"],
    }));
    expect(searchInput).not.toHaveProperty("status");
  });

  it("falls back to Jira status categories when workflow statuses fail to load", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(fetchJiraProjectStatuses).mockRejectedValue(new Error("Jira status endpoint unavailable"));
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue]);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalled();
    });

    expect(screen.getByText(/Jira status endpoint unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Jira status" })).toHaveDisplayValue("Open");
    expect(screen.getByRole("option", { name: "In Work" })).toBeInTheDocument();

    const searchInput = vi.mocked(searchJiraIssues).mock.calls.at(-1)?.[1];
    expect(searchInput).toEqual(expect.objectContaining({
      projectKey: "OPS",
      status: "open",
    }));
    expect(searchInput).not.toHaveProperty("statusNames");
  });

  it("sends the stable in-progress filter from the In Work fallback option and imports selected Jira issues", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(fetchJiraProjectStatuses).mockRejectedValue(new Error("Jira status endpoint unavailable"));
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue]);
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
        issueConversationMarkdown: "",
        includeConversation: true,
        issueAuthor: "Reporter One",
        issueCreatedAt: "2026-05-01T10:00:00.000+0000",
        issueUpdatedAt: "2026-05-20T10:00:00.000+0000",
      },
    ] as never);
    const onImport = vi.fn();

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={onImport} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Jira status" })).toHaveDisplayValue("Open");
    });

    const statusSelect = screen.getByRole("combobox", { name: "Jira status" }) as HTMLSelectElement;
    statusSelect.value = "category:in_progress";
    fireEvent.input(statusSelect);
    fireEvent.change(statusSelect);

    await waitFor(() => {
      expect(statusSelect).toHaveDisplayValue("In Work");
    });

    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(searchJiraIssues).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      projectKey: "OPS",
      status: "in_progress",
    }));

    fireEvent.click(screen.getByText("Import Jira backlog"));
    fireEvent.click(screen.getByRole("button", { name: /import issues/i }));

    await waitFor(() => {
      expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith("project-1", [
        expect.objectContaining({
          provider: "jira",
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
    });
  });

  it("hides Jira issues already in work by default", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue, inWorkIssue]);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Import Jira backlog")).toBeInTheDocument();
    });

    expect(screen.queryByText("Already being handled")).not.toBeInTheDocument();
    expect(screen.getByText(/1 visible result/i)).toBeInTheDocument();
  });

  it("shows in-work Jira issues when Hide in Work is unchecked", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue, inWorkIssue]);

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Import Jira backlog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /hide in work/i }));

    expect(screen.getByText("Already being handled")).toBeInTheDocument();
    expect(screen.getByText(/2 visible results/i)).toBeInTheDocument();
  });

  it("prunes selected in-work Jira issues when Hide in Work is re-enabled", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as never);
    vi.mocked(searchJiraIssues).mockResolvedValue([baseIssue, inWorkIssue]);

    render(
      <SprintJiraImportModal
        projectId="project-1"
        onClose={vi.fn()}
        onImport={vi.fn()}
        onImportSpecialTasks={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Import Jira backlog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /hide in work/i }));
    fireEvent.click(screen.getByText("Already being handled"));
    expect(screen.getByText(/1 selected issue will be imported\. 1 linked, 0 special tasks\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /quality task/i }));
    expect(screen.getByText(/1 selected issue will be imported\. 0 linked, 1 special task\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /hide in work/i }));

    expect(screen.queryByText("Already being handled")).not.toBeInTheDocument();
    expect(screen.getByText("No issues selected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import issues disabled until jira issues are selected/i })).toBeDisabled();
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

    fireEvent.click(screen.getByRole("button", { name: /advanced jira filters/i }));
    expect(screen.getByRole("button", { name: /advanced jira filters/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Classification")).toBeInTheDocument();
    expect(screen.getByText("Advanced JQL Override")).toBeInTheDocument();

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
    expect(screen.getByRole("button", { name: /import jira backlog/i })).toHaveAttribute("aria-pressed", "true");

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

  it("keeps Jira selections linked by default and only emits special payloads after explicit mode selection", async () => {
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

    fireEvent.click(screen.getByText("Security hardening follow-up"));
    expect(screen.getByText(/1 selected issue will be imported\. 1 linked, 0 special tasks\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /security task/i }));
    expect(screen.getByText(/1 selected issue will be imported\. 0 linked, 1 special task\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Import Jira backlog"));
    expect(screen.getByText(/2 selected issues will be imported\. 1 linked, 1 special task\./i)).toBeInTheDocument();

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
