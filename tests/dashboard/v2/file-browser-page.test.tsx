/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { FileBrowserPage } from "../../../dashboard/src/v2/FileBrowserPage.js";
import type { FileBrowserSession } from "../../../dashboard/src/types.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

expect.extend(matchers);

const renderPage = (locale: "en" | "de" = "en") => render(
  <DashboardI18nProvider initialLocale={locale} storage={null}><FileBrowserPage /></DashboardI18nProvider>,
);

type ProjectState = { id: string; name: string } | null;

const state = vi.hoisted(() => ({
  selectedProject: null as ProjectState,
  sprints: [] as Array<{ id: string; name: string }>,
  selectedSprint: null as { id: string; name: string } | null,
  selectedSprintId: null as string | null,
  sessionsResult: {
    sessions: [] as FileBrowserSession[],
    selectedSession: null as FileBrowserSession | null,
    loading: false,
    error: null as string | null,
    refresh: vi.fn().mockResolvedValue(undefined),
  },
}));

const apiMocks = vi.hoisted(() => ({
  startFileBrowserSession: vi.fn(),
  stopFileBrowserSession: vi.fn(),
  removeFileBrowserSession: vi.fn(),
  rebuildFileBrowserSession: vi.fn(),
  fetchFileBrowserTree: vi.fn(),
  fetchFileBrowserFile: vi.fn(),
  fetchFileBrowserChanges: vi.fn(),
  fetchFileBrowserDiff: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  ProjectDataContext: {},
  useProjectData: () => ({ selectedProject: state.selectedProject }),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: () => ({
    data: state.sprints,
    selectedSprint: state.selectedSprint,
    selectedSprintId: state.selectedSprintId,
  }),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-is-dark.js", () => ({
  useIsDark: () => false,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-file-browser-sessions.js", () => ({
  useFileBrowserSessions: () => state.sessionsResult,
}));

vi.mock("../../../dashboard/src/v2/lib/file-browser-api.js", () => ({
  startFileBrowserSession: apiMocks.startFileBrowserSession,
  stopFileBrowserSession: apiMocks.stopFileBrowserSession,
  removeFileBrowserSession: apiMocks.removeFileBrowserSession,
  rebuildFileBrowserSession: apiMocks.rebuildFileBrowserSession,
  fetchFileBrowserTree: apiMocks.fetchFileBrowserTree,
  fetchFileBrowserFile: apiMocks.fetchFileBrowserFile,
  fetchFileBrowserChanges: apiMocks.fetchFileBrowserChanges,
  fetchFileBrowserDiff: apiMocks.fetchFileBrowserDiff,
}));

vi.mock("../../../dashboard/src/v2/components/file-browser/FileTree.js", () => ({
  FileTree: ({ nodes }: { nodes: Array<unknown> }) => <div>Mock File Tree ({nodes.length})</div>,
}));

vi.mock("../../../dashboard/src/v2/components/file-browser/FileViewer.js", () => ({
  FileViewer: () => <div>Mock File Viewer</div>,
}));

vi.mock("../../../dashboard/src/v2/components/file-browser/ChangesList.js", () => ({
  ChangesList: ({ files }: { files: Array<unknown> }) => <div>Mock Changes List ({files.length})</div>,
}));

vi.mock("../../../dashboard/src/v2/components/file-browser/DiffViewer.js", () => ({
  DiffViewer: () => <div>Mock Diff Viewer</div>,
}));

const makeSession = (overrides?: Partial<FileBrowserSession>): FileBrowserSession => ({
  id: "fb-1",
  projectId: "p1",
  sprintId: "s1",
  sprintName: "Sprint 1",
  featureBranch: "feature/s1",
  status: "running",
  healthStatus: "healthy",
  lastBuildAt: "2026-06-01T00:00:00.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  containerName: "container-1",
  containerId: "container-id-1",
  workspacePath: "/tmp/workspace",
  branchHeadSha: null,
  lastError: null,
  ...overrides,
});

describe("FileBrowserPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    state.selectedProject = null;
    state.sprints = [];
    state.selectedSprint = null;
    state.selectedSprintId = null;
    state.sessionsResult = {
      sessions: [],
      selectedSession: null,
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.startFileBrowserSession.mockReset();
    apiMocks.stopFileBrowserSession.mockReset();
    apiMocks.removeFileBrowserSession.mockReset();
    apiMocks.rebuildFileBrowserSession.mockReset();
    apiMocks.fetchFileBrowserTree.mockReset();
    apiMocks.fetchFileBrowserFile.mockReset();
    apiMocks.fetchFileBrowserChanges.mockReset();
    apiMocks.fetchFileBrowserDiff.mockReset();

    apiMocks.fetchFileBrowserTree.mockResolvedValue({ root: [], truncated: false });
    apiMocks.fetchFileBrowserChanges.mockResolvedValue({ available: true, files: [], featureBranch: "feature/s1", defaultBranch: "main" });
  });

  it("renders the no-project state", () => {
    renderPage();

    expect(screen.getByText(/Select a project to open the sprint file browser/i)).toBeInTheDocument();
  });

  it("renders launch state controls when no running session is available", () => {
    state.selectedProject = { id: "p1", name: "Project 1" };
    state.sprints = [{ id: "s1", name: "Sprint 1" }];
    state.selectedSprint = { id: "s1", name: "Sprint 1" };
    state.selectedSprintId = null;

    renderPage();

    const pageRoot = screen.getByTestId("file-browser-page-root");
    expect(pageRoot.className).toContain("px-4");
    expect(pageRoot.className).toContain("py-10");
    expect(pageRoot.className).toContain("md:px-8");
    expect(screen.getByTestId("file-browser-page-header")).toBeInTheDocument();
    expect(screen.getByText("Sprint File Browser")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /Browse & Diff the Sprint Branch/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Launch the file browser/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open file browser/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh/i })).toBeInTheDocument();
    expect(pageRoot.innerHTML).not.toContain("#f5f1e8");
    expect(pageRoot.innerHTML).not.toContain("#f7f3ea");
  });

  it("renders running workspace controls and viewer region", () => {
    state.selectedProject = { id: "p1", name: "Project 1" };
    state.sprints = [{ id: "s1", name: "Sprint 1" }];
    state.selectedSprint = { id: "s1", name: "Sprint 1" };
    state.selectedSprintId = "s1";

    const runningSession = makeSession();
    state.sessionsResult = {
      sessions: [runningSession],
      selectedSession: runningSession,
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    renderPage();

    const mainPanel = screen.getByTestId("file-browser-main-tool-panel");
    expect(mainPanel).toBeInTheDocument();
    expect(mainPanel.className).toContain("flex flex-col");
    expect(mainPanel.className).toContain("lg:grid-cols-[340px_minmax(0,1fr)]");
    expect(mainPanel.className).toContain("lg:h-[calc(100vh-340px)]");
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getAllByRole("tab", { name: "Files" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("tab", { name: "Changes" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("tablist", { name: "File browser mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rebuild file browser container" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop file browser container" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter files")).toBeInTheDocument();
    expect(screen.getByText("Mock File Viewer")).toBeInTheDocument();
    expect(screen.getByText("No file selected")).toBeInTheDocument();
    expect(screen.getByText("Sprint File Browser").className).toContain("text-signal-500");
    expect(screen.getByPlaceholderText("Filter files…").className).toContain("text-slate-700");
  });

  it("renders German session controls while preserving sprint and Git reference data", () => {
    state.selectedProject = { id: "p1", name: "Project 1" };
    state.sprints = [{ id: "s1", name: "Sprint Übernahme" }];
    state.selectedSprint = { id: "s1", name: "Sprint Übernahme" };
    state.selectedSprintId = "s1";
    const runningSession = makeSession({ sprintName: "Sprint Übernahme", featureBranch: "feature/untranslated-ref" });
    state.sessionsResult = { sessions: [runningSession], selectedSession: runningSession, loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) };

    renderPage("de");

    expect(screen.getByRole("heading", { name: "Sprint-Branch durchsuchen und vergleichen" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dateien" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dateibrowser-Container neu erstellen" })).toBeInTheDocument();
    expect(screen.getByText("Sprint Übernahme")).toBeInTheDocument();
    expect(screen.getByText("feature/untranslated-ref")).toBeInTheDocument();
    expect(apiMocks.startFileBrowserSession).not.toHaveBeenCalled();
  });

  it("starts a German-selected sprint and keeps backend errors verbatim", async () => {
    state.selectedProject = { id: "p1", name: "Project 1" };
    state.sprints = [{ id: "s1", name: "Sprint unverändert" }];
    state.selectedSprint = { id: "s1", name: "Sprint unverändert" };
    state.selectedSprintId = null;
    apiMocks.startFileBrowserSession.mockRejectedValueOnce(new Error("BACKEND_CODE unchanged"));

    renderPage("de");
    const openButton = screen.getByRole("button", { name: "Dateibrowser öffnen" });
    await waitFor(() => expect(openButton).toBeEnabled());
    fireEvent.click(openButton);

    await waitFor(() => expect(apiMocks.startFileBrowserSession).toHaveBeenCalledWith("p1", "s1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dateibrowser konnte nicht gestartet werden: BACKEND_CODE unchanged");
    expect(screen.getAllByText("Sprint unverändert").length).toBeGreaterThan(0);
  });
});
