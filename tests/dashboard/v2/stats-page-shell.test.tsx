/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";

// Mock the context
vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "proj-1", name: "Test Project" },
  }),
}));

// Mock the hook
vi.mock("../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: () => ({
    stats: {
      generatedAt: "2023-01-01T00:00:00Z",
      activeSprint: { sprintNumber: 5 },
      range: { resolutionLabel: "7 days", label: "7 days", periodStart: "2023", periodEnd: "2023" },
      buckets: [{ id: "b1", activeTimeMs: 1, periodStart: "2023", periodEnd: "2023", usage: { invocationCount: 1, activeTimeMs: 1, reportedInvocationCount: 1, totalTokens: 1, inputTokens: 1, outputTokens: 1, cachedInputTokens: 1, reasoningOutputTokens: 1, wallTimeMs: 1, unparseableInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, executionCount: 1, successCount: 1, failureCount: 1 } }],
      sources: [],
      purposes: [],
      providers: [],
      agents: [],
      tasks: [{ kind: "task", usage: { invocationCount: 1, totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 } }],
      sprints: [{ kind: "sprint", usage: { invocationCount: 1, totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 } }],
    },
    loading: false,
    error: null,
    usage: {
      totalTokens: 1000,
      reportedInvocationCount: 10,
      estimatedInvocationCount: 2,
      activeTimeMs: 5000,
      invocationCount: 12,
      wallTimeMs: 60000,
      unavailableInvocationCount: 0,
      unsupportedInvocationCount: 0,
    },
    tokenSeries: [],
    activeTimeSeries: [],
    wallTimeSeries: [],
    planningUsage: { usage: { totalTokens: 100, activeTimeMs: 1000, invocationCount: 1 } },
    activeQuery: { window: "7d" },
    customFrom: "2023-01-01",
    customTo: "2023-01-07",
    setCustomFrom: vi.fn(),
    setCustomTo: vi.fn(),
    visualMode: "trend",
    setVisualMode: vi.fn(),
    providerSegments: [],
    sourceSegments: [],
    tokenSegments: [],
    applyPresetWindow: vi.fn(),
    applyCustomRange: vi.fn(),
    completionConfidence: "High",
  }),
}));

expect.extend(matchers);

beforeEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    window.SVGElement.prototype.getTotalLength = () => 100;
  }
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
});
