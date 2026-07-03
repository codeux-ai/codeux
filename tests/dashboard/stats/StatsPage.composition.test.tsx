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
      providers: [{
        id: "codex",
        provider: "codex",
        label: "Codex",
        secondaryLabel: "gpt-5",
        usage: {
          totalTokens: 10000,
          inputTokens: 4000,
          cachedInputTokens: 1000,
          outputTokens: 4500,
          reasoningOutputTokens: 500,
          activeTimeMs: 1800000,
          wallTimeMs: 3600000,
          invocationCount: 50,
          reportedInvocationCount: 50,
          estimatedInvocationCount: 0,
          unavailableInvocationCount: 0,
          unsupportedInvocationCount: 0,
          inputCostUsd: 0,
          outputCostUsd: 0,
          cachedInputCostUsd: 0,
          totalCostUsd: 1.23,
        },
      }],
      purposes: [
        { id: "task_coding", label: "Task Coding", usage: { totalTokens: 1000, inputTokens: 600, cachedInputTokens: 100, outputTokens: 300, reasoningOutputTokens: 0, activeTimeMs: 60000, wallTimeMs: 70000, invocationCount: 5 } },
        { id: "ci_fix", label: "CI Fix", usage: { totalTokens: 2000, inputTokens: 1000, cachedInputTokens: 200, outputTokens: 700, reasoningOutputTokens: 100, activeTimeMs: 120000, wallTimeMs: 150000, invocationCount: 10 } },
        { id: "qa_review", label: "QA Review", usage: { totalTokens: 3000, inputTokens: 1500, cachedInputTokens: 300, outputTokens: 1000, reasoningOutputTokens: 200, activeTimeMs: 180000, wallTimeMs: 210000, invocationCount: 15 } },
        { id: "planning", label: "Planning", usage: { totalTokens: 4000, inputTokens: 2000, cachedInputTokens: 400, outputTokens: 1300, reasoningOutputTokens: 300, activeTimeMs: 240000, wallTimeMs: 260000, invocationCount: 20 } },
      ],
      chartSeries: [],
      usage: { totalTokens: 10000, inputTokens: 5000, cachedInputTokens: 0, outputTokens: 5000, reasoningOutputTokens: 0, wallTimeMs: 3600000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 1.23 },
      git: { totals: { filesChanged: 3, mergeConflictCount: 1 } },
      statusCounts: { completed: 50, failed: 0, cancelled: 0, running: 0, paused: 0 },
    },
    loading: false,
    error: null,
    usage: { wallTimeMs: 3600000, totalTokens: 10000, activeTimeMs: 1800000, invocationCount: 50, reportedInvocationCount: 50, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
    activeQuery: { window: "7d" },
    providerSegments: [{ label: "Codex", value: 10000, color: "#D99A12", textClassName: "text-amber-600" }],
    tokenSegments: [
      { label: "Input", value: 5000, color: "#00E0A0", textClassName: "text-signal-600" },
      { label: "Output", value: 5000, color: "#FFB800", textClassName: "text-amber-600" },
    ],
    sourceSegments: [],
    chartState: { zoomRange: null, setZoomRange: () => {}, hoveredIndex: null, setHoveredIndex: () => {}, enabledSeries: {} },
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
    expect(screen.getAllByText("Provider Share").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Token Anatomy").length).toBeGreaterThan(0);
    expect(screen.getByText("Purpose Activity")).not.toBeNull();
    expect(screen.getByText("Token Flight")).not.toBeNull();
    expect(screen.getByText("Purpose Lanes")).not.toBeNull();
    expect(screen.getByText("Cached Input")).not.toBeNull();
    expect(screen.getByText("Dominant")).not.toBeNull();
    expect(screen.getByText("Merge Conflicts")).not.toBeNull();
  });
});
