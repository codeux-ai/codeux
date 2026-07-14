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
import { DashboardI18nProvider } from "../../../../dashboard/src/v2/i18n/context.js";
import type { DashboardLocale } from "../../../../dashboard/src/v2/i18n/locales.js";

expect.extend(matchers);

const renderLocalized = (ui: preact.ComponentChild, locale: DashboardLocale = "en") => render(
  <DashboardI18nProvider initialLocale={locale} storage={null}>{ui}</DashboardI18nProvider>,
);

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
  default: ({ value, language, path, options }: any) => <div data-testid="monaco-editor" data-language={language} data-path={path} aria-label={options?.ariaLabel}>{value}</div>,
  Editor: ({ value, language, path, options }: any) => <div data-testid="monaco-editor" data-language={language} data-path={path} aria-label={options?.ariaLabel}>{value}</div>,
  DiffEditor: ({ original, modified, language, options }: any) => <div data-testid="monaco-diff-editor" data-language={language} data-original={original} aria-label={options?.ariaLabel}>{modified}</div>
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

      renderLocalized(<FileTree nodes={nodes as any} selectedPath={null} onSelectFile={onSelect} searchTerm="test" />);

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
      const { container } = renderLocalized(<FileTree nodes={nodes as any} selectedPath="/test-file.ts" onSelectFile={vi.fn()} searchTerm="" />);

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

      renderLocalized(<FileTree nodes={nodes as any} selectedPath="/test-file.ts" onSelectFile={vi.fn()} loadingPath="/test-file.ts" />);

      const row = screen.getByRole("treeitem", { name: /File \/test-file\.ts, loading contents/i });
      expect(row).toHaveAttribute("aria-busy", "true");
      expect(row).toHaveAccessibleDescription("Loading");
      expect(screen.getByText("Loading")).toBeInTheDocument();
    });

    it("supports keyboard navigation with German accessible names and verbatim long paths", () => {
      const longPath = "/src/ein/sehr/langer/pfad/unchanged-name.ts";
      const nodes = [{ id: "long", type: "file", name: "unchanged-name.ts", path: longPath }];
      const onSelect = vi.fn();

      const { container } = renderLocalized(<FileTree nodes={nodes as any} selectedPath={null} onSelectFile={onSelect} />, "de");
      const row = screen.getByRole("treeitem", { name: `Datei ${longPath}` });
      fireEvent.keyDown(row, { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith(longPath);
      expect(container.firstElementChild).toHaveClass("overflow-hidden");
    });
  });

  describe("ChangesList", () => {
    it("renders empty state", () => {
      renderLocalized(<ChangesList files={[]} selectedPath={null} onSelect={vi.fn()} />);
      expect(screen.getByText("No changes detected")).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("renders changed files with selection state and calls onSelect", () => {
      const files = [
        { path: "/changed.ts", status: "modified", additions: 5, deletions: 2 }
      ];
      const onSelect = vi.fn();
      const { container } = renderLocalized(<ChangesList files={files as any} selectedPath="/changed.ts" onSelect={onSelect} />);

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

      renderLocalized(<ChangesList files={files as any} selectedPath="/changed.ts" onSelect={vi.fn()} loadingPath="/changed.ts" />);

      const option = screen.getByRole("option", { name: /Modified file \/changed\.ts, 5 additions, 2 deletions, loading diff/i });
      expect(option).toHaveAttribute("aria-busy", "true");
      expect(option).toHaveAccessibleDescription("Loading");
      expect(screen.getByText("Loading")).toBeInTheDocument();
    });

    it("keeps Git status order and paths intact in German change summaries", () => {
      const files = [
        { path: "src/added.ts", status: "added", additions: 1, deletions: 0 },
        { path: "src/modified.ts", status: "modified", additions: 2, deletions: 3 },
        { path: "src/deleted.ts", status: "deleted", additions: 0, deletions: 4 },
      ];

      renderLocalized(<ChangesList files={files as any} selectedPath="src/added.ts" onSelect={vi.fn()} />, "de");
      const options = screen.getAllByRole("option");

      expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
        "Hinzugefügt: Datei src/added.ts, 1 Ergänzungen, 0 Löschungen",
        "Geändert: Datei src/modified.ts, 2 Ergänzungen, 3 Löschungen",
        "Gelöscht: Datei src/deleted.ts, 0 Ergänzungen, 4 Löschungen",
      ]);
    });
  });

  describe("FileViewer", () => {
    it("renders loading state with status role", () => {
      renderLocalized(<FileViewer file={null} loading={true} error={null} isDark={false} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading file…")).toBeInTheDocument();
    });

    it("renders error state with alert role", () => {
      renderLocalized(<FileViewer file={null} loading={false} error="Failed to fetch" isDark={false} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to load file contents.")).toBeInTheDocument();
      expect(screen.getByText("Try selecting the file again.")).toBeInTheDocument();
    });

    it("renders binary state with status role", () => {
      renderLocalized(<FileViewer file={{ binary: true, path: "/img.png", content: "" } as any} loading={false} error={null} isDark={false} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Binary file detected")).toBeInTheDocument();
    });

    it("renders German binary chrome while preserving binary metadata paths", () => {
      renderLocalized(<FileViewer file={{ binary: true, path: "/assets/logo.bin", content: "", encoding: "binary", size: 4096 } as any} loading={false} error={null} isDark={false} />, "de");
      expect(screen.getByText("Binärdatei erkannt")).toBeInTheDocument();
      expect(screen.getByText("Der Dateiinhalt kann im Editor nicht angezeigt werden.")).toBeInTheDocument();
    });

    it("keeps cached file content visible with stale refresh copy", () => {
      renderLocalized(<FileViewer file={{ binary: false, path: "/app.ts", content: "cached file", language: "typescript" } as any} loading={true} error={null} isDark={false} />);
      expect(screen.getByRole("region", { name: "File contents for /app.ts" })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Refreshing file. Showing cached contents.")).toBeInTheDocument();
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
  });

  describe("DiffViewer", () => {
    it("renders empty state when diff is null", () => {
      renderLocalized(<DiffViewer diff={null} loading={false} error={null} isDark={false} sideBySide={false} />);
      expect(screen.getByText("No change selected")).toBeInTheDocument();
    });

    it("keeps cached diff visible with stale refresh copy", () => {
      renderLocalized(
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

    it("localizes viewer chrome while preserving paths, content, language IDs, and backend errors", () => {
      renderLocalized(
        <FileViewer
          file={{ binary: false, path: "/src/Über-long.ts", content: "const message = 'unverändert';", language: "typescript" } as any}
          loading={false}
          error="SERVER_ERR unverändert"
          isDark={false}
        />,
        "de",
      );

      expect(screen.getByRole("region", { name: "Dateiinhalt für /src/Über-long.ts" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("SERVER_ERR unverändert");
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "typescript");
      expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-path", "/src/Über-long.ts");
      expect(screen.getByTestId("monaco-editor")).toHaveTextContent("const message = 'unverändert';");
    });
  });
});
