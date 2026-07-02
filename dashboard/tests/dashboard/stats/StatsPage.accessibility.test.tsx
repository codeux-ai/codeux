/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsPage } from "../../../src/v2/pages/stats/StatsPage.js";
import { StatsPageHero } from "../../../src/v2/pages/stats/components/StatsPageHero.js";
import { InteractiveUsageChart } from "../../../src/v2/pages/stats/components/InteractiveUsageChart.js";
import { isValidCustomRange } from "../../../src/v2/pages/stats/stats-utils.js";
import { useUsageChartState } from "../../../src/v2/pages/stats/use-usage-chart-state.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn().mockReturnValue({ to: vi.fn(), fromTo: vi.fn(), kill: vi.fn() }),
    matchMedia: vi.fn().mockReturnValue({
      add: vi.fn().mockImplementation((_query, callback) => {
        callback();
      }),
      revert: vi.fn(),
    }),
    getProperty: vi.fn(() => 1),
    context: vi.fn().mockImplementation((callback) => {
      callback();
      return { revert: vi.fn() };
    }),
  },
}));

vi.mock("../../../src/v2/context/project-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/v2/context/project-data.js")>();
  return {
    ...actual,
    useProjectData: () => ({
      selectedProject: { id: "project-1", name: "Project Atlas" },
    }),
  };
});

vi.mock("../../../src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: () => ({
    stats: null,
    loading: true,
    error: null,
    refresh: vi.fn(),
    usage: null,
    tokenSeries: [],
    activeTimeSeries: [],
    wallTimeSeries: [],
    planningUsage: null,
    activeQuery: { window: "7d" },
    customFrom: "",
    setCustomFrom: vi.fn(),
    customTo: "",
    setCustomTo: vi.fn(),
    applyCustomWindow: vi.fn(),
    visualMode: "trend",
    setVisualMode: vi.fn(),
    chartState: {},
    providerSegments: [],
    sourceSegments: [],
    tokenSegments: [],
    applyPresetWindow: vi.fn(),
    applyCustomRange: vi.fn(),
    completionConfidence: "No telemetry",
  }),
}));

const chartStats = {
  projectId: "project-1",
  projectName: "Project Atlas",
  window: "7d",
  query: { window: "7d" },
  range: {
    label: "7d",
    resolution: "day",
    resolutionLabel: "daily",
    from: "2026-06-25T00:00:00.000Z",
    to: "2026-07-01T23:59:59.999Z",
    bucketCount: 3,
    isCustom: false,
  },
  generatedAt: "2026-07-02T09:00:00.000Z",
  usage: {
    invocationCount: 12,
    activeTimeMs: 810000,
    wallTimeMs: 1110000,
    inputTokens: 2400,
    cachedInputTokens: 300,
    outputTokens: 900,
    reasoningOutputTokens: 120,
    totalTokens: 3720,
    reportedInvocationCount: 8,
    estimatedInvocationCount: 3,
    unavailableInvocationCount: 1,
    unsupportedInvocationCount: 0,
    inputCostUsd: 4.2,
    outputCostUsd: 6.4,
    cachedInputCostUsd: 0.4,
    totalCostUsd: 11.0,
  },
  git: {
    totals: {
      insertions: 140,
      deletions: 35,
      filesChanged: 9,
      prCount: 4,
      mergedCount: 2,
      mergeConflictCount: 1,
    },
  },
  activeSprint: {
    sprintId: "sprint-1",
    sprintName: "Sprint 12",
    sprintNumber: 12,
  },
  buckets: [
    {
      bucketStart: "2026-06-29T00:00:00.000Z",
      bucketEnd: "2026-06-29T23:59:59.999Z",
      label: "Jun 29",
      usage: {
        invocationCount: 4,
        activeTimeMs: 240000,
        wallTimeMs: 360000,
        inputTokens: 700,
        cachedInputTokens: 100,
        outputTokens: 280,
        reasoningOutputTokens: 30,
        totalTokens: 1110,
        totalCostUsd: 3.4,
      },
    },
    {
      bucketStart: "2026-06-30T00:00:00.000Z",
      bucketEnd: "2026-06-30T23:59:59.999Z",
      label: "Jun 30",
      usage: {
        invocationCount: 3,
        activeTimeMs: 180000,
        wallTimeMs: 240000,
        inputTokens: 850,
        cachedInputTokens: 100,
        outputTokens: 340,
        reasoningOutputTokens: 45,
        totalTokens: 1335,
        totalCostUsd: 4.1,
      },
    },
    {
      bucketStart: "2026-07-01T00:00:00.000Z",
      bucketEnd: "2026-07-01T23:59:59.999Z",
      label: "Jul 1",
      usage: {
        invocationCount: 5,
        activeTimeMs: 390000,
        wallTimeMs: 510000,
        inputTokens: 850,
        cachedInputTokens: 100,
        outputTokens: 280,
        reasoningOutputTokens: 45,
        totalTokens: 1275,
        totalCostUsd: 3.5,
      },
    },
  ],
  sprints: [],
  tasks: [],
  providers: [
    { id: "provider-1", label: "Provider One", usage: { totalTokens: 2200 } },
    { id: "provider-2", label: "Provider Two", usage: { totalTokens: 1520 } },
  ],
  purposes: [],
  models: [
    {
      id: "model-1",
      label: "Gemini 2.0 Flash",
      usage: {
        invocationCount: 6,
        activeTimeMs: 420000,
        wallTimeMs: 550000,
        inputTokens: 1600,
        cachedInputTokens: 220,
        outputTokens: 520,
        reasoningOutputTokens: 80,
        totalTokens: 2400,
      },
      duration: {
        sampleCount: 6,
        p50Ms: 62000,
        p95Ms: 91000,
        avgMs: 68000,
        minMs: 42000,
        maxMs: 110000,
      },
      successRate: 0.83,
    },
  ],
  statusCounts: {
    completed: 8,
    failed: 2,
    cancelled: 1,
    running: 1,
    paused: 0,
  },
  duration: {
    sampleCount: 11,
    p50Ms: 64000,
    p95Ms: 98000,
    avgMs: 71000,
    minMs: 40000,
    maxMs: 115000,
  },
  tokenSources: [
    { source: "reported", count: 8 },
    { source: "estimated", count: 3 },
    { source: "unavailable", count: 1 },
    { source: "unsupported", count: 0 },
  ],
  chartSeries: [
    {
      id: "tokens",
      label: "Tokens",
      grouping: "core",
      defaultEnabled: true,
      data: [1110, 1335, 1275],
      color: "#00E0A0",
      signalLabel: "Throughput",
      formatter: "tokens",
    },
    {
      id: "active",
      label: "Active Time",
      grouping: "core",
      defaultEnabled: true,
      data: [240000, 180000, 390000],
      color: "#FFB800",
      signalLabel: "Latency",
      formatter: "duration",
    },
    {
      id: "invocations",
      label: "Invocations",
      grouping: "core",
      defaultEnabled: true,
      data: [4, 3, 5],
      color: "#0EA5E9",
      signalLabel: "Volume",
      formatter: "number",
    },
  ],
} as const;

function createChartState() {
  return useUsageChartState("project-1", chartStats as any);
}

beforeAll(() => {
  if (typeof window.SVGPathElement !== "undefined") {
    Object.defineProperty(window.SVGPathElement.prototype, "getTotalLength", {
      value: () => 100,
    });
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("StatsPage accessibility", () => {
  it("announces the loading state from the page shell", () => {
    render(<StatsPage />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading telemetry field");
    expect(status).toHaveTextContent("Project Atlas");
  });

  it("renders the hero summaries, mode navigation, and custom range validation", () => {
    render(
      <StatsPageHero
        selectedProject={{ id: "project-1", name: "Project Atlas" } as any}
        stats={chartStats as any}
        activeQuery={{ window: "custom" } as any}
        customFrom="2026-07-01"
        customTo="2026-06-30"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={vi.fn()}
        completionConfidence="Reported"
      />
    );

    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("Total cost")).toBeInTheDocument();
    expect(screen.getByText("Active time")).toBeInTheDocument();
    expect(screen.getByText("Success rate")).toBeInTheDocument();
    expect(screen.getByText("Active models / providers")).toBeInTheDocument();
    expect(screen.getByText("Telemetry confidence")).toBeInTheDocument();

    const modeGroup = screen.getByRole("group", { name: "Analytics modes" });
    expect(modeGroup).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Composition" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Providers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ledgers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();

    expect(screen.getByRole("group", { name: "Time window presets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("End date must be after start date.");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    expect(isValidCustomRange("2026-06-30", "2026-07-01")).toBe(true);
    expect(isValidCustomRange("2026-07-01", "2026-06-30")).toBe(false);
  });

  it("exposes the usage chart, live summary, and filter switches", () => {
    function ChartHarness() {
      const chartState = createChartState();
      return (
        <InteractiveUsageChart
          stats={chartStats as any}
          loading={false}
          error={null}
          refresh={async () => {}}
          chartState={chartState}
        />
      );
    }

    render(<ChartHarness />);

    expect(screen.getByText("Usage Graph")).toBeInTheDocument();
    expect(screen.getByText("Data Visualization for 7d")).toBeInTheDocument();
    expect(screen.getByText(/Currently showing 3 buckets/i)).toBeInTheDocument();
    expect(screen.getByText(/Peak Tokens:/i)).toBeInTheDocument();

    const slider = screen.getByRole("slider", { name: /Explore chart data across time/i });
    expect(slider).toHaveAttribute("aria-describedby", "usage-chart-tooltip");

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    const tokenSwitch = screen.getAllByRole("switch").find((button) => button.getAttribute("aria-label") === "Tokens, enabled") as HTMLElement | undefined;
    const activeSwitch = screen.getAllByRole("switch").find((button) => button.getAttribute("aria-label") === "Active Time, enabled") as HTMLElement | undefined;
    const invocationSwitch = screen.getAllByRole("switch").find((button) => button.getAttribute("aria-label") === "Invocations, enabled") as HTMLElement | undefined;

    expect(tokenSwitch).toBeDefined();
    expect(activeSwitch).toBeDefined();
    expect(invocationSwitch).toBeDefined();
    expect(tokenSwitch!).toHaveAttribute("aria-checked", "true");
    expect(activeSwitch!).toHaveAttribute("aria-checked", "true");
    expect(invocationSwitch!).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Live values");

    const srTable = document.querySelector("table.sr-only");
    expect(srTable).toBeInTheDocument();
    expect(srTable).toHaveTextContent("Jun 30");
    expect(srTable).toHaveTextContent("1.3k");
  });
});
