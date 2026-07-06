/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintIssueImportModal } from "../../../../../dashboard/src/v2/components/sprints/SprintIssueImportModal";
import {
  fetchProjectIssuePromptContexts,
  type RemoteIssueSummary,
  searchProjectIssues,
} from "../../../../../dashboard/src/v2/lib/project-api";

expect.extend(matchers);

vi.mock("../../../../../dashboard/src/v2/lib/project-api", () => ({
  searchProjectIssues: vi.fn(),
  fetchProjectIssuePromptContexts: vi.fn(),
}));

describe("SprintIssueImportModal", () => {
  const project = {
    id: "project-1",
    name: "Widgets",
    repoUrl: "https://github.com/acme/widgets.git",
    sourceRef: "https://github.com/acme/widgets.git",
    gitProvider: "github",
    gitHostDomain: null,
  } as any;

  const issue: RemoteIssueSummary = {
    provider: "github",
    hostDomain: "github.com",
    repository: "acme/widgets",
    issueNumber: 42,
    issueKey: "#42",
    title: "Fix CI",
    url: "https://github.com/acme/widgets/issues/42",
    state: "open",
    labels: ["bug"],
    assignees: ["alice"],
    bodyPreview: "CI is red because tests fail.",
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    issueAuthor: "bob",
    issueReporter: "bob",
    issueMilestone: "v1",
    issueType: null,
    issuePriority: null,
    issueCommentCount: 4,
    sourceProvider: "github",
  };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the default surface focused and submits expanded advanced filters", async () => {
    vi.mocked(searchProjectIssues).mockResolvedValue([issue]);
    vi.mocked(fetchProjectIssuePromptContexts).mockResolvedValue([
      {
        ...issue,
        includeConversation: false,
        issueBodyMarkdown: "CI is red because tests fail.",
        issueConversationMarkdown: "",
      },
    ] as any);

    const onImport = vi.fn();
    const user = userEvent.setup();

    render(<SprintIssueImportModal project={project} onClose={vi.fn()} onImport={onImport} />);

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenCalledWith("project-1", expect.objectContaining({
        provider: "github",
        hostDomain: "github.com",
        repository: "acme/widgets",
        state: "open",
        sortField: "updated",
        sortDirection: "desc",
        limit: 40,
      }), expect.any(AbortSignal));
    });

    expect(screen.getByRole("button", { name: /advanced filters/i })).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("repository-issue-import-advanced-filters")).toHaveClass("hidden");
    expect(screen.getByText(/Sort: Updated, Newest first/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 visible result/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^gitlab$/i }));
    fireEvent.change(screen.getByPlaceholderText("gitlab.com"), { target: { value: "gitlab.example.com" } });
    fireEvent.change(screen.getByPlaceholderText("owner/repository"), { target: { value: "acme/widgets" } });
    await user.type(screen.getByPlaceholderText("Title, body, or issue text"), "pipeline");
    await user.selectOptions(screen.getByLabelText("State"), "closed");
    await user.selectOptions(screen.getByLabelText("Limit"), "100");
    await user.selectOptions(screen.getByLabelText("Sort"), "comments");
    await user.selectOptions(screen.getByLabelText("Direction"), "asc");

    await user.click(screen.getByRole("button", { name: /advanced filters/i }));
    expect(screen.getByRole("button", { name: /advanced filters/i })).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByPlaceholderText("me or alice"), "alice");
    await user.type(screen.getByPlaceholderText("octocat"), "bob");
    await user.type(screen.getByPlaceholderText("v1.2"), "v1");

    const labelsInput = screen.getByPlaceholderText("bug, security");
    await user.type(labelsInput, "bug");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getAllByText("bug").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: /search issues/i }));

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenLastCalledWith("project-1", expect.objectContaining({
        provider: "gitlab",
        hostDomain: "gitlab.example.com",
        repository: "acme/widgets",
        search: "pipeline",
        state: "closed",
        labels: ["bug"],
        assignee: "alice",
        author: "bob",
        milestone: "v1",
        sortField: "comments",
        sortDirection: "asc",
        limit: 100,
      }), expect.any(AbortSignal));
    });

    expect(screen.getByText(/Sort: Comments, Oldest first/i)).toBeInTheDocument();
    expect(screen.getAllByText("Search").length).toBeGreaterThan(0);
    expect(screen.getByText("pipeline")).toBeInTheDocument();
    expect(screen.getAllByText("Labels").length).toBeGreaterThan(0);

    expect(await screen.findByText("Fix CI")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /select all visible results/i })[0]);

    expect(screen.getByText(/1 selected issue will be imported/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /clear selected issues/i })[0]);
    expect(screen.getByText(/No issues selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /select all visible results/i })[0]);

    fireEvent.click(screen.getByLabelText("Append conversation for all selected issues"));
    fireEvent.click(screen.getByRole("button", { name: /import as linked issues/i }));

    await waitFor(() => {
      expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith("project-1", [
        expect.objectContaining({
          provider: "github",
          repository: "acme/widgets",
          issueNumber: 42,
          includeConversation: false,
        }),
      ]);
      expect(onImport).toHaveBeenCalledWith([
        expect.objectContaining({
          provider: "github",
          repository: "acme/widgets",
          issueNumber: 42,
        }),
      ]);
    });
  });

  it("prunes selected issues after refresh and keeps quick presets available in advanced filters", async () => {
    vi.mocked(searchProjectIssues)
      .mockResolvedValueOnce([issue])
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();

    render(<SprintIssueImportModal project={project} onClose={vi.fn()} onImport={vi.fn()} />);

    await screen.findByText("Fix CI");
    fireEvent.click(screen.getAllByRole("button", { name: /select all visible results/i })[0]);
    expect(screen.getByText(/1 selected issue will be imported/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /search issues/i }));

    await waitFor(() => {
      expect(screen.getByText(/No issues selected/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /advanced filters/i }));
    await user.click(screen.getByRole("button", { name: /recently updated/i }));

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenLastCalledWith("project-1", expect.objectContaining({
        state: "open",
        updatedAfter: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        sortField: "updated",
        sortDirection: "desc",
      }), expect.any(AbortSignal));
    });
  });

  it.each([
    ["security", "Security follow-up: Fix CI", /import as security/i],
    ["quality", "Quality follow-up: Fix CI", /import as quality/i],
    ["merge_conflict", "Resolve merge conflict: Fix CI", /import as merge conflict/i],
    ["failed_ci", "Repair failed CI: Fix CI", /import as failed ci/i],
  ])("emits %s special task payloads for selected issues", async (kind, title, buttonName) => {
    vi.mocked(searchProjectIssues).mockResolvedValue([issue]);
    const onImportSpecialTasks = vi.fn();

    render(
      <SprintIssueImportModal
        project={project}
        onClose={vi.fn()}
        onImport={vi.fn()}
        onImportSpecialTasks={onImportSpecialTasks}
      />,
    );

    await screen.findByText("Fix CI");
    fireEvent.click(screen.getByText("Fix CI"));
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => {
      expect(onImportSpecialTasks).toHaveBeenCalledWith([
        expect.objectContaining({
          kind,
          title,
          sourceUrl: "https://github.com/acme/widgets/issues/42",
          sourcePath: "https://github.com/acme/widgets/issues/42",
          provider: "github",
          repository: "acme/widgets",
          labels: ["bug"],
          errorMessage: "CI is red because tests fail.",
        }),
      ]);
    });
  });

  it("uses the requested initial provider and default host while preserving repository inference", async () => {
    vi.mocked(searchProjectIssues).mockResolvedValue([]);

    render(
      <SprintIssueImportModal
        project={project}
        initialProvider="gitlab"
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenCalledWith("project-1", expect.objectContaining({
        provider: "gitlab",
        hostDomain: "gitlab.com",
        repository: "acme/widgets",
      }), expect.any(AbortSignal));
    });

    expect(screen.getByText("GitLab issue import")).toBeInTheDocument();
  });
});
