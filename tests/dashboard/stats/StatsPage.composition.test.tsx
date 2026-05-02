/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";

// Mock the dependencies
vi.mock("../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: () => ({
    stats: {
      range: { resolutionLabel: "hour" },
      buckets: [],
      providers: [], purposes: [
        { id: "task_coding", label: "Task Coding", usage: { totalTokens: 1000, activeTimeMs: 0 } },
        { id: "ci_fix", label: "CI Fix", usage: { totalTokens: 2000, activeTimeMs: 0 } },
        { id: "qa_review", label: "QA Review", usage: { totalTokens: 3000, activeTimeMs: 0 } },
        { id: "planning", label: "Planning", usage: { totalTokens: 4000, activeTimeMs: 0 } },
      ],
      chartSeries: [],
      usage: { totalTokens: 10000, inputTokens: 5000, cachedInputTokens: 0, outputTokens: 5000, reasoningOutputTokens: 0, wallTimeMs: 3600000, totalTokens: 10000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
    },
    loading: false,
    error: null,
    usage: { wallTimeMs: 3600000, totalTokens: 10000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
    activeQuery: { window: "7d" },
    providerSegments: [], tokenSegments: [], sourceSegments: [], chartState: { zoomRange: null, setZoomRange: () => {}, hoveredIndex: null, setHoveredIndex: () => {}, enabledSeries: {} },
    visualMode: "composition",
  }),
}));

vi.mock("gsap", () => ({
  default: {
        registerPlugin: vi.fn(),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis(), to: vi.fn().mockReturnThis() })),
    context: vi.fn(() => ({ revert: vi.fn() })),
    to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
  }
}));

// Mock sparkline specifically because its dependency relies on DOM sizes
vi.mock("../../../dashboard/src/v2/components/ui/Sparkline.js", () => ({
  Sparkline: () => <div data-testid="mock-sparkline">Sparkline</div>,
}));

describe("StatsPage Composition", () => {
  it("renders distinct composition cards with correct values and titles", () => {
    const mockContext = {
      selectedProject: { id: "p1", name: "Project 1" },
      activeQuery: { window: "7d" },
      activeRangeStart: new Date(),
      activeRangeEnd: new Date(),
      lastActivityDate: null,
      selectedRangeSummary: "Last 7 days",
      refresh: vi.fn(),
      applyWindowPreset: vi.fn(),
    } as any;

    render(
      <ProjectDataContext.Provider value={mockContext}>
        <StatsPage />
      </ProjectDataContext.Provider>
    );

    // Assert that the composition cards exist
    expect(screen.getByText("Active Providers")).not.toBeNull();
    expect(screen.getByText("Top Provider")).not.toBeNull();
    expect(screen.getByText("Input Tokens")).not.toBeNull();
    expect(screen.getByText("Output Tokens")).not.toBeNull();
  });
});
