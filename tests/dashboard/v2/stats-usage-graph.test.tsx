/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

import { InteractiveUsageChart } from "../../../dashboard/src/v2/pages/stats/components/InteractiveUsageChart.js";
import { UsageSeriesSidebar } from "../../../dashboard/src/v2/pages/stats/components/UsageSeriesSidebar.js";
import {
  getVisibleBuckets,
  normalizeChartSeries,
  groupChartSeries,
  calculateChartMetrics,
  getTooltipState,
} from "../../../dashboard/src/v2/pages/stats/chart-view-models.js";
import { useUsageChartState } from "../../../dashboard/src/v2/pages/stats/use-usage-chart-state.js";

// Basic stubs
window.SVGElement.prototype.getTotalLength = () => 100;

vi.mock("gsap", () => ({
  default: {
    timeline: () => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      kill: vi.fn(),
      set: vi.fn()
    }),
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    getProperty: vi.fn().mockReturnValue(1),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  }
}));

describe("Chart View Models", () => {
  it("getVisibleBuckets slices correctly", () => {
    const buckets = [{ id: 1 }, { id: 2 }, { id: 3 }] as any;
    expect(getVisibleBuckets(buckets, 0, 1)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("normalizeChartSeries normalizes data and creates formatters", () => {
    const chartSeries = [{
      id: "tokens",
      color: "#000",
      formatter: "number",
      signalLabel: "Tk",
      data: [100, 200]
    }] as any;
    const buckets = [{}, {}] as any;
    const normalized = normalizeChartSeries(chartSeries, buckets, 0, 100, 100, 10);

    expect(normalized[0]?.id).toBe("tokens");
    expect(normalized[0]?.values).toEqual([100, 200]);
    expect(normalized[0]?.points.length).toBe(2);
    expect(typeof normalized[0]?.formatter).toBe("function");
    expect(normalized[0]?.formatter(1000)).toBe("1,000");
  });

  it("groupChartSeries groups by grouping key", () => {
    const chartSeries = [
      { id: "s1", grouping: "G1" },
      { id: "s2", grouping: "G1" },
      { id: "s3", grouping: "G2" },
    ] as any;
    const grouped = groupChartSeries(chartSeries);
    expect(grouped["G1"]?.length).toBe(2);
    expect(grouped["G2"]?.length).toBe(1);
  });

  it("calculateChartMetrics calculates peak and average metrics", () => {
    const buckets = [
      { usage: { totalTokens: 10, activeTimeMs: 100, invocationCount: 1 } },
      { usage: { totalTokens: 20, activeTimeMs: 200, invocationCount: 2 } },
    ] as any;
    const metrics = calculateChartMetrics(buckets);
    expect(metrics.peakTokens).toBe(20);
    expect(metrics.peakTime).toBe(200);
    expect(metrics.peakInvocations).toBe(2);
    expect(metrics.averageTokens).toBe(15);
  });

  it("getTooltipState calculates correct index and active bucket", () => {
    const buckets = [{ id: "b1" }, { id: "b2" }] as any;
    const chartData = [{ points: [{ x: 10 }, { x: 20 }] }] as any;

    const state = getTooltipState(buckets, chartData, 0, 0, 100);
    expect(state.activeIndex).toBe(0);
    expect(state.activeBucket).toEqual({ id: "b1" });
    expect(state.xPositions).toEqual([10, 20]);
    expect(state.tooltipLeft).toBe(10);
  });
});

describe("UsageSeriesSidebar", () => {
  it("renders only enabled series without interactive grouping labels", () => {
    const series = [
      { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, values: [100], formatter: (val: any) => String(val), accentHex: "#000" },
      { id: "active", label: "Active Time", grouping: "Usage", defaultEnabled: true, values: [200], formatter: (val: any) => String(val), accentHex: "#000" },
      { id: "foo", label: "Foo", grouping: "Details", defaultEnabled: false, values: [300], formatter: (val: any) => String(val), accentHex: "#000" },
      { id: "provider_codex", label: "codex Tokens", grouping: "providers", defaultEnabled: false, values: [400], formatter: (val: any) => String(val), accentHex: "#000" },
      { id: "purpose_time_task_coding", label: "task coding Time", grouping: "purposes_time", defaultEnabled: false, values: [500], formatter: (val: any) => String(val), accentHex: "#000" }
    ];

    render(<UsageSeriesSidebar series={series as any} enabledSeries={{ tokens: true, active: false, foo: false, provider_codex: false, purpose_time_task_coding: false }} activeIndex={0} />);

    // Renders the enabled metric label
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);

    // Does NOT render disabled metrics
    expect(screen.queryByText("Active Time")).not.toBeInTheDocument();
    expect(screen.queryByText("Foo")).not.toBeInTheDocument();
    expect(screen.queryByText("codex Tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("task coding Time")).not.toBeInTheDocument();

    // Does NOT render grouping titles anymore
    expect(screen.queryByText("Usage")).not.toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(screen.queryByText("providers")).not.toBeInTheDocument();
    expect(screen.queryByText("purposes_time")).not.toBeInTheDocument();
  });
});

import { UsageFilterMenu } from "../../../dashboard/src/v2/pages/stats/components/UsageFilterMenu.js";

describe("UsageFilterMenu", () => {
  it("renders correctly and manages aria states", () => {
    const stats = {
      chartSeries: [
        { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100] },
        { id: "active", label: "Active Time", grouping: "Usage", defaultEnabled: true, data: [200] },
      ]
    } as any;

    const { getByRole, getAllByRole } = render(
      <UsageFilterMenu
        isOpen={true}
        onClose={vi.fn()}
        activeWindow="7d"
        customFrom="2023-01-01"
        customTo="2023-01-07"
        onSelectPreset={vi.fn()}
        onCustomFromChange={vi.fn()}
        onCustomToChange={vi.fn()}
        onApplyCustom={vi.fn()}
        stats={stats}
        enabledSeries={{ tokens: true, active: false }}
        setEnabledSeries={vi.fn()}
        activeSeriesCount={1}
      />
    );

    const tokensBtn = getByRole("button", { name: /Tokens/i });
    const activeBtn = getByRole("button", { name: /Active Time/i });

    // Since tokens is the only active series, it should be disabled to prevent 0 active series
    expect(tokensBtn).toBeDisabled();
    expect(activeBtn).not.toBeDisabled();
  });
});

describe("InteractiveUsageChart", () => {
  it("renders with stats and updates the sidebar", () => {
    const stats = {
      buckets: [
        { label: "B1", bucketStart: "2023-01-01", bucketEnd: "2023-01-02", usage: { totalTokens: 10, activeTimeMs: 1000, invocationCount: 1 } }
      ],
      range: {
        label: "Last 7 Days",
        bucketCount: 1,
        from: "2023-01-01",
        to: "2023-01-02",
        resolution: "day"
      },
      chartSeries: [
        { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100] },
        { id: "active", label: "Active Time", grouping: "Usage", defaultEnabled: true, data: [200] },
        { id: "provider_codex", label: "codex Tokens", grouping: "providers", defaultEnabled: false, data: [400] },
        { id: "purpose_time_task_coding", label: "task coding Time", grouping: "purposes_time", defaultEnabled: false, data: [500] }
      ]
    } as any;

    const chartState = {
      visualMode: "trend" as any,
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
    };

    render(<InteractiveUsageChart stats={stats} loading={false} error={null} refresh={vi.fn()} chartState={chartState} />);

    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
  });

  it("preserves state when rendering with the same stats context", () => {
    const stats = {
      buckets: [
        { label: "B1", bucketStart: "2023-01-01", bucketEnd: "2023-01-02", usage: { totalTokens: 10, activeTimeMs: 1000, invocationCount: 1 } }
      ],
      range: {
        label: "Last 7 Days",
        bucketCount: 1,
        from: "2023-01-01",
        to: "2023-01-02",
        resolution: "day"
      },
      chartSeries: [
        { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100] },
      ]
    } as any;

    // Create chartState with custom modified values
    const chartState = {
      visualMode: "trend" as any,
      setVisualMode: vi.fn(),
      zoomRange: { start: 0, end: 1 },
      setZoomRange: vi.fn(),
      hoveredIndex: null,
      setHoveredIndex: vi.fn(),
      dragStartIndex: null,
      setDragStartIndex: vi.fn(),
      dragCurrentIndex: null,
      setDragCurrentIndex: vi.fn(),
      enabledSeries: { tokens: false, active: true },
      setEnabledSeries: vi.fn(),
    };

    const { rerender } = render(<InteractiveUsageChart stats={stats} loading={false} error={null} refresh={vi.fn()} chartState={chartState} />);

    // Update stats instance with same window context and new chartSeries reference
    // This simulates a polling refresh where range stays identical but arrays are new
    const updatedStats = {
      ...stats,
      buckets: [
        ...stats.buckets,
        { label: "B2", bucketStart: "2023-01-02", bucketEnd: "2023-01-03", usage: { totalTokens: 20, activeTimeMs: 2000, invocationCount: 2 } }
      ],
      chartSeries: [
        { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100, 150] },
      ]
    };

    // ChartState is still pointing to the same zoom range and enabled series
    rerender(<InteractiveUsageChart stats={updatedStats} loading={false} error={null} refresh={vi.fn()} chartState={chartState} />);

    // We confirm that it renders using the preserved chartState correctly without crashing
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);

    // Explicitly verify the test spy didn't get called to reset the enabled series state,
    // ensuring the chart component isn't aggressively reinitializing it from stats
    expect(chartState.setEnabledSeries).not.toHaveBeenCalled();
    expect(chartState.setZoomRange).not.toHaveBeenCalled();
  });

  it("renders loading indicator and error states correctly", () => {
    const stats = {
      buckets: [
        { label: "B1", bucketStart: "2023-01-01", bucketEnd: "2023-01-02", usage: { totalTokens: 10, activeTimeMs: 1000, invocationCount: 1 } }
      ],
      range: { label: "Last 7 Days", bucketCount: 1, from: "2023-01-01", to: "2023-01-02", resolution: "day" },
      chartSeries: [{ id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100] }]
    } as any;

    const chartState = {
      visualMode: "trend" as any, setVisualMode: vi.fn(), zoomRange: null, setZoomRange: vi.fn(),
      hoveredIndex: null, setHoveredIndex: vi.fn(), dragStartIndex: null, setDragStartIndex: vi.fn(),
      dragCurrentIndex: null, setDragCurrentIndex: vi.fn(), enabledSeries: { tokens: true }, setEnabledSeries: vi.fn(),
    };

    const mockRefresh = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(<InteractiveUsageChart stats={stats} loading={true} error={null} refresh={mockRefresh} chartState={chartState} />);
    expect(screen.getByText("Syncing")).toBeInTheDocument();

    rerender(<InteractiveUsageChart stats={stats} loading={false} error="Network failed" refresh={mockRefresh} chartState={chartState} />);
    expect(screen.getByText("Network failed")).toBeInTheDocument();

    // Test the retry button
    const retryButton = screen.getByRole("button", { name: "Retry" });
    retryButton.click();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("renders empty state with reset filters button when zero buckets", () => {
    const stats = {
      buckets: [],
      range: { label: "Last 7 Days", bucketCount: 0, from: "2023-01-01", to: "2023-01-02", resolution: "day" },
      chartSeries: []
    } as any;

    const chartState = {
      visualMode: "trend" as any, setVisualMode: vi.fn(), zoomRange: null, setZoomRange: vi.fn(),
      hoveredIndex: null, setHoveredIndex: vi.fn(), dragStartIndex: null, setDragStartIndex: vi.fn(),
      dragCurrentIndex: null, setDragCurrentIndex: vi.fn(), enabledSeries: {}, setEnabledSeries: vi.fn(),
    };

    render(<InteractiveUsageChart stats={stats} loading={false} error={null} refresh={vi.fn()} chartState={chartState} />);

    expect(screen.getByText("No Activity Detected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset Filters" })).not.toBeInTheDocument();
  });
});

describe("useUsageChartState", () => {
  it("resets state when the actual stats range or project changes", async () => {
    // A simplified test for the hook behavior using preact testing library render
    let currentState: any = null;

    const HookWrapper = ({ projectId, stats }: { projectId: string | null, stats: any }) => {
      currentState = useUsageChartState(projectId, stats);
      return <div data-testid="wrapper">Test</div>;
    };

    const initialStats = {
      buckets: [{ bucketStart: "2023-01-01" }, { bucketStart: "2023-01-02" }, { bucketStart: "2023-01-03" }],
      range: { from: "2023-01-01", to: "2023-01-07", resolution: "day" },
      chartSeries: [
        { id: "tokens", defaultEnabled: true },
        { id: "active", defaultEnabled: false }
      ]
    };

    const { rerender } = render(<HookWrapper projectId="proj-1" stats={initialStats} />);

    // Initial state correctly sets the first series to true based on defaultEnabled
    expect(currentState.enabledSeries).toEqual({ tokens: true, active: false });

    // Simulate user interaction: toggle 'active' to true and 'tokens' to false, add zoom
    currentState.setEnabledSeries({ tokens: false, active: true });
    currentState.setZoomRange({ start: 0, end: 1 });

    // Trigger re-render to apply new state
    rerender(<HookWrapper projectId="proj-1" stats={initialStats} />);

    expect(currentState.enabledSeries).toEqual({ tokens: false, active: true });
    expect(currentState.zoomRange).toEqual({ start: 0, end: 1 });

    // Rerender with SAME date range but new stats object reference (like a polling refresh)
    const refreshedStats = {
      ...initialStats,
      chartSeries: [...initialStats.chartSeries]
    };
    rerender(<HookWrapper projectId="proj-1" stats={refreshedStats} />);

    // State is PRESERVED
    expect(currentState.enabledSeries).toEqual({ tokens: false, active: true });
    expect(currentState.zoomRange).toEqual({ start: 0, end: 1 });

    // Rerender with DIFFERENT date range (e.g. user selected 30 days instead of 7 days)
    const newRangeStats = {
      ...initialStats,
      range: { from: "2023-01-01", to: "2023-01-31", resolution: "day" },
      chartSeries: [...initialStats.chartSeries]
    };
    rerender(<HookWrapper projectId="proj-1" stats={newRangeStats} />);

    // Zoom state is RESET, but enabledSeries is PRESERVED
    expect(currentState.enabledSeries).toEqual({ tokens: false, active: true });
    expect(currentState.zoomRange).toBeNull();
  });
});
