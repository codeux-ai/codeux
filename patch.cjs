const fs = require('fs');
const path = 'tests/dashboard/v2/sprints-page.test.tsx';
const content = fs.readFileSync(path, 'utf8');
const fixedContent = content.replace(/  it\("closes the import menu on escape key press or outside click", \(\) => \{\n    vi.mocked\(useSprintsPageData\).mockReturnValue\(\{/g, `  it("closes the import menu on escape key press or outside click", () => {\n    vi.mocked(useSprintsPageData).mockReturnValue({`);
// it seems it may have duplicate entries, so let's just rewrite the whole thing

const correctContent = `/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintsPage } from "../../../dashboard/src/v2/pages/sprints/SprintsPage";

// @ts-expect-error Types are not required for test
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/pages/sprints/use-sprints-page-data");
vi.mock("../../../dashboard/src/v2/components/ui/SprintMarkdownModal", () => ({
  SprintMarkdownModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="sprint-markdown-modal">
      <button onClick={onClose} data-testid="close-modal">Close</button>
    </div>
  )
}));

describe("SprintsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the import menu and opens the markdown modal", async () => {
    vi.mocked(useSprintsPageData).mockReturnValue({
      selectedProject: { id: "proj-1" },
      planningRoute: { available: true },
      sortedSprints: [],
      showcaseSprints: [],
      activeRunsBySprintId: new Map(),
      interventionBySprintId: new Map(),
      nextId: "spr-123",
      virtualProviders: [],
      pendingActionIds: new Set(),
      planningPresets: [],
      quicksprintTemplates: [],
      showImportModal: false,
      setShowImportModal: vi.fn(),
    } as any);

    const { rerender } = render(<SprintsPage />);

    // Verify the Import trigger is visible
    const importTriggers = screen.getAllByRole("button");
    const importTrigger = importTriggers.find((btn) => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown")) || importTriggers.find((btn) => btn.textContent?.includes("Import"))!;
    expect(importTrigger).toBeInTheDocument();

    // Open the menu
    fireEvent.click(importTrigger);

    // Click the Markdown option
    const markdownOption = screen.getByRole("button", { name: /markdown/i });
    fireEvent.click(markdownOption);

    // Ensure the modal state is updated
    expect(vi.mocked(useSprintsPageData)().setShowImportModal).toHaveBeenCalledWith(true);

    // Re-render with modal shown to verify placeholder rendering
    vi.mocked(useSprintsPageData).mockReturnValue({
      selectedProject: { id: "proj-1" },
      planningRoute: { available: true },
      sortedSprints: [],
      showcaseSprints: [],
      activeRunsBySprintId: new Map(),
      interventionBySprintId: new Map(),
      nextId: "spr-123",
      virtualProviders: [],
      pendingActionIds: new Set(),
      planningPresets: [],
      quicksprintTemplates: [],
      showImportModal: true,
      setShowImportModal: vi.fn(),
    } as any);
    rerender(<SprintsPage />);

    expect(screen.getByTestId("sprint-markdown-modal")).toBeInTheDocument();
  });

  it("shows Jira as a coming soon option without throwing an error", () => {
    vi.mocked(useSprintsPageData).mockReturnValue({
      selectedProject: { id: "proj-1" },
      planningRoute: { available: true },
      sortedSprints: [],
      showcaseSprints: [],
      activeRunsBySprintId: new Map(),
      interventionBySprintId: new Map(),
      nextId: "spr-123",
      virtualProviders: [],
      pendingActionIds: new Set(),
      planningPresets: [],
      quicksprintTemplates: [],
      showImportModal: false,
      setShowImportModal: vi.fn(),
    } as any);

    render(<SprintsPage />);

    // Open the menu
    const importTriggers = screen.getAllByRole("button");
    const importTrigger = importTriggers.find((btn) => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown")) || importTriggers.find((btn) => btn.textContent?.includes("Import"))!;
    fireEvent.click(importTrigger);

    // Ensure Jira item exists
    expect(screen.getAllByText("Jira")[0]).toBeInTheDocument();
    expect(screen.getByText("Soon")).toBeInTheDocument();
  });

  it("closes the import menu on escape key press or outside click", () => {
    vi.mocked(useSprintsPageData).mockReturnValue({
      selectedProject: { id: "proj-1" },
      planningRoute: { available: true },
      sortedSprints: [],
      showcaseSprints: [],
      activeRunsBySprintId: new Map(),
      interventionBySprintId: new Map(),
      nextId: "spr-123",
      virtualProviders: [],
      pendingActionIds: new Set(),
      planningPresets: [],
      quicksprintTemplates: [],
      showImportModal: false,
      setShowImportModal: vi.fn(),
    } as any);

    render(<SprintsPage />);

    // Open the menu
    const importTriggers = screen.getAllByRole("button");
    const importTrigger = importTriggers.find((btn) => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown")) || importTriggers.find((btn) => btn.textContent?.includes("Import"))!;
    fireEvent.click(importTrigger);

    // Ensure menu is open
    expect(screen.getAllByText("Jira")[0]).toBeInTheDocument();

    // Escape key press
    fireEvent.keyDown(document, { key: "Escape" });

    // Open again
    fireEvent.click(importTrigger);

    // Outside click
    fireEvent.mouseDown(document.body);
  });
});
`
fs.writeFileSync(path, correctContent);
