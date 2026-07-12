/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { StatsPage } from "../../../dashboard/src/v2/pages/stats/StatsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useStatsPageData } from "../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";

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

vi.mock("../../../dashboard/src/v2/pages/stats/components/system/SystemStudio.js", () => ({
  SystemStudio: ({ projectId }: { projectId: string }) => (
    <section aria-label="System workbench">
      <h3>System Workbench</h3>
      <div>{projectId}</div>
    </section>
  ),
}));

vi.mock("../../../dashboard/src/v2/components/ui/Sparkline.js", () => ({
  Sparkline: () => <div data-testid="mock-sparkline">Sparkline</div>,
}));

vi.mock("gsap", () => ({
  default: {
    registerPlugin: vi.fn(),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => ({
      fromTo: vi.fn().mockReturnThis(),
      to: vi.fn().mockReturnThis(),
      kill: vi.fn(),
    })),
    context: vi.fn(() => ({ revert: vi.fn() })),
    to: vi.fn().mockImplementation((_element, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    fromTo: vi.fn().mockImplementation((_element, _from, config) => {
      if (config?.onComplete) config.onComplete();
    }),
  },
}));

const usage = {
  totalTokens: 80_000,
  inputTokens: 36_000,
  cachedInputTokens: 12_000,
  outputTokens: 26_000,
  reasoningOutputTokens: 6_000,
  activeTimeMs: 3_600_000,
  wallTimeMs: 5_400_000,
  invocationCount: 40,
  reportedInvocationCount: 34,
  estimatedInvocationCount: 4,
  unavailableInvocationCount: 2,
  unsupportedInvocationCount: 0,
  inputCostUsd: 3.2,
  cachedInputCostUsd: 0.4,
  outputCostUsd: 5.6,
  totalCostUsd: 9.2,
};

const entity = (id: string, label: string, overrides: Record<string, unknown> = {}) => ({
  id,
  label,
  secondaryLabel: null,
  status: "completed",
  purpose: "task_coding",
  provider: id,
  usage,
  lastActivityAt: "2026-07-03T12:00:00.000Z",
  ...overrides,
});

const stats = {
  projectId: "project-1",
  projectName: "Composition QA",
  window: "7d",
  query: { window: "7d" },
  range: {
    window: "7d",
    resolution: "day",
    resolutionLabel: "Daily",
    from: "2026-06-26T00:00:00.000Z",
    to: "2026-07-03T00:00:00.000Z",
    label: "Last 7 days",
    bucketCount: 7,
    isCustom: false,
  },
  generatedAt: "2026-07-03T12:00:00.000Z",
  activeSprint: { sprintId: "sprint-4", sprintName: "Composition QA", sprintNumber: 4 },
  usage,
  buckets: [
    { label: "Day 1", usage: { ...usage, totalTokens: 20_000, invocationCount: 10 } },
    { label: "Day 2", usage: { ...usage, totalTokens: 30_000, invocationCount: 14 } },
    { label: "Day 3", usage: { ...usage, totalTokens: 30_000, invocationCount: 16 } },
  ],
  chartSeries: [
    { id: "core_total_tokens", label: "Total Tokens", grouping: "Core", defaultEnabled: true, data: [20_000, 30_000, 30_000] },
    { id: "provider_codex", label: "Codex", grouping: "Providers", defaultEnabled: false, data: [14_000, 22_000, 24_000] },
    { id: "purpose_invocations_task_coding", label: "Task Coding", grouping: "Purposes", defaultEnabled: false, data: [6, 8, 11] },
  ],
  providers: [
    entity("codex", "Codex", {
      secondaryLabel: "GPT-5",
      usage: { ...usage, totalTokens: 60_000, invocationCount: 25, totalCostUsd: 7.1 },
    }),
    entity("gemini", "Gemini", {
      secondaryLabel: "Gemini 2.5",
      provider: "gemini",
      usage: { ...usage, totalTokens: 20_000, invocationCount: 15, totalCostUsd: 2.1 },
    }),
  ],
  purposes: [
    entity("task_coding", "Task Coding", { usage: { ...usage, totalTokens: 50_000, invocationCount: 24 } }),
    entity("qa_review", "QA Review", { purpose: "qa_review", usage: { ...usage, totalTokens: 20_000, invocationCount: 10 } }),
    entity("planning", "Planning", { purpose: "planning", usage: { ...usage, totalTokens: 10_000, invocationCount: 6 } }),
  ],
  models: [
    {
      id: "codex:gpt-5",
      provider: "codex",
      model: "gpt-5",
      label: "GPT-5",
      usage: { ...usage, totalTokens: 60_000, invocationCount: 25 },
      statusCounts: { completed: 23, failed: 2, cancelled: 0, running: 0, paused: 0 },
      successRate: 23 / 25,
      duration: { sampleCount: 25, avgMs: 42_000, p50Ms: 31_000, p95Ms: 80_000, maxMs: 120_000 },
      lastActivityAt: "2026-07-03T12:00:00.000Z",
    },
  ],
  tasks: [entity("task-1", "Composition polish")],
  sprints: [entity("sprint-4", "Composition QA")],
  tokenSources: [{ source: "reported", count: 34 }, { source: "estimated", count: 4 }, { source: "unavailable", count: 2 }],
  git: { totals: { filesChanged: 9, insertions: 180, deletions: 55, prCount: 3, mergedCount: 2, mergeConflictCount: 1 }, tasks: [], sprints: [], buckets: [] },
  statusCounts: { completed: 35, failed: 3, cancelled: 2, running: 0, paused: 0 },
  duration: { sampleCount: 40, avgMs: 42_000, p50Ms: 31_000, p95Ms: 80_000, maxMs: 120_000 },
} as any;

const baseMockData = {
  stats,
  loading: false,
  error: null,
  refresh: vi.fn(),
  usage,
  tokenSeries: [20_000, 30_000, 30_000],
  activeTimeSeries: [900_000, 1_300_000, 1_400_000],
  wallTimeSeries: [1_400_000, 1_900_000, 2_100_000],
  planningUsage: stats.purposes[2],
  activeQuery: { window: "7d" },
  customFrom: "2026-06-26",
  setCustomFrom: vi.fn(),
  customTo: "2026-07-03",
  setCustomTo: vi.fn(),
  applyCustomWindow: vi.fn(),
  visualMode: "composition",
  setVisualMode: vi.fn(),
  chartState: { zoomRange: null, setZoomRange: vi.fn(), hoveredIndex: null, setHoveredIndex: vi.fn(), enabledSeries: {} },
  providerSegments: [
    { label: "Codex", value: 60_000, color: "#00E0A0", textClassName: "text-signal-600" },
    { label: "Gemini", value: 20_000, color: "#D99A12", textClassName: "text-amber-600" },
  ],
  tokenSegments: [
    { label: "Input", value: 36_000, color: "#00E0A0", textClassName: "text-signal-600" },
    { label: "Cached input", value: 12_000, color: "#20B2AA", textClassName: "text-cyan-600" },
    { label: "Output", value: 26_000, color: "#FFB800", textClassName: "text-amber-600" },
    { label: "Reasoning", value: 6_000, color: "#E85D75", textClassName: "text-rose-600" },
  ],
  sourceSegments: [
    { label: "reported", value: 34, color: "#00E0A0", textClassName: "text-signal-600" },
    { label: "estimated", value: 4, color: "#D99A12", textClassName: "text-amber-600" },
    { label: "unavailable", value: 2, color: "#E85D75", textClassName: "text-rose-600" },
  ],
  applyPresetWindow: vi.fn(),
  applyCustomRange: vi.fn(),
  completionConfidence: "Mixed reported + fallback",
};

beforeEach(() => {
  vi.mocked(useProjectData).mockReturnValue({
    selectedProject: { id: "project-1", name: "Composition QA" },
  } as any);
  vi.mocked(useStatsPageData).mockReturnValue(baseMockData as any);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatsPage Composition", () => {
  it("renders composition top cards and studio sections from a rich stats snapshot", () => {
    render(<StatsPage />);

    expect(screen.getByRole("region", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Composition metrics" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Analysis workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Provider Share: 75%/ })).toHaveTextContent("Codex leads 2 provider rows by tokens");
    expect(screen.getByRole("article", { name: /Token Anatomy: 80\.0k/ })).toHaveTextContent("Input leads at 45%");
    expect(screen.getByRole("article", { name: /Source Mix: 85%/ })).toHaveTextContent("reported is the dominant telemetry source");
    expect(screen.getByText("Merge Conflicts")).toBeInTheDocument();
    expect(screen.getByText("3 PRs · 2 merged")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "How the window was consumed" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where usage landed" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why tokens were spent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Provider detail" })).toBeInTheDocument();
    expect(screen.getAllByText("Task Coding").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cached input").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$9.20").length).toBeGreaterThan(0);
    expect(screen.queryByText("Token Flight")).not.toBeInTheDocument();
  });

  it("keeps composition controls accessible while the studio and top runway coexist", () => {
    render(<StatsPage />);

    const modeGroup = screen
      .getAllByRole("group", { name: "Analytics modes" })
      .find((element) => element.className.includes("heroViewToggle"))!;
    expect(within(modeGroup).getByRole("button", { name: "Composition" })).toHaveAttribute("aria-pressed", "true");
    expect(within(modeGroup).getByRole("button", { name: "Providers" })).toHaveAttribute("aria-pressed", "false");
    expect(within(modeGroup).getByRole("button", { name: "Ledgers" })).toHaveAttribute("aria-pressed", "false");
    expect(modeGroup.className).toContain("flex-wrap");

    const summaryCards = within(screen.getByTestId("top-cards-renderer")).getAllByRole("article");
    expect(summaryCards.length).toBe(4);
    for (const card of summaryCards) {
      expect(card).toHaveAccessibleName(/\S/);
    }

    expect(screen.queryByLabelText("Stats workspace context")).not.toBeInTheDocument();
  });
});
