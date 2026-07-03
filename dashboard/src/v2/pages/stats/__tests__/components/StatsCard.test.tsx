/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import { StatsCard } from "../../components/StatsCard.js";
import { CHART_SERIES, SeriesLegendButton, SortButton, ViewToggle } from "../../components/stats-ui-primitives.js";
import { Activity } from "lucide-preact";

expect.extend(matchers);

// Mock animated foundations to avoid GSAP/DOM issues in jsdom
vi.mock("../../../../components/ui/WaveFluid.js", () => ({
  WaveFluid: () => <div data-testid="wave-fluid" />,
}));

vi.mock("../../../../components/ui/BorderTrace.js", () => ({
  BorderTrace: () => <div data-testid="border-trace" />,
}));

describe("StatsCard", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders basic title and value correctly", () => {
    render(<StatsCard title="Daily Active" value="4.2k" />);
    
    expect(screen.getByText("Daily Active")).toBeDefined();
    expect(screen.getByText("4.2k")).toBeDefined();
    expect(screen.getByRole("article", { name: "Daily Active: 4.2k" })).toBeDefined();
  });

  it("renders icon component when provided", () => {
    const { container } = render(<StatsCard title="Test" value="0" icon={Activity} />);
    expect(screen.getByRole("article", { name: "Test: 0" })).toBeDefined();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders trend and description slots", () => {
    render(
      <StatsCard 
        title="Revenue" 
        value="$50k" 
        trend={<span data-testid="trend-chip">+15%</span>}
        description="vs previous period"
      />
    );
    
    expect(screen.getByTestId("trend-chip")).toBeDefined();
    expect(screen.getByText("vs previous period")).toBeDefined();
    expect(screen.getByRole("article", { name: "Revenue: $50k: vs previous period" })).toBeDefined();
  });

  it("keeps the accessible card contract across accent variants", () => {
    render(<StatsCard title="Cost" value="$4.20" accent="amber" description="Projected usage" />);
    expect(screen.getByRole("article", { name: "Cost: $4.20: Projected usage" })).toBeDefined();
    expect(screen.getByText("Projected usage")).toBeDefined();
  });

  it("stays stable without optional elements", () => {
    render(<StatsCard title="Minimal" value="100" />);
    
    expect(screen.queryByTestId("trend-chip")).toBeNull();
    expect(screen.getByRole("article", { name: "Minimal: 100" })).toBeDefined();
  });

  it("renders visual children directly in the card so backgrounds reach the edges", () => {
    const { container } = render(
      <StatsCard title="With Visual" value="42">
        <svg data-testid="edge-visual" />
      </StatsCard>
    );

    const card = container.firstChild as HTMLElement;
    const visual = screen.getByTestId("edge-visual");
    expect(visual.parentElement).toBe(card);
  });

  it("keeps long labels and values exposed without changing the card contract", () => {
    const longTitle = "Extremely Long Provider Throughput Label That Should Wrap";
    const longValue = "123456789012345678901234567890 tokens";

    render(
      <StatsCard
        title={longTitle}
        value={longValue}
        description="Sustained window with a long descriptive phrase"
      />,
    );

    expect(screen.getByText(longTitle)).toBeDefined();
    expect(screen.getByText(longValue)).toBeDefined();
    expect(
      screen.getByRole("article", {
        name: `${longTitle}: ${longValue}: Sustained window with a long descriptive phrase`,
      }),
    ).toBeDefined();
  });

  it("renders ViewToggle as pressed segmented controls with icon-first labels", () => {
    const onChange = vi.fn();

    render(<ViewToggle value="models" onChange={onChange} ariaLabel="Stats mode" />);

    expect(screen.getByRole("group", { name: "Stats mode" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Models" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Trend" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Ledgers" }));

    expect(onChange).toHaveBeenCalledWith("ledgers");
  });

  it("exposes selected state on shared sort and series controls", () => {
    const onSort = vi.fn();
    const onToggle = vi.fn();

    render(
      <div>
        <SortButton label="Recent" active={true} direction="desc" onClick={onSort} />
        <SeriesLegendButton
          series={CHART_SERIES[0]}
          active={true}
          currentValue={42000}
          onToggle={onToggle}
        />
      </div>,
    );

    expect(screen.getByRole("button", { name: /Recent/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Throughput/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Throughput/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

});
