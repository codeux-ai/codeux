/** @vitest-environment happy-dom */
/** @jsx h */
import { h, createContext } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsPage } from "../../../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { useStatsPageData } from "../../../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";

expect.extend(matchers);

window.SVGElement.prototype.getTotalLength = () => 100;

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn(),
    timeline: () => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      kill: vi.fn(),
    }),
    set: vi.fn(),
    getProperty: vi.fn(() => 1),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  },
}));

vi.mock("../../../../../dashboard/src/v2/context/project-data.js", () => ({
  ProjectDataContext: createContext<any>(null),
  useProjectData: () => ({
    selectedProject: { id: "proj-1", name: "Test Project" },
  }),
}));

vi.mock("../../../../../dashboard/src/v2/pages/stats/components/StatsPageHero.js", () => ({
  StatsPageHero: () => <section><h1>Stats Hero</h1></section>,
}));

vi.mock("../../../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: vi.fn(),
}));

const baseStats = {
  generatedAt: "2026-04-20T00:00:00Z",
  activeSprint: { sprintNumber: 3, sprintId: "s3", sprintName: "Sprint 3" },
  range: { from: "2026-04-20", to: "2026-04-27", resolution: "day", label: "Last 7 Days", bucketCount: 2, resolutionLabel: "daily" },
  usage: { totalTokens: 1200, activeTimeMs: 8000, invocationCount: 12, reportedInvocationCount: 10, estimatedInvocationCount: 2, wallTimeMs: 16000, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputTokens: 600, outputTokens: 600, cachedInputTokens: 0, reasoningOutputTokens: 0 },
  buckets: [
    { bucketStart: "2026-04-20T00:00:00Z", bucketEnd: "2026-04-20T23:59:59Z", label: "Apr 20", usage: { totalTokens: 500, activeTimeMs: 3000, invocationCount: 5 } },
    { bucketStart: "2026-04-21T00:00:00Z", bucketEnd: "2026-04-21T23:59:59Z", label: "Apr 21", usage: { totalTokens: 700, activeTimeMs: 5000, invocationCount: 7 } },
  ],
  chartSeries: [
    { id: "tokens", label: "Tokens", grouping: "Usage", color: "#00E0A0", formatter: "tokens", signalLabel: "Throughput", defaultEnabled: true, data: [500, 700] },
    { id: "active", label: "Active Time", grouping: "Usage", color: "#FFB800", formatter: "duration", signalLabel: "Latency", defaultEnabled: true, data: [3000, 5000] },
  ],
  purposes: [
    { id: "p1", label: "task_coding", usage: { totalTokens: 800, activeTimeMs: 6000, inputTokens: 450, outputTokens: 350 } },
    { id: "p2", label: "planning", usage: { totalTokens: 400, activeTimeMs: 2000, inputTokens: 200, outputTokens: 200 } },
  ],
  providers: [],
  tokenSources: [],
  sources: [],
  agents: [],
  tasks: [],
  sprints: [],
};

const baseMockValue = {
  stats: baseStats as any,
  loading: false,
  error: null,
  usage: baseStats.usage,
  tokenSeries: [500, 700],
  activeTimeSeries: [3000, 5000],
  wallTimeSeries: [6000, 10000],
  planningUsage: null,
  activeQuery: { window: "7d" },
  customFrom: "2026-04-20",
  customTo: "2026-04-27",
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
  providerSegments: [],
  sourceSegments: [],
  tokenSegments: [],
  applyPresetWindow: vi.fn(),
  applyCustomRange: vi.fn(),
  completionConfidence: "High",
};

beforeEach(() => {
  cleanup();
  vi.mocked(useStatsPageData).mockReturnValue(baseMockValue as any);
});

describe("StatsPage integrated telemetry view", () => {
  it("renders standalone purpose cards and no execution-lane wrapper title", () => {
    render(<StatsPage />);
    expect(screen.getByText("Execution Purposes")).toBeInTheDocument();
    expect(screen.getByText("task coding")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.queryByText("Execution Lanes")).not.toBeInTheDocument();
  });

  it("opens filter submenu from usage graph controls", () => {
    render(<StatsPage />);
    expect(screen.queryByText("Graph Filters")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByText("Graph Filters")).toBeInTheDocument();
    expect(screen.getByText("Metric Series")).toBeInTheDocument();
  });

  it("renders empty graph state in integrated trend view when no buckets are present", () => {
    vi.mocked(useStatsPageData).mockReturnValueOnce({
      ...baseMockValue,
      stats: {
        ...baseStats,
        buckets: [],
        chartSeries: [
          { id: "tokens", label: "Tokens", grouping: "Usage", color: "#00E0A0", formatter: "tokens", signalLabel: "Throughput", defaultEnabled: true, data: [] },
        ],
      },
    } as any);

    render(<StatsPage />);
    expect(screen.getByText("No Activity Detected")).toBeInTheDocument();
  });
});
