/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";

// Mock the dependencies
vi.mock("../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: () => {
    const usage = { wallTimeMs: 3600000, totalTokens: 10000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputTokens: 5000, cachedInputTokens: 1000, outputTokens: 3000, reasoningOutputTokens: 1000 };
    return {
      stats: {
        range: { resolutionLabel: "hour" },
        buckets: [],
        providers: [],
        usage: usage,
        purposes: [
          { id: "task_coding", label: "task_coding", usage: { totalTokens: 1000, activeTimeMs: 100, inputTokens: 500, outputTokens: 500 } },
          { id: "ci_fix", label: "ci_fix", usage: { totalTokens: 2000, activeTimeMs: 200, inputTokens: 1000, outputTokens: 1000 } },
          { id: "qa_review", label: "qa_review", usage: { totalTokens: 3000, activeTimeMs: 300, inputTokens: 1500, outputTokens: 1500 } },
          { id: "planning", label: "planning", usage: { totalTokens: 4000, activeTimeMs: 400, inputTokens: 2000, outputTokens: 2000 } },
        ],
        chartSeries: [],
      },
      loading: false,
      error: null,
      usage: usage,
      activeQuery: { window: "7d" },
      visualMode: "composition",
      setVisualMode: vi.fn(),
      chartState: {
        visualMode: "composition",
        setVisualMode: vi.fn(),
        enabledSeries: {},
        setEnabledSeries: vi.fn(),
      },
      providerSegments: [],
      tokenSegments: [],
      sourceSegments: [],
      completionConfidence: "High",
    };
  },
}));

vi.mock("gsap", () => {
  const mockTimeline = {
    fromTo: vi.fn().mockReturnThis(),
    kill: vi.fn(),
  };
  return {
    default: {
      registerPlugin: vi.fn(),
      killTweensOf: vi.fn(),
      set: vi.fn(),
      context: vi.fn(() => ({ revert: vi.fn() })),
      to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
      fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
      timeline: vi.fn(() => mockTimeline),
    }
  };
});

// Mock sparkline specifically because its dependency relies on DOM sizes
vi.mock("../../../dashboard/src/components/ui/Sparkline.js", () => ({
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
    expect(screen.getByText("Task Coding")).not.toBeNull();
    expect(screen.getAllByText("1.0k").length).toBeGreaterThan(0);

    expect(screen.getByText("CI Fix")).not.toBeNull();
    expect(screen.getAllByText("2.0k").length).toBeGreaterThan(0);

    expect(screen.getByText("QA Review")).not.toBeNull();
    expect(screen.getAllByText("3.0k").length).toBeGreaterThan(0);

    expect(screen.getByText("Planning")).not.toBeNull();
    expect(screen.getAllByText("4.0k").length).toBeGreaterThan(0);

    expect(screen.getByText("Wall Runtime")).not.toBeNull();
    // 3600000 ms is 1h 0m
    expect(screen.getAllByText("1h 0m").length).toBeGreaterThan(0);
  });
});
