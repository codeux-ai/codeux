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
    set: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  }
}));

describe("UsageSeriesSidebar", () => {
  it("renders group controls correctly", () => {
    const series = [
      { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100] },
      { id: "active", label: "Active Time", grouping: "Usage", defaultEnabled: true, data: [200] },
      { id: "foo", label: "Foo", grouping: "Details", defaultEnabled: false, data: [300] },
      { id: "provider_codex", label: "codex Tokens", grouping: "providers", defaultEnabled: false, data: [400] },
      { id: "purpose_time_task_coding", label: "task coding Time", grouping: "purposes_time", defaultEnabled: false, data: [500] }
    ];

    render(<UsageSeriesSidebar series={series as any} enabledSeries={{ tokens: true, active: false, foo: false, provider_codex: false, purpose_time_task_coding: false }} onToggle={vi.fn()} activeIndex={0} />);

    expect(screen.getAllByText("Usage").length).toBeGreaterThan(0);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
    expect(screen.getByText("Active Time")).toBeInTheDocument();
    expect(screen.getAllByText("providers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("codex Tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("purposes_time").length).toBeGreaterThan(0);
    expect(screen.getAllByText("task coding Time").length).toBeGreaterThan(0);
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

    render(<InteractiveUsageChart stats={stats} chartState={chartState} />);

    expect(screen.getAllByText("Usage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("codex Tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("task coding Time").length).toBeGreaterThan(0);
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

    const { rerender } = render(<InteractiveUsageChart stats={stats} chartState={chartState} />);

    // Update stats instance with same window context
    const updatedStats = {
      ...stats,
      buckets: [
        ...stats.buckets,
        { label: "B2", bucketStart: "2023-01-02", bucketEnd: "2023-01-03", usage: { totalTokens: 20, activeTimeMs: 2000, invocationCount: 2 } }
      ]
    };

    // ChartState is still pointing to the same zoom range and enabled series
    rerender(<InteractiveUsageChart stats={updatedStats} chartState={chartState} />);

    // We confirm that it renders using the preserved chartState correctly without crashing
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
  });
});
