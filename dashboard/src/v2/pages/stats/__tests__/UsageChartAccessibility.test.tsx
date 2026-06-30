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
    { bucketStart: "2024-01-01T00:00:00Z", bucketEnd: "2024-01-02T00:00:00Z", label: "Jan 1", usage: { totalTokens: 100, activeTimeMs: 1000, invocationCount: 10 } },
    { bucketStart: "2024-01-02T00:00:00Z", bucketEnd: "2024-01-03T00:00:00Z", label: "Jan 2", usage: { totalTokens: 200, activeTimeMs: 2000, invocationCount: 20 } },
    { bucketStart: "2024-01-03T00:00:00Z", bucketEnd: "2024-01-04T00:00:00Z", label: "Jan 3", usage: { totalTokens: 150, activeTimeMs: 1500, invocationCount: 15 } }
  ],
  chartSeries: [
    { id: "tokens", label: "Tokens", accentHex: "#00E0A0", data: [100, 200, 150], formatter: "number", signalLabel: "tokens" }
  ]
};

const Wrapper = () => {
  const chartState = useUsageChartState("test", mockStats as any);
  return <InteractiveUsageChart stats={mockStats as any} loading={false} error={null} refresh={async () => {}} chartState={chartState} />;
};

const ZoomedWrapper = () => {
  const chartState = useUsageChartState("test", mockStats as any);
  chartState.zoomRange = { start: 0, end: 1 };
  return <InteractiveUsageChart stats={mockStats as any} loading={false} error={null} refresh={async () => {}} chartState={chartState} />;
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

  it("renders a textual summary of the chart", () => {
    render(<Wrapper />);
    expect(screen.getAllByText(/Data Visualization for/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/Currently showing 3 buckets/i)).toBeInTheDocument();
    expect(screen.getByText(/Peak Tokens: 200/i)).toBeInTheDocument();
  });

  it("makes bucket focus keyboard-accessible with a slider", () => {
    render(<Wrapper />);
    const slider = screen.getByLabelText(/Explore chart data across time/i);
    expect(slider).toBeInTheDocument();

    expect(slider).toHaveAttribute('aria-describedby', 'usage-chart-tooltip');

    fireEvent.input(slider, { target: { value: '1' } });

    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('Jan 2'));
    expect(document.getElementById('usage-chart-tooltip')).toBeInTheDocument();

    // Zoom by pressing enter
    fireEvent.keyDown(slider, { key: "Enter" });
  });

  it("has accessible filter buttons", () => {
    render(<Wrapper />);
    const button = screen.getByRole("button", { name: /Filters/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
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

    // Check if filter metric buttons have aria-pressed
    // Use explicitly lookup for all buttons and find one with aria-pressed.
    // Given they are rendered within UsageFilterMenu:
    const buttons = screen.getAllByRole("button");
    const pressedButton = buttons.find(b => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-pressed') === 'false');
    expect(pressedButton).toBeInTheDocument();
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
});
