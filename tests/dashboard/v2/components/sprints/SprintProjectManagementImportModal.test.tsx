/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import {
  SprintProjectManagementImportModal,
  type ProjectManagementImportProvider,
} from "../../../../../dashboard/src/v2/components/sprints/SprintProjectManagementImportModal";
import {
  fetchProjectIssuePromptContexts,
  searchProjectIssues,
  type RemoteIssueSummary,
} from "../../../../../dashboard/src/v2/lib/project-api";
import { renderWithI18n } from "../../../render-with-i18n.js";
import { fetchProjectEffectiveSettings } from "../../../../../dashboard/src/v2/lib/settings-api";

expect.extend(matchers);

vi.mock("../../../../../dashboard/src/v2/lib/project-api", () => ({
  searchProjectIssues: vi.fn(),
  fetchProjectIssuePromptContexts: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/lib/settings-api", () => ({
  fetchProjectEffectiveSettings: vi.fn(),
}));

const importerSettings = (overrides: Partial<any> = {}) => ({
  enabled: true,
  apiToken: "token",
  apiSecret: "",
  baseUrl: "",
  workspaceId: "",
  teamId: "",
  teamKey: "",
  projectId: "",
  databaseId: "",
  boardId: "",
  documentId: "",
  fileKey: "",
  defaultSearchLimit: 25,
  ...overrides,
});

const settingsResponse = {
  settings: {
    notion: importerSettings({ databaseId: "notion-db", defaultSearchLimit: 20 }),
    asana: importerSettings({ workspaceId: "workspace-1", projectId: "asana-project-1", defaultSearchLimit: 30 }),
    linear: importerSettings({ teamId: "team-1", teamKey: "LIN", projectId: "linear-project-1", defaultSearchLimit: 40 }),
  },
};

const makeResult = (provider: ProjectManagementImportProvider): RemoteIssueSummary => ({
  provider,
  sourceProvider: provider,
  sourceKind: provider === "notion" ? "page" : provider === "asana" ? "task" : "issue",
  externalId: `${provider}-external-1`,
  hostDomain: provider === "notion" ? "notion.so" : provider === "asana" ? "app.asana.com" : "linear.app",
  repository: provider === "linear" ? "LIN" : provider === "asana" ? "tasks" : "page",
  projectKey: provider === "linear" ? "LIN" : undefined,
  issueNumber: null,
  issueKey: provider === "linear" ? "LIN-42" : `${provider}-external-1`,
  title: `${provider} imported scope`,
  url: `https://example.test/${provider}/external-1`,
  state: provider === "notion" ? "open" : "In Progress",
  labels: provider === "notion" ? ["page"] : ["triage"],
  assignees: provider === "notion" ? [] : ["Alex"],
  bodyPreview: `${provider} body preview`,
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-06-01T12:00:00.000Z",
  issueAuthor: "Riley",
  issueReporter: "Riley",
  issueMilestone: provider === "linear" ? "Platform" : null,
  issueType: provider === "notion" ? "page" : provider === "asana" ? "Task" : "Issue",
  issuePriority: null,
  issueCommentCount: provider === "notion" ? null : 2,
});

const renderModal = (provider: ProjectManagementImportProvider, onImport = vi.fn()) => renderWithI18n(
  <SprintProjectManagementImportModal
    projectId="project-1"
    provider={provider}
    onClose={vi.fn()}
    onImport={onImport}
  />,
);

describe("SprintProjectManagementImportModal", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue(settingsResponse as any);
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    ["notion", { databaseId: "notion-db", limit: 20 }],
    ["asana", { workspaceId: "workspace-1", providerProjectId: "asana-project-1", status: "open", limit: 30 }],
    ["linear", { teamId: "team-1", teamKey: "LIN", providerProjectId: "linear-project-1", status: "open", limit: 40 }],
  ] as const)("submits %s default search payloads from effective settings", async (provider, expectedPayload) => {
    vi.mocked(searchProjectIssues).mockResolvedValue([makeResult(provider)]);

    renderModal(provider);

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenCalledWith("project-1", expect.objectContaining({
        provider,
        ...expectedPayload,
      }), expect.any(AbortSignal));
    });

    expect(screen.getByRole("dialog", { name: new RegExp(`import ${provider === "notion" ? "notion scope" : provider === "asana" ? "asana tasks" : "linear issues"}`, "i") })).toBeInTheDocument();
    expect(await screen.findByText(`${provider} imported scope`)).toBeInTheDocument();
  });

  it("submits Notion advanced database and external ID filters", async () => {
    vi.mocked(searchProjectIssues).mockResolvedValue([makeResult("notion")]);
    const user = userEvent.setup();

    renderModal("notion");
    await screen.findByText("notion imported scope");

    await user.click(screen.getByRole("button", { name: /advanced notion filters/i }));
    fireEvent.input(screen.getByLabelText("Notion database ID"), { target: { value: "db-override" } });
    await user.type(screen.getByPlaceholderText("External object ID"), "page-123");
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Notion search text"), "roadmap");
    fireEvent.click(screen.getByRole("button", { name: /^search notion$/i }));

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenLastCalledWith("project-1", expect.objectContaining({
        provider: "notion",
        databaseId: "db-override",
        externalIds: ["page-123"],
        search: "roadmap",
      }), expect.any(AbortSignal));
    });
  });

  it("submits Asana labels, assignee, workspace, project, status, and limit filters", async () => {
    vi.mocked(searchProjectIssues).mockResolvedValue([makeResult("asana")]);
    const user = userEvent.setup();

    renderModal("asana");
    await screen.findByText("asana imported scope");

    await user.click(screen.getByRole("button", { name: /advanced asana filters/i }));
    fireEvent.input(screen.getByLabelText("Asana workspace ID"), { target: { value: "workspace-override" } });
    fireEvent.input(screen.getByLabelText("Asana project ID"), { target: { value: "project-override" } });
    fireEvent.input(screen.getByLabelText("Asana assignee"), { target: { value: "assignee-1" } });
    await user.type(screen.getByPlaceholderText("triage, backend"), "backend");
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Asana status"));
    await user.click(screen.getByRole("option", { name: "Done" }));
    fireEvent.input(screen.getByLabelText("Asana result limit"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /^search asana$/i }));

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenLastCalledWith("project-1", expect.objectContaining({
        provider: "asana",
        workspaceId: "workspace-override",
        providerProjectId: "project-override",
        status: "done",
        labels: ["backend"],
        assignee: "assignee-1",
        limit: 12,
      }), expect.any(AbortSignal));
    });
  });

  it("submits Linear team, project, state, status, labels, assignee, and external ID filters", async () => {
    vi.mocked(searchProjectIssues).mockResolvedValue([makeResult("linear")]);
    const user = userEvent.setup();

    renderModal("linear");
    await screen.findByText("linear imported scope");

    await user.click(screen.getByRole("button", { name: /advanced linear filters/i }));
    fireEvent.input(screen.getByLabelText("Linear team ID"), { target: { value: "team-override" } });
    fireEvent.input(screen.getByLabelText("Linear team key"), { target: { value: "eng" } });
    fireEvent.input(screen.getByLabelText("Linear project ID"), { target: { value: "project-override" } });
    fireEvent.input(screen.getByLabelText("Linear workflow state"), { target: { value: "Triage" } });
    fireEvent.input(screen.getByLabelText("Linear assignee"), { target: { value: "alex@example.test" } });
    await user.type(screen.getByPlaceholderText("triage, backend"), "triage");
    await user.keyboard("{Enter}");
    await user.type(screen.getByPlaceholderText("LIN-42, issue-id"), "LIN-99");
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Linear status"));
    await user.click(screen.getByRole("option", { name: "In progress" }));
    fireEvent.click(screen.getByRole("button", { name: /^search linear$/i }));

    await waitFor(() => {
      expect(searchProjectIssues).toHaveBeenLastCalledWith("project-1", expect.objectContaining({
        provider: "linear",
        teamId: "team-override",
        teamKey: "ENG",
        providerProjectId: "project-override",
        state: "Triage",
        status: "in_progress",
        labels: ["triage"],
        assignee: "alex@example.test",
        externalIds: ["LIN-99"],
      }), expect.any(AbortSignal));
    });
  });

  it("imports selected PM results through prompt contexts and honors conversation toggles", async () => {
    const result = makeResult("linear");
    vi.mocked(searchProjectIssues).mockResolvedValue([result]);
    vi.mocked(fetchProjectIssuePromptContexts).mockResolvedValue([
      {
        ...result,
        issueBodyMarkdown: "Body",
        issueConversationMarkdown: "",
        includeConversation: false,
      },
    ] as any);
    const onImport = vi.fn();

    renderModal("linear", onImport);
    await screen.findByText("linear imported scope");

    fireEvent.click(screen.getByRole("button", { name: /linear imported scope/i }));
    fireEvent.click(screen.getByLabelText(/append conversation to all selected linear items/i));
    fireEvent.click(screen.getByRole("button", { name: /import linear items/i }));

    await waitFor(() => {
      expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith("project-1", [
        expect.objectContaining({
          provider: "linear",
          externalId: "linear-external-1",
          includeConversation: false,
        }),
      ]);
      expect(onImport).toHaveBeenCalledWith([
        expect.objectContaining({
          provider: "linear",
          externalId: "linear-external-1",
        }),
      ]);
    });
  });

  it.each([
    ["notion", "No Notion items found"],
    ["asana", "No Asana tasks found"],
    ["linear", "No Linear issues found"],
  ] as const)("shows %s empty state copy", async (provider, emptyTitle) => {
    vi.mocked(searchProjectIssues).mockResolvedValue([]);

    renderModal(provider);

    expect(await screen.findByText(emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(/Adjust the filters/i)).toBeInTheDocument();
  });

  it("surfaces backend configuration errors in the error panel", async () => {
    vi.mocked(searchProjectIssues).mockRejectedValue(new Error("Asana workspace ID or project ID must be configured in Settings -> Integrations."));

    renderModal("asana");

    expect(await screen.findByRole("alert")).toHaveTextContent("Asana workspace ID or project ID must be configured");
  });
});
