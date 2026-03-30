/** @jsx h */
/** @jsxFrag Fragment */
/** @vitest-environment jsdom */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import * as matchers from '@testing-library/jest-dom/matchers';
import { UsageSeriesSidebar } from "../../../dashboard/src/v2/pages/stats/components/UsageSeriesSidebar.js";
import { ActiveUsageSeriesRail } from "../../../dashboard/src/v2/pages/stats/components/ActiveUsageSeriesRail.js";
import type { ProjectExecutionStatsChartSeries } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

const mockSeries: ProjectExecutionStatsChartSeries[] = [
  { id: "tokens", label: "Tokens", grouping: "totals", data: [100, 200] } as any,
  { id: "active", label: "Active", grouping: "details", data: [50, 60] } as any,
  { id: "invocations", label: "Invocations", grouping: "totals", data: [10, 20] } as any,
];

describe("ActiveUsageSeriesRail", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders only enabled series", () => {
    const { getByText, queryByText } = render(
      <ActiveUsageSeriesRail
        series={mockSeries}
        enabledSeries={{ tokens: true, active: false, invocations: true }}
        onToggle={vi.fn()}
        activeIndex={0}
      />
    );

    expect(getByText("Tokens")).toBeInTheDocument();
    expect(getByText("Invocations")).toBeInTheDocument();
    expect(queryByText("Active")).not.toBeInTheDocument();
  });

  it("prevents toggling off the last enabled series", () => {
    const onToggle = vi.fn();
    const { getByRole } = render(
      <ActiveUsageSeriesRail
        series={mockSeries}
        enabledSeries={{ tokens: true, active: false, invocations: false }}
        onToggle={onToggle}
        activeIndex={0}
      />
    );

    const button = getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("UsageSeriesSidebar", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders grouped inactive controls correctly", () => {
    const { getByText, queryByText } = render(
      <UsageSeriesSidebar
        series={mockSeries}
        enabledSeries={{ tokens: true, active: false, invocations: false }}
        onToggle={vi.fn()}
        activeIndex={0}
      />
    );

    expect(getByText("details")).toBeInTheDocument();
    expect(getByText("Active")).toBeInTheDocument();
    expect(queryByText("Tokens")).not.toBeInTheDocument();
  });

  it("calls onToggle when an inactive series is clicked", () => {
    const onToggle = vi.fn();
    const { getByText } = render(
      <UsageSeriesSidebar
        series={mockSeries}
        enabledSeries={{ tokens: true, active: false, invocations: false }}
        onToggle={onToggle}
        activeIndex={0}
      />
    );

    // Click the active series, it should call onToggle with "active"
    fireEvent.click(getByText("Active").closest("button")!);
    expect(onToggle).toHaveBeenCalledWith("active");
  });
});
