/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { useStatsPageData } from "../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";

// Mock the context
vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "proj-1", name: "Test Project" },
  }),
}));

const baseStats = {
  generatedAt: "2023-01-01T00:00:00Z",
  activeSprint: { sprintNumber: 5, sprintId: "s1", sprintName: "S1" },
  range: { resolutionLabel: "7 days", label: "7 days", periodStart: "2023", periodEnd: "2023", from: "2023", to: "2023", bucketCount: 1, isCustom: false, window: "7d", resolution: "day" },
  buckets: [{ bucketStart: "2023-01-01", bucketEnd: "2023-01-01", label: "B1", usage: { invocationCount: 1, activeTimeMs: 1, reportedInvocationCount: 1, totalTokens: 1, inputTokens: 1, outputTokens: 1, cachedInputTokens: 1, reasoningOutputTokens: 1, wallTimeMs: 1, unparseableInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, executionCount: 1, successCount: 1, failureCount: 1 } }],
  sources: [],
  purposes: [],
  providers: [],
  tokenSources: [],
  usage: { totalTokens: 1000, activeTimeMs: 5000, invocationCount: 12, reportedInvocationCount: 10, estimatedInvocationCount: 2, wallTimeMs: 60000, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputTokens: 500, outputTokens: 500, cachedInputTokens: 0, reasoningOutputTokens: 0 },
  agents: [],
  tasks: [{ id: "t1", label: "T1", usage: { invocationCount: 1, totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, activeTimeMs: 0, wallTimeMs: 0, reportedInvocationCount: 0, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 }, lastActivityAt: "2023" }],
  sprints: [{ id: "s1", label: "S1", usage: { invocationCount: 1, totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, activeTimeMs: 0, wallTimeMs: 0, reportedInvocationCount: 0, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 }, lastActivityAt: "2023" }],
};

const baseMockValue = {
  stats: baseStats,
  loading: false,
  error: null,
  usage: baseStats.usage,
  tokenSeries: [0, 10, 5],
  activeTimeSeries: [0, 10, 5],
  wallTimeSeries: [0, 10, 5],
  planningUsage: { usage: { totalTokens: 100, activeTimeMs: 1000, invocationCount: 1 } },
  activeQuery: { window: "7d" },
  customFrom: "2023-01-01",
  customTo: "2023-01-07",
  setCustomFrom: vi.fn(),
  setCustomTo: vi.fn(),
  visualMode: "trend",
  setVisualMode: vi.fn(),
  providerSegments: [{ label: "P1", value: 100, color: "red", textClassName: "t1" }],
  sourceSegments: [{ label: "S1", value: 100, color: "blue", textClassName: "t2" }],
  tokenSegments: [{ label: "T1", value: 100, color: "green", textClassName: "t3" }],
  applyPresetWindow: vi.fn(),
  applyCustomRange: vi.fn(),
  completionConfidence: "High",
};

// Mock the hook
vi.mock("../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: vi.fn(),
}));

expect.extend(matchers);

beforeEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    window.SVGElement.prototype.getTotalLength = () => 100;
  }
  vi.mocked(useStatsPageData).mockReturnValue(baseMockValue as any);
});

describe("StatsPage Shell", () => {
  it("renders the hero content and range controls", () => {
    render(<StatsPage />);
    expect(screen.getByText("Statistics.")).toBeInTheDocument();
    expect(screen.getByText("Test Project")).toBeInTheDocument();
    expect(screen.getByText("Live sprint 5")).toBeInTheDocument();
    expect(screen.getByText("All time")).toBeInTheDocument();
  });

  it("renders metric cards", () => {
    render(<StatsPage />);
    expect(screen.getByText("Total Tokens")).toBeInTheDocument();
    expect(screen.getByText("Active AI Time")).toBeInTheDocument();
    expect(screen.getByText("Wall Runtime")).toBeInTheDocument();
  });

  it("renders the analysis studio section with view toggle above it", () => {
    render(<StatsPage />);
    expect(screen.getByRole("button", { name: /Trend/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Composition/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reliability/i })).toBeInTheDocument();

    // Default mode from mock is "trend"
    expect(screen.getByText("Trend analysis")).toBeInTheDocument();
  });

  it("renders telemetry ledgers", () => {
    render(<StatsPage />);
    expect(screen.getByText("Task Telemetry")).toBeInTheDocument();
    expect(screen.getByText("Sprint Telemetry")).toBeInTheDocument();
  });

  it("renders composition mode when active", () => {
    vi.mocked(useStatsPageData).mockReturnValueOnce({
      ...baseMockValue,
      visualMode: "composition",
    } as any);
    
    render(<StatsPage />);
    expect(screen.getByText("Composition analysis")).toBeInTheDocument();
    expect(screen.getByText("Provider Share")).toBeInTheDocument();
    expect(screen.getByText("Token Anatomy")).toBeInTheDocument();
  });

  it("renders reliability mode when active", () => {
    vi.mocked(useStatsPageData).mockReturnValueOnce({
      ...baseMockValue,
      visualMode: "reliability",
    } as any);
    
    render(<StatsPage />);
    expect(screen.getByText("Reliability analysis")).toBeInTheDocument();
    expect(screen.getByText("Telemetry Source Mix")).toBeInTheDocument();
    expect(screen.getByText("Confidence Board")).toBeInTheDocument();
  });

  it("allows searching in telemetry ledgers", () => {
    render(<StatsPage />);
    const searchInputs = screen.getAllByPlaceholderText(/Search/i);
    const taskSearch = searchInputs[0]!;
    
    fireEvent.input(taskSearch, { target: { value: "T1" } });
    expect(screen.getByText("T1")).toBeInTheDocument();
    
    fireEvent.input(taskSearch, { target: { value: "NonExistent" } });
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
    expect(screen.getByText("No task telemetry landed in this window yet.")).toBeInTheDocument();
  });
});
