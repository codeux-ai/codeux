/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";

// JSDOM missing queryCommandSupported - mock before importing anything else
document.queryCommandSupported = vi.fn().mockReturnValue(false);

import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { FileTree } from "../../../../dashboard/src/v2/components/file-browser/FileTree.js";
import { ChangesList } from "../../../../dashboard/src/v2/components/file-browser/ChangesList.js";
import { FileViewer } from "../../../../dashboard/src/v2/components/file-browser/FileViewer.js";
import { DiffViewer } from "../../../../dashboard/src/v2/components/file-browser/DiffViewer.js";

expect.extend(matchers);

vi.mock("../../../../dashboard/src/v2/lib/monaco-setup.js", () => ({
  ensureMonacoConfigured: vi.fn(),
  MONACO_DARK_THEME: "dark",
  MONACO_LIGHT_THEME: "light"
}));


// Mock react-arborist since JSDOM might lack full ResizeObserver/DOM support for it
vi.mock("react-arborist", () => ({
  Tree: ({ data, selection, onSelect, searchMatch, children, searchTerm, loadingPath }: any) => {
    // Just render rows as a flat list for testing tree row component logic
    return (
      <div data-testid="mock-tree">
        {data.map((nodeData: any) => {
          const node = {
            data: nodeData,
            isSelected: selection === nodeData.path,
            isOpen: false,
            select: () => { onSelect([{ data: nodeData }]); },
            toggle: vi.fn(),
          };
          const style = {};
          const dragHandle = vi.fn();
          const tree = { props: { searchTerm, loadingPath } };
          return <div key={nodeData.id}>{children({ node, style, dragHandle, tree })}</div>;
        })}
      </div>
    );
  }
}));

// Mock Monaco Editor because it complains about queryCommandSupported
vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-editor" />,
  Editor: () => <div data-testid="monaco-editor" />,
  DiffEditor: () => <div data-testid="monaco-diff-editor" />
}));

describe("File Browser Components", () => {
  afterEach(() => {
    cleanup();
  });

  describe("FileTree", () => {
    it("renders search matches with highlight and selects files", () => {
      const nodes = [
        { id: "1", type: "file", name: "test-file.ts", path: "/test-file.ts" },
        { id: "2", type: "directory", name: "src", path: "/src" }
      ];
      const onSelect = vi.fn();

      render(<FileTree nodes={nodes as any} selectedPath={null} onSelectFile={onSelect} searchTerm="test" />);

      expect(screen.getByRole("tree", { name: "Sprint file tree" })).toBeInTheDocument();

      // Ensure highlight is rendered
      const mark = screen.getByText("test");
      expect(mark.tagName.toLowerCase()).toBe("mark");

      // Verify file selection callback
      const testFileRow = screen.getByText("-file.ts").parentElement?.parentElement;
      if (testFileRow) {
        fireEvent.click(testFileRow);
      }
      expect(onSelect).toHaveBeenCalledWith("/test-file.ts");
    });

    it("applies correct selected styling and focus-visible handling", () => {
      const nodes = [
        { id: "1", type: "file", name: "test-file.ts", path: "/test-file.ts" }
      ];
      const { container } = render(<FileTree nodes={nodes as any} selectedPath="/test-file.ts" onSelectFile={vi.fn()} searchTerm="" />);

      const row = container.querySelector('[tabindex="0"]');
      expect(row?.className).toContain("bg-signal-500/[0.14]");
      expect(row?.className).toContain("focus-visible:ring-2");
      expect(row).toHaveAttribute("role", "treeitem");
      expect(row).toHaveAttribute("aria-selected", "true");
    });

    it("marks the selected file row busy while file contents load", () => {
      const nodes = [
        { id: "1", type: "file", name: "test-file.ts", path: "/test-file.ts" }
      ];

      render(<FileTree nodes={nodes as any} selectedPath="/test-file.ts" onSelectFile={vi.fn()} loadingPath="/test-file.ts" />);

      const row = screen.getByRole("treeitem", { name: /File \/test-file\.ts, loading contents/i });
      expect(row).toHaveAttribute("aria-busy", "true");
      expect(row).toHaveAccessibleDescription("Loading");
      expect(screen.getByText("Loading")).toBeInTheDocument();
    });
  });

  describe("ChangesList", () => {
    it("renders empty state", () => {
      render(<ChangesList files={[]} selectedPath={null} onSelect={vi.fn()} />);
      expect(screen.getByText("No changes detected")).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("renders changed files with selection state and calls onSelect", () => {
      const files = [
        { path: "/changed.ts", status: "modified", additions: 5, deletions: 2 }
      ];
      const onSelect = vi.fn();
      const { container } = render(<ChangesList files={files as any} selectedPath="/changed.ts" onSelect={onSelect} />);

      expect(screen.getByText("changed.ts")).toBeInTheDocument();
      expect(screen.getByText("+5")).toBeInTheDocument();
      expect(screen.getByRole("listbox", { name: "Changed files" })).toBeInTheDocument();

      const button = container.querySelector('button');
      expect(button?.className).toContain("bg-signal-500/[0.12]");
      expect(button).toHaveAttribute("aria-selected", "true");

      fireEvent.click(button!);
      expect(onSelect).toHaveBeenCalledWith("/changed.ts");
    });

    it("marks the selected changed file busy while its diff loads", () => {
      const files = [
        { path: "/changed.ts", status: "modified", additions: 5, deletions: 2 }
      ];

      render(<ChangesList files={files as any} selectedPath="/changed.ts" onSelect={vi.fn()} loadingPath="/changed.ts" />);

      const option = screen.getByRole("option", { name: /Modified file \/changed\.ts, 5 additions, 2 deletions, loading diff/i });
      expect(option).toHaveAttribute("aria-busy", "true");
      expect(option).toHaveAccessibleDescription("Loading");
      expect(screen.getByText("Loading")).toBeInTheDocument();
    });
  });

  describe("FileViewer", () => {
    it("renders loading state with status role", () => {
      render(<FileViewer file={null} loading={true} error={null} isDark={false} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading file…")).toBeInTheDocument();
    });

    it("renders error state with alert role", () => {
      render(<FileViewer file={null} loading={false} error="Failed to fetch" isDark={false} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to load file contents.")).toBeInTheDocument();
      expect(screen.getByText("Try selecting the file again.")).toBeInTheDocument();
    });

    it("renders binary state with status role", () => {
      render(<FileViewer file={{ binary: true, path: "/img.png", content: "" } as any} loading={false} error={null} isDark={false} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Binary file detected")).toBeInTheDocument();
    });

    it("keeps cached file content visible with stale refresh copy", () => {
      render(<FileViewer file={{ binary: false, path: "/app.ts", content: "cached file", language: "typescript" } as any} loading={true} error={null} isDark={false} />);
      expect(screen.getByRole("region", { name: "File contents for /app.ts" })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Refreshing file. Showing cached contents.")).toBeInTheDocument();
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
  });

  describe("DiffViewer", () => {
    it("renders empty state when diff is null", () => {
      render(<DiffViewer diff={null} loading={false} error={null} isDark={false} sideBySide={false} />);
      expect(screen.getByText("No change selected")).toBeInTheDocument();
    });

    it("keeps cached diff visible with stale refresh copy", () => {
      render(
        <DiffViewer
          diff={{ path: "/app.ts", original: "old", modified: "new", binary: false, language: "typescript" } as any}
          loading={true}
          error={null}
          isDark={false}
          sideBySide={false}
        />
      );

      expect(screen.getByRole("region", { name: "Diff for /app.ts" })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Refreshing diff. Showing cached comparison.")).toBeInTheDocument();
      expect(screen.getByTestId("monaco-diff-editor")).toBeInTheDocument();
    });
  });
});
