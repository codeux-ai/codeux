/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import gsap from "gsap";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { useReducedMotion } from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
import { useStatsPageData } from "../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    to: vi.fn().mockImplementation((_element, config) => {
      if (config?.onComplete) config.onComplete();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/components/ui/Sparkline.js", () => ({
  Sparkline: () => <div data-testid="mock-sparkline">Sparkline</div>,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (duration: number) => duration,
  useReducedMotion: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/pages/stats/components/AnalysisStudioSection.js", () => ({
  AnalysisStudioSection: ({
    stats,
    loading,
    visualMode,
    setVisualMode,
  }: {
    stats: { tasks: Array<{ label: string }>; sprints: Array<{ label: string }> };
    loading: boolean;
    visualMode: "trend" | "composition" | "models" | "reliability" | "ledgers" | "system";
    setVisualMode: (mode: "trend" | "composition" | "models" | "reliability" | "ledgers" | "system") => void;
  }) => (
    <section aria-label="Mock analysis studio">
      <div role="status" aria-live="polite">{loading ? "Refreshing" : "Ready"}</div>
      <div role="group" aria-label="Studio mode controls">
        <button type="button" onClick={() => setVisualMode("trend")} aria-pressed={visualMode === "trend"}>Trend</button>
        <button type="button" onClick={() => setVisualMode("composition")} aria-pressed={visualMode === "composition"}>Composition</button>
        <button type="button" onClick={() => setVisualMode("models")} aria-pressed={visualMode === "models"}>Models</button>
        <button type="button" onClick={() => setVisualMode("reliability")} aria-pressed={visualMode === "reliability"}>Reliability</button>
        <button type="button" onClick={() => setVisualMode("ledgers")} aria-pressed={visualMode === "ledgers"}>Ledgers</button>
        <button type="button" onClick={() => setVisualMode("system")} aria-pressed={visualMode === "system"}>System</button>
      </div>

      {visualMode === "trend" ? <div>Trend analysis</div> : null}
      {visualMode === "composition" ? (
        <div>
          <div>Composition analysis</div>
          <div>Provider Share</div>
          <div>Token Anatomy</div>
        </div>
      ) : null}
      {visualMode === "models" ? <div>Model performance matrix</div> : null}
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
          {stats.tasks.map((task) => <div key={task.label}>{task.label}</div>)}
          {stats.sprints.map((sprint) => <div key={sprint.label}>{sprint.label}</div>)}
        </div>
      ) : null}
      {visualMode === "system" ? <div>System invocation workbench</div> : null}
    </section>
  ),
}));

const projectContextMock = vi.hoisted(() => ({
  selectedProject: { id: "proj-1", name: "Telemetry Redesign" } as { id: string; name: string } | null,
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: projectContextMock.selectedProject,
  }),
}));

vi.mock("../../../dashboard/src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: vi.fn(),
}));

const usage = {
  invocationCount: 18,
  activeTimeMs: 2_700_000,
  wallTimeMs: 4_200_000,
  inputTokens: 24_000,
  cachedInputTokens: 6_000,
  outputTokens: 16_000,
  reasoningOutputTokens: 4_000,
  totalTokens: 50_000,
  reportedInvocationCount: 14,
  estimatedInvocationCount: 3,
  unavailableInvocationCount: 1,
  unsupportedInvocationCount: 0,
  inputCostUsd: 2.4,
  cachedInputCostUsd: 0.3,
  outputCostUsd: 4.2,
  totalCostUsd: 6.9,
};

const entity = (id: string, label: string, overrides: Record<string, unknown> = {}) => ({
  id,
  label,
  secondaryLabel: null,
  status: "completed",
  purpose: "task_coding",
  provider: "codex",
  usage,
  lastActivityAt: "2026-07-03T10:00:00.000Z",
  ...overrides,
});

const richStats = {
  projectId: "proj-1",
  projectName: "Telemetry Redesign",
  window: "7d",
  query: { window: "7d" },
  generatedAt: "2026-07-03T10:00:00.000Z",
  activeSprint: { sprintId: "sprint-9", sprintName: "Stats redesign", sprintNumber: 9 },
  range: {
    window: "7d",
    from: "2026-06-26T00:00:00.000Z",
    to: "2026-07-03T00:00:00.000Z",
    resolution: "day",
    label: "Last 7 days",
    bucketCount: 7,
    resolutionLabel: "Daily",
    isCustom: false,
  },
  buckets: [
    { bucketStart: "2026-06-26T00:00:00.000Z", bucketEnd: "2026-06-27T00:00:00.000Z", label: "Jun 26", usage: { ...usage, totalTokens: 12_000, invocationCount: 5 } },
    { bucketStart: "2026-06-27T00:00:00.000Z", bucketEnd: "2026-06-28T00:00:00.000Z", label: "Jun 27", usage: { ...usage, totalTokens: 18_000, invocationCount: 6 } },
    { bucketStart: "2026-06-28T00:00:00.000Z", bucketEnd: "2026-06-29T00:00:00.000Z", label: "Jun 28", usage: { ...usage, totalTokens: 20_000, invocationCount: 7 } },
  ],
  chartSeries: [
    { id: "core_total_tokens", label: "Total Tokens", grouping: "Core", defaultEnabled: true, data: [12_000, 18_000, 20_000] },
    { id: "core_active_time", label: "Active Time", grouping: "Core", defaultEnabled: true, data: [700_000, 900_000, 1_100_000] },
    { id: "provider_codex", label: "Codex", grouping: "Providers", defaultEnabled: false, data: [8_000, 13_000, 18_000] },
  ],
  usage,
  providers: [
    entity("codex", "Codex", { usage: { ...usage, totalTokens: 39_000, invocationCount: 12, totalCostUsd: 5.2 } }),
    entity("gemini", "Gemini", { provider: "gemini", usage: { ...usage, totalTokens: 11_000, invocationCount: 6, totalCostUsd: 1.7 } }),
  ],
  purposes: [
    entity("task_coding", "Task Coding", { usage: { ...usage, totalTokens: 32_000, invocationCount: 11 } }),
    entity("planning", "Planning", { purpose: "planning", usage: { ...usage, totalTokens: 18_000, invocationCount: 7 } }),
  ],
  models: [
    {
      id: "codex:gpt-5",
      provider: "codex",
      model: "gpt-5",
      label: "GPT-5",
      usage: { ...usage, totalTokens: 39_000, invocationCount: 12 },
      statusCounts: { completed: 11, failed: 1, cancelled: 0, running: 0, paused: 0 },
      successRate: 11 / 12,
      duration: { sampleCount: 12, avgMs: 30_000, p50Ms: 24_000, p95Ms: 54_000, maxMs: 60_000 },
      lastActivityAt: "2026-07-03T10:00:00.000Z",
    },
  ],
  tasks: [
    entity("task-1", "Stats shell QA", { secondaryLabel: "T11", usage: { ...usage, totalTokens: 29_000, totalCostUsd: 3.4 } }),
    entity("task-2", "Responsive command rail", { secondaryLabel: "T12", provider: "gemini", usage: { ...usage, totalTokens: 21_000, totalCostUsd: 3.5 } }),
  ],
  sprints: [
    entity("sprint-9", "Stats redesign", { usage: { ...usage, totalTokens: 50_000 } }),
  ],
  tokenSources: [{ source: "reported", count: 14 }, { source: "estimated", count: 3 }, { source: "unavailable", count: 1 }],
  statusCounts: { completed: 15, failed: 2, cancelled: 1, running: 0, paused: 0 },
  duration: { sampleCount: 18, avgMs: 30_000, p50Ms: 24_000, p95Ms: 54_000, maxMs: 60_000 },
  git: {
    tasks: [],
    sprints: [],
    buckets: [],
    totals: { insertions: 220, deletions: 80, filesChanged: 12, prCount: 4, mergedCount: 3, mergeConflictCount: 1 },
  },
  mergeConflictCount: 1,
};

const baseMockValue = {
  stats: richStats,
  loading: false,
  error: null,
  refresh: vi.fn(),
  usage,
  tokenSeries: [12_000, 18_000, 20_000],
  activeTimeSeries: [700_000, 900_000, 1_100_000],
  wallTimeSeries: [1_000_000, 1_400_000, 1_800_000],
  planningUsage: richStats.purposes[1],
  activeQuery: { window: "7d" },
  customFrom: "2026-06-26",
  customTo: "2026-07-03",
  setCustomFrom: vi.fn(),
  setCustomTo: vi.fn(),
  applyCustomWindow: vi.fn(),
  visualMode: "composition",
  setVisualMode: vi.fn(),
  chartState: {
    visualMode: "composition",
    setVisualMode: vi.fn(),
    zoomRange: null,
    setZoomRange: vi.fn(),
    hoveredIndex: null,
    setHoveredIndex: vi.fn(),
    dragStartIndex: null,
    setDragStartIndex: vi.fn(),
    dragCurrentIndex: null,
    setDragCurrentIndex: vi.fn(),
    enabledSeries: { core_total_tokens: true, core_active_time: true },
    setEnabledSeries: vi.fn(),
  },
  providerSegments: [
    { label: "Codex", value: 39_000, color: "#00E0A0", textClassName: "text-signal-600" },
    { label: "Gemini", value: 11_000, color: "#D99A12", textClassName: "text-amber-600" },
  ],
  sourceSegments: [
    { label: "reported", value: 14, color: "#00E0A0", textClassName: "text-signal-600" },
    { label: "estimated", value: 3, color: "#D99A12", textClassName: "text-amber-600" },
    { label: "unavailable", value: 1, color: "#E85D75", textClassName: "text-rose-600" },
  ],
  tokenSegments: [
    { label: "Input", value: 24_000, color: "#00E0A0", textClassName: "text-signal-600" },
    { label: "Output", value: 16_000, color: "#FFB800", textClassName: "text-amber-600" },
    { label: "Reasoning", value: 4_000, color: "#E85D75", textClassName: "text-rose-600" },
  ],
  applyPresetWindow: vi.fn(),
  applyCustomRange: vi.fn(),
  completionConfidence: "Mixed reported + fallback",
};

function mockStatsPageData(overrides: Record<string, unknown> = {}) {
  vi.mocked(useStatsPageData).mockReturnValue({
    ...baseMockValue,
    ...overrides,
    chartState: {
      ...baseMockValue.chartState,
      ...((overrides.chartState as Record<string, unknown> | undefined) ?? {}),
    },
  } as any);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  projectContextMock.selectedProject = { id: "proj-1", name: "Telemetry Redesign" };
  mockStatsPageData();
  vi.mocked(useReducedMotion).mockReturnValue(false);
});

describe("StatsPage Shell", () => {
  it("renders the hero, mode navigation, top KPI runway, and active studio with accessible names", () => {
    render(<StatsPage />);

    expect(screen.getByRole("region", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Statistics." })).toBeInTheDocument();
    expect(screen.getByLabelText("Stats project context")).toHaveTextContent("Telemetry Redesign");
    expect(screen.getByLabelText("Executive summary")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Tokens: 50\.0k\. Mixed telemetry/ })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Success rate: 83%/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Composition metrics" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Provider Share: 78%/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Analysis workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Stats workspace context" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Analytics modes" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Studio mode controls" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mock analysis studio")).toHaveTextContent("Composition analysis");

    const namedControls = screen.getAllByRole("button").filter((button) => button.getAttribute("aria-label") === "");
    expect(namedControls.length).toBe(0);
  });

  it("keeps command navigation reachable in narrow layout structure", () => {
    render(<StatsPage />);

    const commandControls = screen
      .getAllByLabelText("Stats command controls")
      .find((element) => element.className.includes("heroControls"))!;
    const presetGroup = screen.getByRole("group", { name: "Time window presets" });
    const modeGroup = screen
      .getAllByRole("group", { name: "Analytics modes" })
      .find((element) => element.className.includes("heroViewToggle"))!;

    expect(commandControls.className).toContain("heroControls");
    expect(presetGroup.className).toContain("flex-wrap");
    expect(modeGroup.className).toContain("flex-wrap");
    expect(commandControls.querySelector(".overflow-x-auto")).not.toBeInTheDocument();
    expect(commandControls.querySelector(".min-w-max")).not.toBeInTheDocument();

    for (const label of ["Trend", "Composition", "Models", "Providers", "Ledgers", "System"]) {
      expect(within(modeGroup).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("renders the no-project state without dropping command context", () => {
    projectContextMock.selectedProject = null;
    mockStatsPageData({ stats: null, loading: false, error: null, visualMode: "trend" });

    render(<StatsPage />);

    expect(screen.getByRole("region", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Statistics." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Stats workspace context")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No project selected");
    expect(screen.getByText("Project · No project selected")).toBeInTheDocument();
    expect(screen.getByText("No snapshot yet")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Time window presets" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Analytics modes" })).toBeInTheDocument();
  });

  it("renders the first-load loading state with polite status semantics", () => {
    mockStatsPageData({ stats: null, loading: true, visualMode: "trend" });

    render(<StatsPage />);

    expect(screen.getByRole("region", { name: "Statistics" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Stats panel refreshing");
    expect(screen.getByRole("status")).toHaveTextContent("Loading telemetry field");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("keeps previous stats visible while a refresh is loading", () => {
    mockStatsPageData({ loading: true, visualMode: "reliability" });

    render(<StatsPage />);

    expect(screen.queryByText(/Loading telemetry field/i)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Providers metrics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mock analysis studio")).toHaveTextContent("Reliability analysis");
    expect(screen.getAllByRole("status").some((status) => status.textContent === "Refreshing")).toBe(true);
  });

  it("renders error retry only when no previous stats are available", () => {
    const refresh = vi.fn();
    mockStatsPageData({ stats: null, error: "Stats fetch failed.", refresh });

    render(<StatsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Stats panel unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("Stats fetch failed.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("announces invalid custom date ranges and blocks Apply", () => {
    mockStatsPageData({
      activeQuery: { window: "custom", from: "2026-07-03", to: "2026-06-26" },
      customFrom: "2026-07-03",
      customTo: "2026-06-26",
    });

    render(<StatsPage />);

    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("End date must be after start date.");
    expect(screen.getByLabelText("Custom start date")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Custom end date")).toHaveAttribute("aria-errormessage", "stats-custom-range-error");
  });

  it("calls visual mode switches from the hero and renders active content for three modes", () => {
    const setVisualMode = vi.fn();
    mockStatsPageData({ visualMode: "trend", setVisualMode });
    const { rerender } = render(<StatsPage />);

    fireEvent.click(within(screen.getByRole("group", { name: "Analytics modes" })).getByRole("button", { name: "Composition" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Analytics modes" })).getByRole("button", { name: "Providers" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Analytics modes" })).getByRole("button", { name: "System" }));
    expect(setVisualMode).toHaveBeenNthCalledWith(1, "composition");
    expect(setVisualMode).toHaveBeenNthCalledWith(2, "reliability");
    expect(setVisualMode).toHaveBeenNthCalledWith(3, "system");

    expect(screen.getByRole("region", { name: "Trend metrics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mock analysis studio")).toHaveTextContent("Trend analysis");

    mockStatsPageData({ visualMode: "models", setVisualMode });
    rerender(<StatsPage />);
    expect(screen.getByRole("region", { name: "Models metrics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mock analysis studio")).toHaveTextContent("Model performance matrix");

    mockStatsPageData({ visualMode: "ledgers", setVisualMode });
    rerender(<StatsPage />);
    expect(screen.getByRole("region", { name: "Ledgers metrics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mock analysis studio")).toHaveTextContent("Task Telemetry");
  });

  it("does not animate the shell when reduced motion is enabled", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);

    render(<StatsPage />);

    expect(gsap.fromTo).not.toHaveBeenCalled();
    expect(screen.getByText("Statistics.")).toBeInTheDocument();
  });

  it("animates the shell once when reduced motion is disabled", () => {
    const { rerender } = render(<StatsPage />);

    expect(gsap.killTweensOf).toHaveBeenCalled();
    expect(gsap.fromTo).toHaveBeenCalledTimes(1);

    rerender(<StatsPage />);
    expect(gsap.fromTo).toHaveBeenCalledTimes(1);
  });
});
