/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/preact";
import { StatsCard } from "../../components/StatsCard.js";
import {
  CHART_SERIES,
  CHIP_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  SeriesLegendButton,
  SortButton,
  ViewToggle,
} from "../../components/stats-ui-primitives.js";
import { Activity } from "lucide-preact";

expect.extend(matchers);

// Mock animated foundations to avoid GSAP/DOM issues in jsdom
vi.mock("../../../../components/ui/WaveFluid.js", () => ({
  WaveFluid: () => <div data-testid="wave-fluid" />,
}));

vi.mock("../../../../components/ui/BorderTrace.js", () => ({
  BorderTrace: () => <div data-testid="border-trace" />,
}));

const testDir = dirname(fileURLToPath(import.meta.url));
const statsRoot = resolve(testDir, "../..");

describe("StatsCard", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders basic title and value correctly", () => {
    render(<StatsCard title="Daily Active" value="4.2k" />);
    
    expect(screen.getByText("Daily Active")).toBeDefined();
    expect(screen.getByText("4.2k")).toBeDefined();
    const card = screen.getByRole("article", { name: "Daily Active: 4.2k" });
    expect(card).toBeDefined();
    expect(card).toHaveClass("stats-card-flat");
    expect(card).toHaveAttribute("data-accent", "default");
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
    const card = screen.getByRole("article", { name: "Cost: $4.20: Projected usage" });
    expect(card).toBeDefined();
    expect(card).toHaveClass("stats-card-flat");
    expect(card).toHaveAttribute("data-accent", "amber");
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

  it("keeps long labels, values, and descriptions exposed without changing the card contract", () => {
    const longTitle = "Extremely Long Provider Throughput Label That Should Wrap";
    const longValue = "codex/gpt-5-codex-super-long-provider-model-name-with-1234567890 tokens";
    const longDescription = "Sustained window with a long descriptive phrase for provider and model comparisons";

    render(
      <StatsCard
        title={longTitle}
        value={longValue}
        description={longDescription}
      />,
    );

    const card = screen.getByRole("article", {
      name: `${longTitle}: ${longValue}: ${longDescription}`,
    });

    expect(screen.getByText(longTitle)).toBeDefined();
    expect(screen.getByText(longValue)).toBeDefined();
    expect(screen.getByText(longDescription)).toBeDefined();
    expect(card).toHaveTextContent(longTitle);
    expect(card).toHaveTextContent(longValue);
    expect(card).toHaveTextContent(longDescription);
  });

  it("renders ViewToggle as pressed segmented controls with icon-first labels for every mode", () => {
    const onChange = vi.fn();
    const modes = [
      { label: "Trend", value: "trend" },
      { label: "Composition", value: "composition" },
      { label: "Models", value: "models" },
      { label: "Providers", value: "reliability" },
      { label: "Ledgers", value: "ledgers" },
      { label: "System", value: "system" },
    ] as const;

    render(<ViewToggle value="models" onChange={onChange} ariaLabel="Stats mode" />);

    const group = screen.getByRole("group", { name: "Stats mode" });
    expect(group).toBeDefined();

    for (const mode of modes) {
      const button = within(group).getByRole("button", { name: mode.label });
      expect(button).toHaveAttribute("aria-pressed", mode.value === "models" ? "true" : "false");
      expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    }

    fireEvent.click(within(group).getByRole("button", { name: "Ledgers" }));

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

  it("keeps shared stats surfaces on flat neutral tokens instead of glass blur or hover lift", () => {
    const themeCss = readFileSync(resolve(statsRoot, "styles/stats-theme.css"), "utf8");
    const cardCss = readFileSync(resolve(statsRoot, "components/StatsCard.module.css"), "utf8");
    const primitiveClasses = [
      PANEL_CLASS,
      SUBPANEL_CLASS,
      CHIP_CLASS,
      INPUT_CLASS,
      LEDGER_ROW_CLASS,
      LEDGER_ROW_MODERN_CLASS,
    ].join(" ");

    expect(themeCss).toContain("--stats-surface-panel: rgba(255, 255, 255, 0.96)");
    expect(themeCss).toContain("--stats-surface-chip: rgba(241, 245, 249, 0.92)");
    expect(themeCss).toContain("--stats-card-shadow: none");
    expect(themeCss).toContain("--stats-panel-shadow: none");
    expect(themeCss).not.toContain("surface-glass");
    expect(`${themeCss}\n${cardCss}\n${primitiveClasses}`).not.toMatch(/backdrop-filter|-webkit-backdrop-filter|backdrop-blur|translateY|hover:-translate|linear-gradient/);
    expect(primitiveClasses).not.toContain("shadow-[var(--stats-card-shadow-hover)]");
    expect(primitiveClasses).not.toContain("shadow-[var(--stats-control-shadow");

    render(<SeriesLegendButton series={CHART_SERIES[0]} active={false} currentValue={0} onToggle={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Throughput/i }).className).not.toContain("backdrop-blur");
  });

});
