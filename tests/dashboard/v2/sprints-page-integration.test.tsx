/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintsPage } from "../../../dashboard/src/v2/pages/sprints/SprintsPage";

// @ts-expect-error Types are not required for test
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn((el, from, to) => { if (to?.onComplete) to.onComplete(); }),
    to: vi.fn((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
    timeline: () => ({
      fromTo: vi.fn(),
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn().mockReturnValue({ data: null, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useSearch: vi.fn().mockReturnValue({ sprintKey: undefined }),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

vi.mock("../../../dashboard/src/v2/pages/sprints/use-sprints-page-data");

describe("SprintsPage Integration Regressions", () => {
  const mockBaseData = {
    selectedProject: { id: "proj-1", name: "Test Project" },
    projects: [{ id: "proj-1", name: "Test Project" }],
    planningRoute: { available: true, label: "Test Worker" },
    sortedSprints: [
      { id: "sprint-1", number: 1, name: "Existing Sprint", status: "completed", showcasePinned: true, createdAt: "2026-06-01T12:00:00Z", updatedAt: "2026-06-01T12:00:00Z", slug: "spr-01", projectId: "proj-1" }
    ],
    showcaseSprints: [],
    activeRunsBySprintId: new Map(),
    pauseResumeRunsBySprintId: new Map(),
    interventionBySprintId: new Map(),
    nextId: "SPR-02",
    virtualProviders: [],
    pendingActionIds: new Set(),
    planningPresets: [],
    quicksprintTemplates: [],
    showQuicksprint: false,
    setShowQuicksprint: vi.fn(),
    showCreateComposer: false,
    setShowCreateComposer: vi.fn(),
    editingSprint: null,
    setEditingSprint: vi.fn(),
    showImportModal: false,
    setShowImportModal: vi.fn(),
    feedback: { status: "idle", message: null },
    clearFeedback: vi.fn(),
    handleSubmitSprint: vi.fn(),
    handleCancelPlanningRequest: vi.fn(),
    handleImprovePrompt: vi.fn(),
    refreshSprints: vi.fn(),
    refreshExecution: vi.fn(),
  };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    if (!window.crypto) {
        (window as any).crypto = {
            randomUUID: () => "test-uuid"
        };
    }
  });

  it("advances next composer key by one when reopening New Sprint after starting a long-running create flow", async () => {
    const setShowCreateComposer = vi.fn();
    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      setShowCreateComposer,
    } as any);

    const { rerender } = render(<SprintsPage />);

    const actionBarBtn = screen.getByRole("button", { name: /^new sprint$/i });
    fireEvent.click(actionBarBtn);
    expect(setShowCreateComposer).toHaveBeenCalledWith(true);

    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      showCreateComposer: true,
      setShowCreateComposer,
    } as any);
    rerender(<SprintsPage />);
    expect(screen.getByText("SPR-02")).toBeInTheDocument();

    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      nextId: "SPR-03",
      showCreateComposer: false,
      setShowCreateComposer,
    } as any);
    rerender(<SprintsPage />);

    const reopenBtn = screen.getByRole("button", { name: /^new sprint$/i });
    fireEvent.click(reopenBtn);
    
    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      nextId: "SPR-03",
      showCreateComposer: true,
      setShowCreateComposer,
    } as any);
    rerender(<SprintsPage />);
    expect(screen.getByText("SPR-03")).toBeInTheDocument();
  });

  it("keeps Quicksprint button enabled and New Sprint available during active normal create flow", async () => {
    const setShowQuicksprint = vi.fn();
    const setShowCreateComposer = vi.fn();

    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      showCreateComposer: true,
      setShowQuicksprint,
      setShowCreateComposer,
    } as any);

    const { rerender } = render(<SprintsPage />);

    expect(screen.getByRole("button", { name: /close composer/i })).toBeInTheDocument();
    const quicksprintBtn = screen.getByRole("button", { name: /^quicksprint$/i });
    fireEvent.click(quicksprintBtn);
    expect(setShowQuicksprint).toHaveBeenCalledWith(true);
    expect(setShowCreateComposer).toHaveBeenCalledWith(false);

    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      showQuicksprint: true,
      showCreateComposer: false,
      setShowQuicksprint,
      setShowCreateComposer,
    } as any);
    rerender(<SprintsPage />);

    const closeQuicksprintBtn = screen.getAllByRole("button").find(b => b.textContent?.includes("Close Quicksprint"));
    expect(closeQuicksprintBtn).toBeInTheDocument();
    
    const newSprintBtn = screen.getAllByRole("button").find(b => b.textContent?.includes("New Sprint"));
    expect(newSprintBtn).toBeInTheDocument();

    fireEvent.click(closeQuicksprintBtn!);
    expect(setShowQuicksprint).toHaveBeenCalledWith(false);
  });

  it("verifies Sprint Composer rendering and basic row menu accessibility", async () => {
    // Regression check for composer and ledger presence
    vi.mocked(useSprintsPageData).mockReturnValue({
      ...mockBaseData,
      showCreateComposer: true,
    } as any);

    render(<SprintsPage />);

    // Composer presence
    expect(screen.getByText("Sprint Composer")).toBeInTheDocument();
    
    // Action menu trigger presence
    expect(screen.getAllByTitle("Open sprint actions")[0]).toBeInTheDocument();
  });
});
