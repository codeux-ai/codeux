/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { InteractiveUsageChart } from "../components/InteractiveUsageChart.js";
import { useUsageChartState } from "../use-usage-chart-state.js";
import { UsageGraphEmpty, UsageGraphLoading, UsageGraphError } from "../components/UsageGraphStates.js";
import { groupChartSeries } from "../chart-view-models.js";
import gsap from "gsap";
import { StatsI18nProvider } from "../stats-i18n.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn().mockImplementation((el, from, to) => {
      if (to?.onComplete) to.onComplete();
    }),
    to: vi.fn().mockImplementation((el, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    set: vi.fn(),
    timeline: vi.fn().mockReturnValue({
      to: vi.fn(),
      fromTo: vi.fn(),
      kill: vi.fn()
    }),
    context: vi.fn().mockImplementation((cb) => { cb(); return { revert: vi.fn() }; }),
    matchMedia: vi.fn().mockReturnValue({
      add: vi.fn().mockImplementation((_q, cb) => {
        // Run no-preference block by default in tests
        if (_q.includes("no-preference")) cb();
      }),
      revert: vi.fn()
    })
  }
}));

const mockStats = {
  range: { label: "Last 7 Days", bucketCount: 7, resolutionLabel: "per day", from: new Date(), to: new Date() },
  buckets: [
    { bucketStart: "2024-01-01T00:00:00Z", bucketEnd: "2024-01-02T00:00:00Z", label: "Jan 1", usage: { totalTokens: 100, activeTimeMs: 1000, invocationCount: 10, totalCostUsd: 0.1 } },
    { bucketStart: "2024-01-02T00:00:00Z", bucketEnd: "2024-01-03T00:00:00Z", label: "Jan 2", usage: { totalTokens: 200, activeTimeMs: 2000, invocationCount: 20, totalCostUsd: 0.2 } },
    { bucketStart: "2024-01-03T00:00:00Z", bucketEnd: "2024-01-04T00:00:00Z", label: "Jan 3", usage: { totalTokens: 150, activeTimeMs: 1500, invocationCount: 15, totalCostUsd: 0.15 } }
  ],
  chartSeries: [
    { id: "tokens", label: "Tokens", accentHex: "#00E0A0", data: [100, 200, 150], formatter: "number", signalLabel: "tokens" }
  ]
};

const Wrapper = () => {
  const chartState = useUsageChartState("test", mockStats as any);
  return <InteractiveUsageChart stats={mockStats as any} loading={false} error={null} refresh={async () => {}} chartState={chartState} />;
};

const GermanWrapper = () => (
  <StatsI18nProvider locale="de">
    <Wrapper />
  </StatsI18nProvider>
);

const ZoomedWrapper = () => {
  const chartState = useUsageChartState("test", mockStats as any);
  chartState.zoomRange = { start: 0, end: 1 };
  return <InteractiveUsageChart stats={mockStats as any} loading={false} error={null} refresh={async () => {}} chartState={chartState} />;
};

const EmptyWrapper = () => {
  const emptyStats = { ...mockStats, buckets: [], chartSeries: [] };
  const chartState = useUsageChartState("test", emptyStats as any);
  return <InteractiveUsageChart stats={emptyStats as any} loading={false} error={null} refresh={async () => {}} chartState={chartState} />;
};

beforeAll(() => {
  if (typeof window.SVGPathElement !== 'undefined') {
    Object.defineProperty(window.SVGPathElement.prototype, 'getTotalLength', {
      value: () => 100
    });
  }
});

describe("UsageChartAccessibility", () => {
  let observerCallback: ResizeObserverCallback;
  let originalObserver: typeof window.ResizeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    originalObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.ResizeObserver = originalObserver;
  });

  it("updates geometry and handles hover interactions based on state", async () => {
    const { container } = render(<Wrapper />);

    act(() => {
      observerCallback!([
        {
          contentRect: { width: 800, height: 400 },
        } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    // Fast-forward RAF so dimension state applies
    act(() => {
      vi.runAllTimers();
    });

    await vi.waitFor(() => {
      const rects = container.querySelectorAll('rect[tabIndex="0"]');
      expect(rects.length).toBe(3); // 3 buckets in mock data
    });

    const rects = container.querySelectorAll('rect[tabIndex="0"]');

    // Simulate hovering a rect to ensure it affects state correctly
    fireEvent.mouseEnter(rects[1]!);
    expect(screen.getAllByText('Jan 2').length).toBeGreaterThan(0);

    // Simulate focus to ensure keyboard accessibility works via state
    fireEvent.focus(rects[2]!);
    expect(screen.getAllByText('Jan 3').length).toBeGreaterThan(0);
  });

  it("lets keyboard users zoom a focused chart bucket", async () => {
    const { container } = render(<Wrapper />);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('rect[tabIndex="0"]').length).toBe(3);
    });

    const rects = container.querySelectorAll('rect[tabIndex="0"]');
    fireEvent.focus(rects[1]!);
    fireEvent.keyDown(rects[1]!, { key: "Enter" });

    expect(screen.getByRole("button", { name: /Reset zoom/i })).toBeInTheDocument();
    expect(screen.getByText("Pinned Jan 2.")).toBeInTheDocument();
  });

  it("announces completed drag zoom changes without per-frame status", async () => {
    const { container } = render(<Wrapper />);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('rect[tabIndex="0"]').length).toBe(3);
    });

    const rects = container.querySelectorAll('rect[tabIndex="0"]');
    fireEvent.mouseDown(rects[0]!);
    fireEvent.mouseMove(rects[2]!);
    fireEvent.mouseUp(rects[2]!);

    expect(screen.getByText("Zoomed to Jan 1 through Jan 3, 3 buckets.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset zoom/i })).toBeInTheDocument();
  });

  it("renders a textual summary of the chart", () => {
    render(<Wrapper />);
    expect(screen.getAllByText(/Data Visualization for/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/3 visible buckets in Last 7 Days/i)).toBeInTheDocument();
    expect(screen.getByText(/Peak tokens 200/i)).toBeInTheDocument();
    expect(screen.getByText(/Active series: Tokens/i)).toBeInTheDocument();
  });

  it("makes bucket focus keyboard-accessible with a slider", () => {
    render(<Wrapper />);
    const slider = screen.getByLabelText(/Explore chart data across time/i);
    expect(slider).toBeInTheDocument();

    expect(slider.getAttribute('aria-describedby')).toContain('usage-chart-tooltip');
    expect(slider.getAttribute('aria-describedby')).toContain('usage-chart-instructions');

    fireEvent.input(slider, { target: { value: '1' } });

    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('Jan 2'));
    expect(document.getElementById('usage-chart-tooltip')).toBeInTheDocument();
    expect(screen.getAllByText('Cost').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.20').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Invocations').length).toBeGreaterThan(0);

    // Zoom by pressing enter
    fireEvent.keyDown(slider, { key: "Enter" });
  });

  it("has accessible filter buttons", () => {
    render(<Wrapper />);
    const button = screen.getByRole("button", { name: /Filters/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleDescription(/active series/i);
    expect(screen.getByRole("toolbar", { name: /Usage graph controls/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Usage chart summary metrics/i)).toBeNull();
    expect(screen.queryByRole("article", { name: /Peak tokens: 200/i })).toBeNull();
    expect(screen.queryByRole("article", { name: /Visible cost: \$0.45/i })).toBeNull();
  });

  it("announces zoom reset", () => {
    render(<ZoomedWrapper />);
    const resetButton = screen.getByRole("button", { name: /Reset zoom/i });
    expect(resetButton).toBeInTheDocument();
    expect(screen.getByText(/to Last 7 Days/i)).toBeInTheDocument();
  });

  it("renders an accessible data table alternative for screen readers", () => {
    const { container } = render(<Wrapper />);
    const table = container.querySelector('table.sr-only');
    expect(table).toBeInTheDocument();
    expect(table?.querySelectorAll('tbody tr').length).toBe(3); // 3 buckets in mock data
    expect(table?.textContent).toContain('Jan 2');
    expect(table?.textContent).toContain('200'); // the formatted value
  });

  it("marks legend and filter controls as toggle buttons", () => {
    render(<Wrapper />);

    // Test the filter button
    const filtersButton = screen.getByRole("button", { name: /Filters/i });
    expect(filtersButton).toHaveAttribute('aria-expanded', 'false');

    // Simulate opening the filter menu to render the series toggles
    fireEvent.click(filtersButton);

    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.some((button) => button.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(screen.getAllByRole("group", { name: /Usage chart series switches/i }).length).toBeGreaterThan(0);
  });

  it("provides status roles for loading, empty, and error states", () => {
    const { container: loadingContainer } = render(<UsageGraphLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    cleanup();
    const { container: emptyContainer } = render(<UsageGraphEmpty />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    cleanup();
    const { container: errorContainer } = render(<UsageGraphError />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("localizes German chart summaries, tooltip values, and legend accessibility", () => {
    render(<GermanWrapper />);

    expect(screen.getByText(/3 sichtbare Intervalle in Last 7 Days/)).toBeInTheDocument();
    expect(screen.getByText(/Token-Spitze 200/)).toBeInTheDocument();
    const slider = screen.getByLabelText("Diagrammdaten im Zeitverlauf erkunden");
    fireEvent.input(slider, { target: { value: "1" } });
    expect(screen.getAllByText("Kosten").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0,20\s*\$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aufrufe").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("dialog", { name: "Diagrammfilter" })).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "Reihenschalter des Nutzungsdiagramms" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("switch", { name: /Tokens, tokens-Reihe, aktiviert/ }).length).toBeGreaterThan(0);
  });

  it("localizes German chart loading, empty, and retry states", () => {
    const { rerender } = render(
      <StatsI18nProvider locale="de">
        <UsageGraphLoading />
      </StatsI18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Telemetrie-Trenddaten werden geladen/);

    rerender(
      <StatsI18nProvider locale="de">
        <UsageGraphEmpty onReset={vi.fn()} />
      </StatsI18nProvider>,
    );
    expect(screen.getByText("Zeitraum zurücksetzen")).toBeInTheDocument();

    rerender(
      <StatsI18nProvider locale="de">
        <UsageGraphError onRetry={vi.fn()} />
      </StatsI18nProvider>,
    );
    expect(screen.getByText("Erneut versuchen")).toBeInTheDocument();
  });

  it("keeps chart geometry static for reduced motion", () => {
    vi.mocked(gsap.matchMedia).mockReturnValueOnce({
      add: vi.fn().mockImplementation((_query, cb) => {
        if (_query.includes("reduce")) cb();
      }),
      revert: vi.fn(),
    } as any);

    render(<Wrapper />);

    expect(gsap.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ strokeDasharray: "none", strokeDashoffset: 0 }),
    );
  });

  it("announces refresh and error status copy while preserving chart context", async () => {
    const createChartState = () => ({
      visualMode: "trend" as const,
      setVisualMode: vi.fn(),
      zoomRange: null,
      setZoomRange: vi.fn(),
      hoveredIndex: null,
      setHoveredIndex: vi.fn(),
      dragStartIndex: null,
      setDragStartIndex: vi.fn(),
      dragCurrentIndex: null,
      setDragCurrentIndex: vi.fn(),
      enabledSeries: { tokens: true },
      setEnabledSeries: vi.fn(),
      resetEnabledSeries: vi.fn(),
      activeSeriesCount: 1,
      seriesGroups: groupChartSeries(mockStats.chartSeries as any, { tokens: true }),
      metrics: null,
    });
    const { rerender } = render(<InteractiveUsageChart stats={mockStats as any} loading={false} error={null} refresh={async () => {}} chartState={createChartState() as any} />);

    rerender(<InteractiveUsageChart stats={mockStats as any} loading={true} error={null} refresh={async () => {}} chartState={createChartState() as any} />);
    expect(await screen.findByText("Refreshing trend telemetry from cache. Existing chart data remains visible.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Data Visualization/i })).toHaveAttribute("aria-busy", "true");

    rerender(<InteractiveUsageChart stats={mockStats as any} loading={false} error={null} refresh={async () => {}} chartState={createChartState() as any} />);
    expect(await screen.findByText("Trend telemetry ready.")).toBeInTheDocument();
    expect(screen.queryByText("Refreshing trend telemetry from cache. Existing chart data remains visible.")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Data Visualization/i })).toHaveAttribute("aria-busy", "false");

    rerender(<InteractiveUsageChart stats={mockStats as any} loading={false} error="Network timeout" refresh={async () => {}} chartState={createChartState() as any} />);
    expect(await screen.findByText("Trend telemetry error: Network timeout")).toBeInTheDocument();
  });
});
