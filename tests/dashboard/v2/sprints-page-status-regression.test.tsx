/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintsPage } from "../../../dashboard/src/v2/pages/sprints/SprintsPage.js";
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data.js";
import { 
  createSprintRunFixture, 
  createManualPauseIntervention, 
  createSystemStopIntervention 
} from "../fixtures/sprint-status.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn(),
    timeline: vi.fn().mockReturnValue({
      fromTo: vi.fn().mockReturnThis(),
      to: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
    }),
  }
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

vi.mock("../../../dashboard/src/v2/pages/sprints/use-sprints-page-data.js");

describe("SprintsPage Status Regression", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const basePageData = {
    selectedProject: { id: "proj-1" },
    planningRoute: { available: true },
    sortedSprints: [
      { 
        id: "sprint-1", 
        sprint_number: 1, 
        number: 1, 
        slug: "sprint-1", 
        title: "Sprint 1", 
        name: "Sprint 1",
        status: "paused", 
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    showcaseSprints: [],
    activeRunsBySprintId: new Map(),
    interventionBySprintId: new Map(),
    pauseResumeRunsBySprintId: new Map(),
    actionableInterventionBySprintId: new Map(),
    nextId: "sprint-2",
    virtualProviders: [],
    pendingActionIds: new Set(),
    planningPresets: [],
    quicksprintTemplates: [],
    showImportModal: false,
    setShowImportModal: vi.fn(),
    feedback: { status: "idle", message: null },
    clearFeedback: vi.fn(),
    setShowQuicksprint: vi.fn(),
    setShowCreateComposer: vi.fn(),
    setEditingSprint: vi.fn(),
  };

  it("shows exactly one intervention badge for a manually paused sprint", () => {
    const activeRunsBySprintId = new Map();
    activeRunsBySprintId.set("sprint-1", createSprintRunFixture({
      status: "paused",
      humanIntervention: createManualPauseIntervention(),
    }));

    const interventionBySprintId = new Map();
    interventionBySprintId.set("sprint-1", createManualPauseIntervention());

    vi.mocked(useSprintsPageData).mockReturnValue({
      ...basePageData,
      activeRunsBySprintId,
      interventionBySprintId,
    } as any);

    render(<SprintsPage />);

    // Check for "Needs you" badge - should only be one per sprint cell
    const badges = screen.getAllByText("Needs you");
    expect(badges).toHaveLength(1);
  });

  it("hides intervention badge for a system stopped sprint", () => {
    const activeRunsBySprintId = new Map();
    activeRunsBySprintId.set("sprint-1", createSprintRunFixture({
      status: "paused",
      humanIntervention: createSystemStopIntervention(),
    }));

    // Intervention might still be in the map, but badge should be hidden by mapper
    const interventionBySprintId = new Map();
    interventionBySprintId.set("sprint-1", createSystemStopIntervention());

    vi.mocked(useSprintsPageData).mockReturnValue({
      ...basePageData,
      activeRunsBySprintId,
      interventionBySprintId,
    } as any);

    render(<SprintsPage />);

    // Assert "Needs you" badge is absent
    expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
  });
});
