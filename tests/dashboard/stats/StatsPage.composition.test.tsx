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
        { id: "task_coding", usage: { totalTokens: 1000 } },
        { id: "ci_fix", usage: { totalTokens: 2000 } },
        { id: "qa_review", usage: { totalTokens: 3000 } },
        { id: "planning", usage: { totalTokens: 4000 } },
      ],
      chartSeries: [],
    },
    loading: false,
    error: null,
    usage: { wallTimeMs: 3600000, totalTokens: 10000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
    activeQuery: { window: "7d" },
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
  }
}));

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
    expect(screen.getByText("1.0k")).not.toBeNull();

    expect(screen.getByText("CI Fix")).not.toBeNull();
    expect(screen.getByText("2.0k")).not.toBeNull();

    expect(screen.getByText("QA Review")).not.toBeNull();
    expect(screen.getByText("3.0k")).not.toBeNull();

    expect(screen.getByText("Planning")).not.toBeNull();
    expect(screen.getByText("4.0k")).not.toBeNull();

    expect(screen.getByText("Wall Runtime")).not.toBeNull();
    // 3600000 ms is 1h 0m
    expect(screen.getByText("1h 0m")).not.toBeNull();
  });
});
