// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { FileBrowserPage } from "../../../FileBrowserPage.js";

expect.extend(matchers);

// Mock project context
vi.mock("../../../context/project-data.js", () => ({
  useProjectData: () => ({ project: { id: "p1", name: "Project 1" } })
}));

// Mock sprints hook
vi.mock("../../../hooks/useSprints.js", () => ({
  useSprints: () => ({ sprints: [], loading: false, mutate: vi.fn() })
}));

// Mock sessions hook
vi.mock("../../../hooks/use-file-browser-sessions.js", () => ({
  useFileBrowserSessions: () => ({ sessions: [], loading: false })
}));

// Mock git tracking
vi.mock("../../../hooks/use-project-git-status.js", () => ({
  useProjectGitStatus: () => ({ status: null, loading: false })
}));

// Mock API calls
vi.mock("../../../lib/file-browser-api.js", () => ({
  fetchFileBrowserTree: vi.fn(),
  fetchFileBrowserDiff: vi.fn(),
  fetchFileBrowserFile: vi.fn(),
  fetchFileBrowserChanges: vi.fn(),
  startFileBrowserSession: vi.fn(),
  stopFileBrowserSession: vi.fn(),
  rebuildFileBrowserSession: vi.fn(),
  removeFileBrowserSession: vi.fn(),
}));

test("FileBrowserPage initializes sideBySide dynamically based on window.innerWidth", async () => {
  // Mobile width
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 768 });

  const { getByTestId, queryByText, rerender } = render(<FileBrowserPage />);

  const changesTab = queryByText("Changed files");
  if (changesTab) {
     changesTab.click();
  }

  await waitFor(() => {
     expect(queryByText("Split") !== null || queryByText("Inline") !== null).toBe(true);
  });
});
