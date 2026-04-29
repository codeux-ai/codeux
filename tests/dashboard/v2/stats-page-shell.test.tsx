/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { useStatsPageData } from "../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/pages/stats/components/StatsPageHero.js", () => ({
  StatsPageHero: ({
    selectedProject,
    stats,
    applyPresetWindow,
  }: {
    selectedProject: { name: string } | null;
    stats: { activeSprint?: { sprintNumber?: number } } | null;
    applyPresetWindow: (window: string) => void;
  }) => (
    <section>
      <h1>Statistics.</h1>
      <div>{selectedProject?.name}</div>
      <div>{stats?.activeSprint?.sprintNumber ? `Live sprint ${stats.activeSprint.sprintNumber}` : "No live sprint"}</div>
      <button type="button" onClick={() => applyPresetWindow("all")}>All time</button>
    </section>
  ),
}));

vi.mock("../../../dashboard/src/v2/pages/stats/components/StatsShared.js", () => ({
  SignalMetricCard: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("../../../dashboard/src/v2/pages/stats/components/AnalysisStudioSection.js", () => ({
  AnalysisStudioSection: ({
    stats,
    visualMode,
    setVisualMode,
  }: {
    stats: { tasks: Array<{ label: string }>; sprints: Array<{ label: string }> };
    visualMode: "trend" | "composition" | "reliability" | "ledgers";
    setVisualMode: (mode: "trend" | "composition" | "reliability" | "ledgers") => void;
  }) => {
    const [taskSearch, setTaskSearch] = useState("");
    const filteredTasks = stats.tasks.filter((task) => task.label.toLowerCase().includes(taskSearch.toLowerCase()));

    return (
      <section>
        <button type="button" onClick={() => setVisualMode("trend")}>Trend</button>
        <button type="button" onClick={() => setVisualMode("composition")}>Composition</button>
        <button type="button" onClick={() => setVisualMode("reliability")}>Reliability</button>
        <button type="button" onClick={() => setVisualMode("ledgers")}>Ledgers</button>

        {visualMode === "trend" ? <div>Trend analysis</div> : null}
        {visualMode === "composition" ? (
          <div>
            <div>Composition analysis</div>
            <div>Provider Share</div>
            <div>Token Anatomy</div>
          </div>
        ) : null}
        {visualMode === "reliability" ? (
          <div>
            <div>Reliability analysis</div>
            <div>Telemetry Source Mix</div>
            <div>Confidence Board</div>
          </div>
        ) : null}
        {visualMode === "ledgers" ? (
          <div>
            <div>Task Telemetry</div>
            <div>Sprint Telemetry</div>
            <input
              placeholder="Search"
              value={taskSearch}
              onInput={(event) => setTaskSearch((event.currentTarget as HTMLInputElement).value)}
            />
            {filteredTasks.length > 0
              ? filteredTasks.map((task) => <div key={task.label}>{task.label}</div>)
              : <div>No task telemetry landed in this window yet.</div>}
            {stats.sprints.map((sprint) => <div key={sprint.label}>{sprint.label}</div>)}
          </div>
        ) : null}
      </section>
    );
  },
}));

// Mock the context
vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "proj-1", name: "Test Project" },
  }),
}));

const baseStats = {
  generatedAt: "2023-01-01T00:00:00Z",
  activeSprint: { sprintNumber: 5, sprintId: "s1", sprintName: "S1" },
  range: {
        from: "2023-01-01T00:00:00Z",
        to: "2023-01-07T23:59:59Z",
        resolution: "day",
        label: "Last 7 Days",
        bucketCount: 7,
        resolutionLabel: "daily",
      },
      chartSeries: [{ id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [10] }],
  buckets: [{ bucketStart: "2023-01-01", bucketEnd: "2023-01-01", label: "B1", usage: { invocationCount: 1, activeTimeMs: 1, reportedInvocationCount: 1, totalTokens: 1, inputTokens: 1, outputTokens: 1, cachedInputTokens: 1, reasoningOutputTokens: 1, wallTimeMs: 1, unparseableInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, executionCount: 1, successCount: 1, failureCount: 1 } }],
  sources: [],
  purposes: [
    { id: "p1", label: "task_coding", usage: { invocationCount: 1, totalTokens: 200, inputTokens: 120, outputTokens: 80, cachedInputTokens: 0, reasoningOutputTokens: 0, activeTimeMs: 4000, wallTimeMs: 5000, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 }, lastActivityAt: "2023" },
    { id: "p2", label: "planning", usage: { invocationCount: 1, totalTokens: 120, inputTokens: 70, outputTokens: 50, cachedInputTokens: 0, reasoningOutputTokens: 0, activeTimeMs: 2500, wallTimeMs: 3100, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 }, lastActivityAt: "2023" },
  ],
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
  chartState: {
    visualMode: "trend",
    setVisualMode: vi.fn(),
    zoomRange: null,
    setZoomRange: vi.fn(),
    hoveredIndex: null,
    setHoveredIndex: vi.fn(),
    dragStartIndex: null,
    setDragStartIndex: vi.fn(),
    dragCurrentIndex: null,
    setDragCurrentIndex: vi.fn(),
    enabledSeries: { tokens: true, active: true },
    setEnabledSeries: vi.fn(),
  },
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

  it("renders standalone execution purpose cards in trend mode", () => {
    render(<StatsPage />);
    expect(screen.getByText("Execution Purposes")).toBeInTheDocument();
    expect(screen.getByText("task coding")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
  });

  it("renders the analysis studio section with view toggle above it", () => {
    render(<StatsPage />);
    expect(screen.getByRole("button", { name: /Trend/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Composition/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reliability/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ledgers/i })).toBeInTheDocument();

    // Default mode from mock is "trend"
    expect(screen.getByText("Trend analysis")).toBeInTheDocument();
  });

  it("renders ledgers mode when active", () => {
    vi.mocked(useStatsPageData).mockReturnValueOnce({
      ...baseMockValue,
      visualMode: "ledgers",
      chartState: {
        ...baseMockValue.chartState,
        visualMode: "ledgers",
      },
    } as any);

    render(<StatsPage />);
    expect(screen.getAllByText("Task Telemetry")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Sprint Telemetry")[0]).toBeInTheDocument();
  });

  it("renders composition mode when active", () => {
    vi.mocked(useStatsPageData).mockReturnValueOnce({
      ...baseMockValue,
      visualMode: "composition",
      chartState: {
        ...baseMockValue.chartState,
        visualMode: "composition",
      },
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
      chartState: {
        ...baseMockValue.chartState,
        visualMode: "reliability",
      },
    } as any);
    
    render(<StatsPage />);
    expect(screen.getByText("Reliability analysis")).toBeInTheDocument();
    expect(screen.getByText("Telemetry Source Mix")).toBeInTheDocument();
    expect(screen.getByText("Confidence Board")).toBeInTheDocument();
  });

  it("allows searching in telemetry ledgers", () => {
    vi.mocked(useStatsPageData).mockReturnValueOnce({
      ...baseMockValue,
      visualMode: "ledgers",
      chartState: {
        ...baseMockValue.chartState,
        visualMode: "ledgers",
      },
    } as any);
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
