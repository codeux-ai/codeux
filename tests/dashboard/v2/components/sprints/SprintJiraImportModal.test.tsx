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

describe("SprintJiraImportModal", () => {
  it("uses guided filters for Jira search and imports selected issues", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
    } as any);
    vi.mocked(searchJiraIssues).mockResolvedValue([
      {
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
        issueConversationMarkdown: "",
        includeConversation: true,
        issueAuthor: null,
        issueCreatedAt: null,
        issueUpdatedAt: null,
      },
    ]);
    const onImport = vi.fn();

    render(<SprintJiraImportModal projectId="project-1" onClose={vi.fn()} onImport={onImport} />);

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenCalledWith("project-1", expect.objectContaining({
        projectKey: "OPS",
        status: "open",
        assigneeText: "",
      }), expect.any(AbortSignal));
    });

    fireEvent.input(screen.getByPlaceholderText("Search title, description, or key"), {
      target: { value: "backlog" },
    });
    fireEvent.input(screen.getByPlaceholderText("Assignee name, email, or ID"), {
      target: { value: "dev@example.com" },
    });
    fireEvent.input(screen.getByLabelText("Jira status"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(searchJiraIssues).toHaveBeenLastCalledWith("project-1", expect.objectContaining({
        projectKey: "OPS",
        search: "backlog",
        status: "done",
        assigneeText: "dev@example.com",
        labels: [],
        limit: 40,
      }), expect.any(AbortSignal));
    });

    fireEvent.click(await screen.findByText("Import Jira backlog"));
    fireEvent.click(screen.getByRole("button", { name: /import issues/i }));

    await waitFor(() => {
      expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith("project-1", [
        expect.objectContaining({
          provider: "jira",
          hostDomain: "acme.atlassian.net",
          projectKey: "OPS",
          repository: "OPS",
          issueNumber: 42,
          issueKey: "OPS-42",
          includeConversation: true,
        }),
      ]);
      expect(onImport).toHaveBeenCalledTimes(1);
    });
  });
});
