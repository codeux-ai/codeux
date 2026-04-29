/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useStatsPageData } from "../../../dashboard/src/v2/pages/stats/use-stats-page-data.js";
import { useProjectStats } from "../../../dashboard/src/v2/hooks/use-project-stats.js";
import { useUsageChartState } from "../../../dashboard/src/v2/pages/stats/use-usage-chart-state.js";

vi.mock("../../../dashboard/src/v2/hooks/use-project-stats.js", () => ({
  useProjectStats: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/pages/stats/use-usage-chart-state.js", () => ({
  useUsageChartState: vi.fn(),
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

describe("useStatsPageData", () => {
  beforeEach(() => {
    vi.mocked(useProjectStats).mockReturnValue({
      stats: baseStats as any,
      loading: false,
      error: null,
    });
    vi.mocked(useUsageChartState).mockReturnValue({
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
    } as any);
  });

  it("maintains stable references for derived stats objects on unrelated state changes", async () => {
    const { result } = renderHook(() => useStatsPageData("proj-1"));

    const initialTokenSeries = result.current.tokenSeries;
    const initialProviderSegments = result.current.providerSegments;

    await act(async () => {
      result.current.setCustomFrom("2023-05-01");
    });

    expect(result.current.customFrom).toBe("2023-05-01");

    // References should be strictly identical because `stats` didn't change
    expect(result.current.tokenSeries).toBe(initialTokenSeries);
    expect(result.current.providerSegments).toBe(initialProviderSegments);
  });
});
