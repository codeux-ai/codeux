// @vitest-environment jsdom
/** @jsx h */
import { h } from "preact";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import type { FileBrowserTreeNode } from "../../../../types.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import type { DashboardLocale } from "../../../i18n/locales.js";

expect.extend(matchers);

document.queryCommandSupported = vi.fn().mockReturnValue(false);

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const fileNode: FileBrowserTreeNode = {
  id: "src/App.tsx",
  name: "App.tsx",
  path: "src/App.tsx",
  type: "file",
};

const readmeNode: FileBrowserTreeNode = {
  id: "README.md",
  name: "README.md",
  path: "README.md",
  type: "file",
};

const treeResponse = {
  sessionId: "fb-1",
  root: [fileNode, readmeNode],
  fileCount: 2,
  truncated: false,
};

const changesResponse = {
  sessionId: "fb-1",
  available: true,
  files: [
    { path: "src/App.tsx", oldPath: null, status: "modified" as const, additions: 4, deletions: 1 },
    { path: "README.md", oldPath: null, status: "added" as const, additions: 7, deletions: 0 },
  ],
  featureBranch: "feature/s1",
  defaultBranch: "main",
  reason: null,
};

let sessionLastBuildAt = "2026-06-01T00:00:00.000Z";
let sessionStatus: "running" | "stopped" = "running";

const apiMocks = vi.hoisted(() => ({
  fetchFileBrowserTree: vi.fn(),
  fetchFileBrowserDiff: vi.fn(),
  fetchFileBrowserFile: vi.fn(),
  fetchFileBrowserChanges: vi.fn(),
  startFileBrowserSession: vi.fn(),
  stopFileBrowserSession: vi.fn(),
  rebuildFileBrowserSession: vi.fn(),
  removeFileBrowserSession: vi.fn(),
  refresh: vi.fn(),
}));

const makeSession = () => ({
  id: "fb-1",
  projectId: "p1",
  projectName: "Project 1",
  sprintId: "s1",
  sprintName: "Sprint 1",
  sprintNumber: 1,
  featureBranch: "feature/s1",
  defaultBranch: "main",
  status: sessionStatus,
  healthStatus: "healthy",
  lastCompletedTaskCount: 0,
  lastSeenSprintStatus: null,
  lastBuildAt: sessionLastBuildAt,
  lastStartedAt: "2026-06-01T00:00:00.000Z",
  lastStoppedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  containerName: "container-1",
  containerId: "container-id-1",
  workspacePath: "/tmp/workspace",
  branchHeadSha: null,
  lastError: null,
});

vi.mock("../../../context/project-data.js", () => ({
  ProjectDataContext: {},
  useProjectData: () => ({ selectedProject: { id: "p1", name: "Project 1" } }),
}));

vi.mock("../../../../hooks/useSprints.js", () => ({
  useSprints: () => ({
    data: [{ id: "s1", name: "Sprint 1" }],
    selectedSprint: { id: "s1", name: "Sprint 1" },
    selectedSprintId: "s1",
  }),
}));

vi.mock("../../../hooks/use-file-browser-sessions.js", () => ({
  useFileBrowserSessions: () => {
    const selectedSession = makeSession();
    return {
      sessions: [selectedSession],
      selectedSession,
      loading: false,
      error: null,
      refresh: apiMocks.refresh,
    };
  },
}));

vi.mock("../../../hooks/use-project-git-status.js", () => ({
  useProjectGitStatus: () => ({ status: null, loading: false }),
}));

vi.mock("../../../lib/file-browser-api.js", () => apiMocks);

vi.mock("../../../lib/monaco-setup.js", () => ({
  ensureMonacoConfigured: vi.fn(),
  MONACO_DARK_THEME: "dark",
  MONACO_LIGHT_THEME: "light",
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value?: string }) => <pre data-testid="monaco-editor">{value}</pre>,
  Editor: ({ value }: { value?: string }) => <pre data-testid="monaco-editor">{value}</pre>,
  DiffEditor: ({ modified }: { modified?: string }) => <pre data-testid="monaco-diff-editor">{modified}</pre>,
}));

vi.mock("../../../components/file-browser/FileTree.js", async () => {
  const { h } = await import("preact");
  const flatten = (nodes: FileBrowserTreeNode[]): FileBrowserTreeNode[] =>
    nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
  return {
    FileTree: ({
      nodes,
      selectedPath,
      onSelectFile,
      searchTerm,
      loadingPath,
    }: {
      nodes: FileBrowserTreeNode[];
      selectedPath: string | null;
      onSelectFile: (path: string) => void;
      searchTerm?: string;
      loadingPath?: string | null;
    }) => {
      const visibleNodes = flatten(nodes).filter((node) =>
        !searchTerm?.trim() || node.name.toLowerCase().includes(searchTerm.trim().toLowerCase()),
      );
      return h(
        "div",
        { role: "tree", "aria-label": "Sprint file tree" },
        visibleNodes.map((node) =>
          h(
            "button",
            {
              key: node.path,
              type: "button",
              role: "treeitem",
              "aria-selected": selectedPath === node.path,
              "aria-busy": loadingPath === node.path,
              onClick: () => onSelectFile(node.path),
            },
            loadingPath === node.path ? `${node.path} Loading` : node.path,
          ),
        ),
      );
    },
  };
});

const { FileBrowserPage } = await import("../../../FileBrowserPage.js");

const renderPage = (locale: DashboardLocale = "en") => render(
  <DashboardI18nProvider initialLocale={locale} storage={null}><FileBrowserPage /></DashboardI18nProvider>,
);

beforeEach(() => {
  sessionLastBuildAt = "2026-06-01T00:00:00.000Z";
  sessionStatus = "running";
  apiMocks.fetchFileBrowserTree.mockResolvedValue(treeResponse);
  apiMocks.fetchFileBrowserFile.mockResolvedValue({
    path: "src/App.tsx",
    content: "export const App = () => 'cached';",
    encoding: "utf8",
    size: 34,
    truncated: false,
    binary: false,
    language: "typescript",
  });
  apiMocks.fetchFileBrowserChanges.mockResolvedValue(changesResponse);
  apiMocks.fetchFileBrowserDiff.mockResolvedValue({
    path: "src/App.tsx",
    oldPath: null,
    status: "modified",
    original: "old",
    modified: "new",
    binary: false,
    language: "typescript",
  });
  apiMocks.startFileBrowserSession.mockResolvedValue(makeSession());
  apiMocks.stopFileBrowserSession.mockResolvedValue(undefined);
  apiMocks.rebuildFileBrowserSession.mockResolvedValue(undefined);
  apiMocks.removeFileBrowserSession.mockResolvedValue(undefined);
  apiMocks.refresh.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("keeps cached tree content visible during a background tree refresh", async () => {
  const { rerender } = renderPage();

  expect(await screen.findByRole("treeitem", { name: "src/App.tsx" })).toBeInTheDocument();

  const refreshTree = createDeferred<typeof treeResponse>();
  apiMocks.fetchFileBrowserTree.mockReturnValueOnce(refreshTree.promise);
  sessionLastBuildAt = "2026-06-01T00:01:00.000Z";
  rerender(<DashboardI18nProvider initialLocale="en" storage={null}><FileBrowserPage /></DashboardI18nProvider>);

  expect(screen.getByRole("treeitem", { name: "src/App.tsx" })).toBeInTheDocument();
  expect(screen.getByText("Refreshing file tree")).toBeInTheDocument();

  refreshTree.resolve(treeResponse);
  await waitFor(() => expect(screen.queryByText("Refreshing file tree")).not.toBeInTheDocument());
});

test("retains selected file state while the file tree refreshes", async () => {
  const { rerender } = renderPage();

  fireEvent.click(await screen.findByRole("treeitem", { name: "src/App.tsx" }));
  expect(await screen.findByText("export const App = () => 'cached';")).toBeInTheDocument();

  const refreshTree = createDeferred<typeof treeResponse>();
  apiMocks.fetchFileBrowserTree.mockReturnValueOnce(refreshTree.promise);
  sessionLastBuildAt = "2026-06-01T00:02:00.000Z";
  rerender(<DashboardI18nProvider initialLocale="en" storage={null}><FileBrowserPage /></DashboardI18nProvider>);

  expect(screen.getByText("Selected src/App.tsx")).toBeInTheDocument();
  expect(screen.getByRole("treeitem", { name: "src/App.tsx" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("export const App = () => 'cached';")).toBeInTheDocument();

  refreshTree.resolve(treeResponse);
});

test("marks the selected file row busy while file contents load", async () => {
  const fileLoad = createDeferred<{
    path: string;
    content: string;
    encoding: string;
    size: number;
    truncated: boolean;
    binary: boolean;
    language: string;
  }>();
  apiMocks.fetchFileBrowserFile.mockReturnValueOnce(fileLoad.promise);

  renderPage();

  fireEvent.click(await screen.findByRole("treeitem", { name: "src/App.tsx" }));

  const loadingRow = screen.getByRole("treeitem", { name: "src/App.tsx Loading" });
  expect(loadingRow).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Loading file…")).toBeInTheDocument();

  fileLoad.resolve({
    path: "src/App.tsx",
    content: "export const App = () => 'loaded';",
    encoding: "utf8",
    size: 34,
    truncated: false,
    binary: false,
    language: "typescript",
  });

  expect(await screen.findByText("export const App = () => 'loaded';")).toBeInTheDocument();
});

test("announces search results and mode-switch change counts with selected state", async () => {
  renderPage();

  fireEvent.click(await screen.findByRole("treeitem", { name: "src/App.tsx" }));
  fireEvent.input(screen.getByLabelText("Filter files"), { target: { value: "readme" } });

  expect(screen.getByText("1 matching entry")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Changes" }));

  await waitFor(() => expect(screen.getByText("2 changed files")).toBeInTheDocument());
  expect(screen.getByRole("option", { name: /Modified file src\/App\.tsx/i })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText(/Changes mode\. 2 changed files\. Selected change src\/App\.tsx\./)).toBeInTheDocument();
});

test("keeps cached changes visible and shows recovery messaging after a refresh error", async () => {
  const { rerender } = renderPage();

  fireEvent.click(await screen.findByRole("tab", { name: "Changes" }));
  expect(await screen.findByRole("option", { name: /Modified file src\/App\.tsx/i })).toBeInTheDocument();

  apiMocks.fetchFileBrowserChanges.mockRejectedValueOnce(new Error("git diff failed"));
  sessionLastBuildAt = "2026-06-01T00:03:00.000Z";
  rerender(<DashboardI18nProvider initialLocale="en" storage={null}><FileBrowserPage /></DashboardI18nProvider>);

  await waitFor(() => expect(screen.getByText(/Failed to refresh changed files\. Showing cached list\./)).toBeInTheDocument());
  expect(screen.getByRole("option", { name: /Modified file src\/App\.tsx/i })).toBeInTheDocument();
});

test("suppresses duplicate stop activation and explains disabled state while pending", async () => {
  const stopDeferred = createDeferred<void>();
  apiMocks.stopFileBrowserSession.mockReturnValueOnce(stopDeferred.promise);
  renderPage();

  await screen.findByRole("treeitem", { name: "src/App.tsx" });
  const stopButton = screen.getByRole("button", { name: "Stop file browser container" });

  fireEvent.click(stopButton);

  expect(apiMocks.stopFileBrowserSession).toHaveBeenCalledTimes(1);
  expect(stopButton).toBeDisabled();
  expect(stopButton).toHaveAttribute("aria-busy", "true");
  expect(screen.getAllByText("A stop is already pending. Wait for the container to stop before starting another action.").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Rebuild file browser container" })).toHaveAccessibleDescription("A stop is already pending. Wait for the container to stop before rebuilding.");

  fireEvent.click(stopButton);
  expect(apiMocks.stopFileBrowserSession).toHaveBeenCalledTimes(1);

  stopDeferred.resolve();
});
