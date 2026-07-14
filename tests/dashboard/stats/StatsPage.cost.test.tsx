/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useStatsPageData } from "../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";
import { useUsageChartState } from "../../../dashboard/src/v2/pages/stats/use-usage-chart-state.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (duration: number) => duration,
  useReducedMotion: () => false,
}));

vi.mock("../../../dashboard/src/v2/components/ui/Sparkline.js", () => ({
  Sparkline: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

vi.mock("../../../dashboard/src/v2/pages/stats/components/system/SystemStudio.js", () => ({
  SystemStudio: () => <div>System studio</div>,
}));

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    fromTo: vi.fn().mockImplementation((_element, _from, config) => config?.onComplete?.()),
    to: vi.fn().mockImplementation((_element, config) => config?.onComplete?.()),
  },
}));

type CoverageState = "complete" | "partial" | "unpriced" | "unknown" | "empty";

function coverageFor(state: CoverageState) {
  if (state === "unknown" || state === "empty") return undefined;
  if (state === "partial") {
    return {
      configuredPricingInvocationCount: 2,
      providerReportedCostInvocationCount: 1,
      unpricedInvocationCount: 1,
      providerReportedCostUsd: 0.5,
    };
  }
  if (state === "unpriced") {
    return {
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 4,
      providerReportedCostUsd: 0,
    };
  }
  return {
    configuredPricingInvocationCount: 4,
    providerReportedCostInvocationCount: 0,
    unpricedInvocationCount: 0,
    providerReportedCostUsd: 0,
  };
}

function makeUsage(state: CoverageState, totalCostUsd = state === "complete" ? 2.5 : state === "partial" ? 1.75 : state === "unknown" ? 1.25 : 0) {
  const empty = state === "empty";
  const invocationCount = empty ? 0 : 4;
  const totalTokens = empty ? 0 : 10_000;
  return {
    invocationCount,
    activeTimeMs: empty ? 0 : 240_000,
    wallTimeMs: empty ? 0 : 300_000,
    inputTokens: empty ? 0 : 5_000,
    cachedInputTokens: empty ? 0 : 1_000,
    outputTokens: empty ? 0 : 3_000,
    reasoningOutputTokens: empty ? 0 : 1_000,
    totalTokens,
    inputCostUsd: totalCostUsd * 0.35,
    cachedInputCostUsd: totalCostUsd * 0.05,
    outputCostUsd: totalCostUsd * 0.4,
    totalCostUsd,
    reportedInvocationCount: invocationCount,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
    costCoverage: coverageFor(state),
  };
}

function makeEntity(id: string, label: string, usage: ReturnType<typeof makeUsage>, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label,
    secondaryLabel: `Context for ${label}`,
    status: "completed",
    purpose: "task_coding",
    provider: "provider-a",
    usage,
    lastActivityAt: "2026-07-12T12:00:00.000Z",
    ...overrides,
  };
}

function makeSnapshot(state: CoverageState = "complete", totalCostUsd?: number) {
  const usage = makeUsage(state, totalCostUsd);
  const isEmpty = state === "empty";
  const entityUsage = isEmpty ? makeUsage("empty") : usage;
  const tasks = isEmpty ? [] : [
    makeEntity("task-1", "Implement cost mode", { ...entityUsage, totalCostUsd: usage.totalCostUsd * 0.6 }),
    makeEntity("task-2", "Verify pricing states", { ...entityUsage, totalCostUsd: usage.totalCostUsd * 0.4 }),
  ];
  const runSprints = isEmpty ? [] : [makeEntity("run-1", "Sprint run 1", entityUsage)];
  const canonicalSprints = isEmpty ? [] : [makeEntity("sprint-1", "Canonical sprint 1", entityUsage)];

  return {
    projectId: "project-cost",
    projectName: "Cost QA project",
    window: "7d",
    query: { window: "7d" },
    generatedAt: "2026-07-13T12:00:00.000Z",
    range: {
      window: "7d",
      from: "2026-07-06T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
      resolution: "day",
      resolutionLabel: "Daily",
      bucketCount: isEmpty ? 0 : 2,
      label: "Last 7 days",
      isCustom: false,
    },
    usage,
    buckets: isEmpty ? [] : [
      {
        bucketStart: "2026-07-11T00:00:00.000Z",
        bucketEnd: "2026-07-12T00:00:00.000Z",
        label: "Jul 11",
        usage: { ...usage, invocationCount: 2, totalTokens: 4_000, totalCostUsd: usage.totalCostUsd * 0.4, costCoverage: coverageFor(state) },
      },
      {
        bucketStart: "2026-07-12T00:00:00.000Z",
        bucketEnd: "2026-07-13T00:00:00.000Z",
        label: "Jul 12",
        usage: { ...usage, invocationCount: 2, totalTokens: 6_000, totalCostUsd: usage.totalCostUsd * 0.6, costCoverage: coverageFor(state) },
      },
    ],
    chartSeries: [
      { id: "core_total_cost", label: "Total cost", grouping: "Core", defaultEnabled: true, data: [usage.totalCostUsd * 0.4, usage.totalCostUsd * 0.6] },
    ],
    providers: isEmpty ? [] : [makeEntity("provider-a", "Provider A", entityUsage)],
    purposes: isEmpty ? [] : [makeEntity("task_coding", "Task Coding", entityUsage)],
    models: isEmpty ? [] : [{
      ...makeEntity("model-a", "Model A", entityUsage),
      provider: "provider-a",
      model: "model-a",
      duration: { sampleCount: 4, avgMs: 60_000, p50Ms: 55_000, p95Ms: 80_000, maxMs: 90_000 },
      statusCounts: { completed: 4, failed: 0, cancelled: 0, running: 0, paused: 0 },
      successRate: 1,
    }],
    tasks,
    sprints: runSprints,
    costAnalytics: { sprints: canonicalSprints },
    tokenSources: isEmpty ? [] : [{ source: "reported", count: 4 }],
    activeSprint: null,
    git: { totals: { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0, mergeConflictCount: 0 }, buckets: [], tasks: [], sprints: [] },
    mergeConflictCount: 0,
    statusCounts: { completed: isEmpty ? 0 : 4, failed: 0, cancelled: 0, running: 0, paused: 0 },
    duration: { sampleCount: isEmpty ? 0 : 4, avgMs: 60_000, p50Ms: 55_000, p95Ms: 80_000, maxMs: 90_000 },
  } as any;
}

const runtime = {
  stats: makeSnapshot(),
  loading: false,
};

function installPageDataMock(): void {
  vi.mocked(useStatsPageData).mockImplementation((projectId: string | null) => {
    const chartState = useUsageChartState(projectId, runtime.stats);
    return {
      stats: runtime.stats,
      loading: runtime.loading,
      error: null,
      refresh: vi.fn(),
      usage: runtime.stats.usage,
      tokenSeries: [],
      activeTimeSeries: [],
      wallTimeSeries: [],
      planningUsage: null,
      activeQuery: { window: "7d" },
      customFrom: "2026-07-06",
      setCustomFrom: vi.fn(),
      customTo: "2026-07-13",
      setCustomTo: vi.fn(),
      applyCustomWindow: vi.fn(),
      visualMode: chartState.visualMode,
      setVisualMode: chartState.setVisualMode,
      chartState,
      providerSegments: [],
      sourceSegments: [],
      tokenSegments: [],
      applyPresetWindow: vi.fn(),
      applyCustomRange: vi.fn(),
      completionConfidence: "Reported",
    } as any;
  });
}

beforeEach(() => {
  localStorage.clear();
  runtime.stats = makeSnapshot();
  runtime.loading = false;
  vi.mocked(useProjectData).mockReturnValue({
    selectedProject: { id: "project-cost", name: "Cost QA project" },
  } as any);
  installPageDataMock();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatsPage Cost", () => {
  it("selects Cost by click and keyboard in the mode sequence", () => {
    const first = render(<StatsPage />);
    const modeGroup = screen.getByRole("group", { name: "Analytics modes" });
    fireEvent.click(within(modeGroup).getByRole("button", { name: "Cost" }));
    expect(screen.getByRole("region", { name: "Cost metrics" })).toBeInTheDocument();
    expect(within(modeGroup).getByRole("button", { name: "Cost" })).toHaveAttribute("aria-pressed", "true");

    first.unmount();
    localStorage.clear();
    const second = render(<StatsPage />);
    const keyboardGroup = screen.getByRole("group", { name: "Analytics modes" });
    within(keyboardGroup).getByRole("button", { name: "Composition" }).focus();
    fireEvent.keyDown(keyboardGroup, { key: "ArrowRight" });
    expect(within(keyboardGroup).getByRole("button", { name: "Cost" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Cost metrics" })).toBeInTheDocument();
    second.unmount();
  });

  it("restores Cost from project-scoped storage and renders every child section", () => {
    localStorage.setItem("codeux_stats_visual_mode_project-cost", "cost");
    render(<StatsPage />);

    expect(screen.getByRole("region", { name: "Cost metrics" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cost analysis studio" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cost executive overview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cost allocation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Task and sprint spend" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spend over time" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Spend over time data" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Cost ledgers" })).toBeInTheDocument();
    expect(screen.queryByText("Canonical sprint 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Sprints/ }));
    expect(screen.getByText("Canonical sprint 1")).toBeInTheDocument();
  });

  it("preserves cached Cost content while the snapshot silently refreshes", () => {
    localStorage.setItem("codeux_stats_visual_mode_project-cost", "cost");
    const view = render(<StatsPage />);
    expect(screen.getByRole("heading", { name: "Executive overview" })).toBeInTheDocument();

    runtime.loading = true;
    view.rerender(<StatsPage />);

    expect(screen.getByRole("heading", { name: "Executive overview" })).toBeInTheDocument();
    expect(screen.getByText(/Updating analytics from cached data/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Stats analysis panel" })).toHaveAttribute("aria-busy", "true");
  });

  it.each([
    ["empty", "No usage", "Unavailable"],
    ["partial", "Partial", "$1.75+"],
    ["unpriced", "Unpriced", "Unpriced"],
    ["unknown", "Unknown", "$1.25 · coverage unknown"],
    ["complete", "Fully priced", "$0.00"],
  ] as const)("distinguishes %s pricing snapshots", (state, coverageLabel, spendValue) => {
    runtime.stats = makeSnapshot(state, state === "complete" ? 0 : undefined);
    localStorage.setItem("codeux_stats_visual_mode_project-cost", "cost");
    render(<StatsPage />);

    const deck = screen.getByTestId("top-cards-renderer");
    expect(within(deck).getAllByText(coverageLabel).length).toBeGreaterThan(0);
    expect(within(deck).getAllByText(spendValue).length).toBeGreaterThan(0);
    if (state === "unpriced") {
      expect(within(deck).queryByText("$0.00")).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(/free/i);
    }
    if (state === "complete") {
      expect(within(deck).queryAllByText("Unpriced")).toHaveLength(0);
    }
  });
});
