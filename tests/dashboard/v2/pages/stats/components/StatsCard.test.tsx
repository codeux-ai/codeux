/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import { StatsCard } from "../../../../../../dashboard/src/v2/pages/stats/components/StatsCard.js";
import { Activity } from "lucide-preact";

// Mock animated foundations to avoid GSAP/DOM issues in jsdom
vi.mock("../../../../../../dashboard/src/v2/components/ui/WaveFluid.js", () => ({
  WaveFluid: () => <div data-testid="wave-fluid" />,
}));

vi.mock("../../../../../../dashboard/src/v2/components/ui/BorderTrace.js", () => ({
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
  });

  it("renders icon component when provided", () => {
    const { container } = render(<StatsCard title="Test" value="0" icon={Activity} />);
    // The icon container should be present
    const iconContainer = container.querySelector('[class*="iconContainer"]');
    expect(iconContainer).not.toBeNull();
    // Lucide icons render as SVG
    expect(iconContainer?.querySelector("svg")).not.toBeNull();
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
  });

  it("applies variant classes based on accent prop", () => {
    const { container } = render(<StatsCard title="Test" value="0" accent="amber" />);
    const card = container.firstChild as HTMLElement;
    // Match the CSS module class name for accentAmber
    expect(card.className).toMatch(/accentAmber/);
  });

  it("stays stable without optional elements", () => {
    const { container } = render(<StatsCard title="Minimal" value="100" />);
    
    expect(screen.queryByTestId("trend-chip")).toBeNull();
    // The footer div should not be rendered if both trend and description are missing
    const footer = container.querySelector('[class*="footer"]');
    expect(footer).toBeNull();
  });

  it("renders with active state foundation", () => {
    render(<StatsCard title="Active" value="1" isActive={true} />);
    expect(screen.getByTestId("wave-fluid")).toBeDefined();
  });
});
