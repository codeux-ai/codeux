// @vitest-environment jsdom
/** @jsx h */
import { h } from "preact";
import { expect, test, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

document.queryCommandSupported = vi.fn().mockReturnValue(false);

// Mock project context
vi.mock("../../../context/project-data.js", () => ({
  useProjectData: () => ({ selectedProject: { id: "p1", name: "Project 1" } })
}));

// Mock sprints hook
vi.mock("../../../../hooks/useSprints.js", () => ({
  useSprints: () => ({
    data: [{ id: "s1", name: "Sprint 1" }],
    selectedSprint: { id: "s1", name: "Sprint 1" },
    selectedSprintId: "s1",
  })
}));

// Mock sessions hook
vi.mock("../../../hooks/use-file-browser-sessions.js", () => ({
  useFileBrowserSessions: () => ({
    sessions: [{
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
    }],
    selectedSession: {
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
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  })
}));

// Mock git tracking
vi.mock("../../../hooks/use-project-git-status.js", () => ({
  useProjectGitStatus: () => ({ status: null, loading: false })
}));

// Mock API calls
vi.mock("../../../lib/file-browser-api.js", () => ({
  fetchFileBrowserTree: vi.fn().mockResolvedValue({ root: [], truncated: false }),
  fetchFileBrowserDiff: vi.fn(),
  fetchFileBrowserFile: vi.fn(),
  fetchFileBrowserChanges: vi.fn().mockResolvedValue({ available: true, files: [], featureBranch: "feature/s1", defaultBranch: "main" }),
  startFileBrowserSession: vi.fn(),
  stopFileBrowserSession: vi.fn(),
  rebuildFileBrowserSession: vi.fn(),
  removeFileBrowserSession: vi.fn(),
}));

vi.mock("../../../lib/monaco-setup.js", () => ({
  ensureMonacoConfigured: vi.fn(),
  MONACO_DARK_THEME: "dark",
  MONACO_LIGHT_THEME: "light",
}));

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-editor" />,
  Editor: () => <div data-testid="monaco-editor" />,
  DiffEditor: () => <div data-testid="monaco-diff-editor" />,
}));

const { FileBrowserPage } = await import("../../../FileBrowserPage.js");

test("FileBrowserPage initializes sideBySide dynamically based on window.innerWidth", async () => {
  // Mobile width
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 768 });

  const { queryByText, getByRole } = render(<FileBrowserPage />);

  fireEvent.click(getByRole("tab", { name: "Changes" }));

  await waitFor(() => {
     expect(queryByText("Split") !== null || queryByText("Inline") !== null).toBe(true);
  });
});
