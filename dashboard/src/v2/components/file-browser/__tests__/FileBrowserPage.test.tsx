// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import type { ComponentChildren } from "preact";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileBrowserPage } from "../../../FileBrowserPage.js";
import { ChangesList } from "../ChangesList.js";
import { DiffViewer } from "../DiffViewer.js";
import { FileTree } from "../FileTree.js";
import { FileViewer } from "../FileViewer.js";
import type { FileBrowserSession, FileBrowserTree } from "../../../../types.js";
import {
  fetchFileBrowserChanges,
  fetchFileBrowserDiff,
  fetchFileBrowserFile,
  fetchFileBrowserTree,
} from "../../../lib/file-browser-api.js";

expect.extend(matchers);

const refreshSessions = vi.fn(async () => undefined);

interface MockTreeNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  children?: MockTreeNode[];
}

interface MockRenderedNode {
  data: MockTreeNode;
  isSelected: boolean;
  isOpen: boolean;
  toggle: () => void;
  select: () => void;
}

const runningSession: FileBrowserSession = {
  id: "session-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  projectName: "Project 1",
  sprintName: "Sprint With A Very Long Inspection Name",
  sprintNumber: 7,
  status: "running",
  containerId: "container-1",
  containerName: "codeux-file-browser",
  workspacePath: "/workspace",
  featureBranch: "feat/very-long-file-browser-workbench-branch-name-that-wraps",
  defaultBranch: "dev",
  lastCompletedTaskCount: 1,
  lastSeenSprintStatus: "active",
  lastError: null,
  lastBuildAt: "2026-07-04T00:00:00.000Z",
  lastStartedAt: "2026-07-04T00:00:00.000Z",
  lastStoppedAt: null,
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

const fileTree: FileBrowserTree = {
  sessionId: "session-1",
  fileCount: 2,
  truncated: false,
  root: [
    {
      id: "src",
      name: "src",
      path: "src",
      type: "directory",
      children: [
        {
          id: "src/components",
          name: "components",
          path: "src/components",
          type: "directory",
          children: [
            {
              id: "src/components/ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx",
              name: "ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx",
              path: "src/components/ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx",
              type: "file",
            },
          ],
        },
        {
          id: "src/empty",
          name: "empty",
          path: "src/empty",
          type: "directory",
          children: [],
        },
      ],
    },
  ],
};

vi.mock("@monaco-editor/react", () => ({
  default: ({ path }: { path?: string }) => <div data-testid="mock-editor">{path}</div>,
  DiffEditor: ({ language }: { language?: string }) => <div data-testid="mock-diff-editor">{language}</div>,
  loader: { config: vi.fn() },
}));

vi.mock("react-arborist", () => ({
  Tree: ({
    data,
    children,
    selection,
    onSelect,
    searchTerm,
  }: {
    data: MockTreeNode[];
    children: (props: {
      node: MockRenderedNode;
      style: Record<string, never>;
      dragHandle: null;
      tree: { props: { searchTerm?: string } };
    }) => ComponentChildren;
    selection?: string;
    onSelect?: (selectedNodes: MockRenderedNode[]) => void;
    searchTerm?: string;
  }) => {
    const renderNode = (item: MockTreeNode): ComponentChildren => {
      let renderedNode: MockRenderedNode;
      renderedNode = {
        data: item,
        isSelected: selection === item.path,
        isOpen: true,
        toggle: vi.fn(),
        select: () => onSelect?.([renderedNode]),
      };

      return (
        <div key={item.id}>
          {children({ node: renderedNode, style: {}, dragHandle: null, tree: { props: { searchTerm } } })}
          {item.children?.map(renderNode)}
        </div>
      );
    };

    return <div role="tree">{data.map(renderNode)}</div>;
  },
}));

vi.mock("../../../lib/monaco-setup.js", () => ({
  ensureMonacoConfigured: vi.fn(),
  MONACO_DARK_THEME: "codeux-dark",
  MONACO_LIGHT_THEME: "codeux-light",
}));

vi.mock("../../../context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "project-1", name: "Project 1" },
  }),
}));

vi.mock("../../../hooks/useSprints.js", () => ({
  useSprints: () => ({
    data: [{ id: "sprint-1", name: "Sprint With A Very Long Inspection Name" }],
    selectedSprint: { id: "sprint-1", name: "Sprint With A Very Long Inspection Name" },
    selectedSprintId: "sprint-1",
  }),
}));

vi.mock("../../../hooks/use-is-dark.js", () => ({
  useIsDark: () => false,
}));

vi.mock("../../../hooks/use-file-browser-sessions.js", () => ({
  useFileBrowserSessions: () => ({
    sessions: [runningSession],
    selectedSession: runningSession,
    loading: false,
    error: null,
    refresh: refreshSessions,
  }),
}));

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

beforeEach(() => {
  vi.mocked(fetchFileBrowserTree).mockResolvedValue(fileTree);
  vi.mocked(fetchFileBrowserFile).mockResolvedValue({
    path: fileTree.root[0].children?.[0]?.children?.[0]?.path ?? "src/file.ts",
    content: "export const value = 1;\n",
    encoding: "utf8",
    size: 23,
    truncated: false,
    binary: false,
    language: "typescript",
  });
  vi.mocked(fetchFileBrowserChanges).mockResolvedValue({
    sessionId: "session-1",
    featureBranch: "feat/branch",
    defaultBranch: "dev",
    available: true,
    reason: null,
    files: [],
  });
  vi.mocked(fetchFileBrowserDiff).mockResolvedValue({
    path: "src/file.ts",
    oldPath: null,
    status: "modified",
    original: "old",
    modified: "new",
    binary: false,
    language: "typescript",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("FileBrowserPage renders cohesive workbench regions and accessible controls", async () => {
  const { getByLabelText, getByTestId, findByLabelText } = render(<FileBrowserPage />);

  expect(getByTestId("file-browser-page-root")).toBeInTheDocument();
  expect(getByLabelText("File browser session controls")).toBeInTheDocument();
  expect(getByLabelText("Refresh file browser sessions")).toBeInTheDocument();
  expect(getByLabelText("File tree panel")).toBeInTheDocument();
  expect(getByLabelText("File viewer panel")).toBeInTheDocument();
  expect(getByLabelText("Filter file tree")).toBeInTheDocument();

  await findByLabelText("File tree");

  fireEvent.click(getByLabelText(/^File src\/components\/ExtremelyLongFileName/));

  await waitFor(() => {
    expect(getByLabelText("Selected file path")).toHaveTextContent(
      "src/components/ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx",
    );
  });
  expect(fetchFileBrowserFile).toHaveBeenCalledWith(
    "session-1",
    "src/components/ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx",
  );
});

test("FileTree exposes selectable files, empty directories, and wrapped labels", () => {
  const onSelectFile = vi.fn();
  const { getByLabelText, getByText } = render(
    <FileTree nodes={fileTree.root} selectedPath={null} onSelectFile={onSelectFile} searchTerm="LongFile" />,
  );

  fireEvent.click(getByLabelText("Folder src"));
  fireEvent.click(getByLabelText("Folder src/components"));

  const fileRow = getByLabelText(/^File src\/components\/ExtremelyLongFileName/);
  expect(fileRow).toHaveAttribute("title", "src/components/ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx");
  expect(fileRow.querySelector(".break-all")).not.toBeNull();
  expect(getByText("LongFile")).toBeInTheDocument();

  fireEvent.click(fileRow);
  expect(onSelectFile).toHaveBeenCalledWith("src/components/ExtremelyLongFileNameThatNeedsToWrapInsteadOfOverflowingThePage.tsx");

  expect(getByLabelText("Folder src/empty, empty")).toBeInTheDocument();
  expect(getByText("Empty")).toBeInTheDocument();
});

test("FileViewer and DiffViewer empty states have accessible labels", () => {
  const { getByLabelText, getByText, rerender } = render(
    <FileViewer file={null} loading={false} error={null} isDark={false} />,
  );

  expect(getByLabelText("File viewer empty state")).toBeInTheDocument();
  expect(getByText("No file selected")).toBeInTheDocument();

  rerender(<DiffViewer diff={null} loading={false} error={null} isDark={false} sideBySide={false} />);

  expect(getByLabelText("Diff viewer empty state")).toBeInTheDocument();
  expect(getByText("No change selected")).toBeInTheDocument();
});

test("ChangesList preserves status details and wraps long paths", () => {
  const onSelect = vi.fn();
  const longPath = "dashboard/src/v2/components/file-browser/ExtremelyLongChangedFileNameThatMustWrapOnMobileAndDesktop.tsx";
  const { getByLabelText, getByText } = render(
    <ChangesList
      files={[
        {
          path: longPath,
          oldPath: "dashboard/src/v2/old/OldFileName.tsx",
          status: "renamed",
          additions: 12,
          deletions: 4,
        },
      ]}
      selectedPath={longPath}
      onSelect={onSelect}
    />,
  );

  const change = getByLabelText(`${"Renamed"} file ${longPath}, 12 additions and 4 deletions`);
  expect(change).toHaveAttribute("title", longPath);
  expect(getByText("ExtremelyLongChangedFileNameThatMustWrapOnMobileAndDesktop.tsx")).toHaveClass("break-all");
  expect(getByText("from dashboard/src/v2/old/OldFileName.tsx")).toBeInTheDocument();

  fireEvent.click(change);
  expect(onSelect).toHaveBeenCalledWith(longPath);
});

test("ChangesList empty state is labelled for assistive technology", () => {
  const { getByLabelText, getByText } = render(
    <ChangesList files={[]} selectedPath={null} onSelect={() => undefined} />,
  );

  expect(getByLabelText("Changes list empty state")).toBeInTheDocument();
  expect(getByText("No changes detected")).toBeInTheDocument();
});
