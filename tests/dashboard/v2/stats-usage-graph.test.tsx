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
    set: vi.fn()
  }
}));

describe("UsageSeriesSidebar", () => {
  it("renders group controls correctly", () => {
    const series = [
      { id: "tokens", label: "Tokens", grouping: "Usage", defaultEnabled: true, data: [100] },
      { id: "active", label: "Active Time", grouping: "Usage", defaultEnabled: true, data: [200] },
      { id: "foo", label: "Foo", grouping: "Details", defaultEnabled: false, data: [300] }
    ];

    render(<UsageSeriesSidebar series={series as any} enabledSeries={{ tokens: true, active: false, foo: false }} onToggle={vi.fn()} activeIndex={0} />);

    expect(screen.getAllByText("Usage").length).toBeGreaterThan(0);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
    expect(screen.getByText("Active Time")).toBeInTheDocument();
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
        { id: "active", label: "Active Time", grouping: "Usage", defaultEnabled: true, data: [200] }
      ]
    } as any;

    render(<InteractiveUsageChart stats={stats} />);

    expect(screen.getAllByText("Usage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
  });
});
