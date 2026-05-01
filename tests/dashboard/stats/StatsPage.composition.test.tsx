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
      purposes: [
        { id: "task_coding", label: "Task Coding", usage: { totalTokens: 1000 } },
        { id: "ci_fix", label: "CI Fix", usage: { totalTokens: 2000 } },
        { id: "qa_review", label: "QA Review", usage: { totalTokens: 3000 } },
        { id: "planning", label: "Planning", usage: { totalTokens: 4000 } },
      ],
      providers: [],
      tokenSources: [],
      usage: { totalTokens: 10000, inputTokens: 5000, outputTokens: 5000, cachedInputTokens: 0, reasoningOutputTokens: 0, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
      chartSeries: [],
    },
    loading: false,
    error: null,
    usage: { wallTimeMs: 3600000, totalTokens: 10000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
    activeQuery: { window: "7d" },
    visualMode: "composition",
    tokenSeries: [],
    activeTimeSeries: [],
    wallTimeSeries: [],
    completionConfidence: "High",
    providerSegments: [],
    tokenSegments: [],
    sourceSegments: [],
  }),
}));

vi.mock("gsap", () => ({
  default: {
    registerPlugin: vi.fn(),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    timeline: vi.fn(() => ({
      fromTo: vi.fn().mockReturnThis(),
      to: vi.fn().mockReturnThis(),
      kill: vi.fn(),
    })),
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
    expect(screen.getAllByText("Task Coding")[0]).not.toBeNull();
    expect(screen.getAllByText("1.0k")[0]).not.toBeNull();

    expect(screen.getAllByText("CI Fix")[0]).not.toBeNull();
    expect(screen.getAllByText("2.0k")[0]).not.toBeNull();

    expect(screen.getAllByText("QA Review")[0]).not.toBeNull();
    expect(screen.getAllByText("3.0k")[0]).not.toBeNull();

    expect(screen.getAllByText("Planning")[0]).not.toBeNull();
    expect(screen.getAllByText("4.0k")[0]).not.toBeNull();

    expect(screen.getAllByText("Wall Runtime")[0]).not.toBeNull();
    // 3600000 ms is 1h 0m
    expect(screen.getAllByText("1h 0m")[0]).not.toBeNull();
  });
});
